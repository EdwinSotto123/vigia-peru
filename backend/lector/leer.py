#!/usr/bin/env python3
"""Lee con Claude los PDF de las contrataciones que ya están en el R2 y guarda lo extraído en documento_lectura (245).

  python -X utf8 backend/lector/leer.py prod --clase buena_pro --tope-usd 40
  python -X utf8 backend/lector/leer.py prod --clase buena_pro --limite 20          # una prueba

Por cada contrato con documentos de la clase (lector/<clase>.py → TIPOS_DOC), del de mayor monto al de menor:
  1. baja sus documentos del R2 y saca los PDF (los ZIP, en memoria), hasta TOPE_PAGINAS (un PDF más largo se corta);
  2. cuenta los tokens (gratis) y quita PDF del final hasta quedar bajo TOPE_TOKENS: Haiku 5.5 cobra 5 veces más por
     encima de 100 mil;
  3. pide al modelo los hechos con el esquema de la clase y calcula las banderas con sus reglas (banderas_de);
  4. guarda la fila (también si no se pudo leer, con su estado; los `error` se reintentan en la próxima corrida).
Se puede cortar y volver a correr: salta lo que ya está. Para cuando lo gastado llega a --tope-usd.
Va directo a la base por el túnel (tunel_rds.py); las llamadas, por vigia-llm (base.py).
"""
from __future__ import annotations

import argparse
import importlib
import io
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector.base import bajar_r2, bloques_pdf, cliente_claude, costo_usd, pdfs_de  # noqa: E402
from tunel_rds import conexion  # noqa: E402

MODELO = "claude-haiku-5-5"
TOPE_PAGINAS = 60
TOPE_TOKENS = 100_000

PENDIENTES = """
SELECT d.ocid,
       array_agg(d.id ORDER BY array_position(%(tipos)s::text[], d.tipo), d.creado_at),
       array_agg(d.url_gcs ORDER BY array_position(%(tipos)s::text[], d.tipo), d.creado_at),
       array_agg(lower(d.formato) ORDER BY array_position(%(tipos)s::text[], d.tipo), d.creado_at)
  FROM documentos_gcs d
  LEFT JOIN contrato_estado c ON c.ocid = d.ocid
 WHERE d.borrado_at IS NULL AND d.tipo = ANY(%(tipos)s) AND lower(d.formato) IN ('pdf', 'zip')
   AND NOT EXISTS (SELECT 1 FROM documento_lectura l
                    WHERE l.ocid = d.ocid AND l.clase = %(clase)s AND l.version = %(version)s AND l.estado <> 'error')
 GROUP BY d.ocid
 ORDER BY max(c.monto) DESC NULLS LAST, d.ocid
"""

GUARDAR = """
INSERT INTO documento_lectura (ocid, clase, version, modelo, documentos, paginas, estado, salida, banderas,
                               tokens_in, tokens_out, costo_usd, detalle, leido_at)
VALUES (%(ocid)s, %(clase)s, %(version)s, %(modelo)s, %(documentos)s, %(paginas)s, %(estado)s, %(salida)s, %(banderas)s,
        %(tokens_in)s, %(tokens_out)s, %(costo_usd)s, %(detalle)s, now())
ON CONFLICT (ocid, clase, version) DO UPDATE SET
  modelo = EXCLUDED.modelo, documentos = EXCLUDED.documentos, paginas = EXCLUDED.paginas, estado = EXCLUDED.estado,
  salida = EXCLUDED.salida, banderas = EXCLUDED.banderas, tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out,
  costo_usd = EXCLUDED.costo_usd, detalle = EXCLUDED.detalle, leido_at = now()
"""


class _Segunda:
    """El mismo lector, guardado como <versión>-2: otra lectura del mismo documento, para confirmar banderas."""

    def __init__(self, lector):
        self._l = lector
        self.VERSION = f"{lector.VERSION}-2"

    def __getattr__(self, nombre):
        return getattr(self._l, nombre)


class Base:
    """Una conexión por el túnel, compartida entre hilos con un candado; si se cae, se reabre."""

    def __init__(self, entorno: str):
        self.entorno, self.cm, self.c, self.candado = entorno, None, None, threading.Lock()

    def hacer(self, fn):
        with self.candado:
            for intento in range(1, 4):
                try:
                    if self.c is None:
                        self.cm = conexion(self.entorno)
                        self.c = self.cm.__enter__()
                    r = fn(self.c.cursor())
                    self.c.commit()
                    return r
                except Exception as e:  # noqa: BLE001 — el túnel o la base: se reabre y se repite
                    print(f"  la base falló ({intento}): {str(e)[:160]}", flush=True)
                    try:
                        self.cm.__exit__(None, None, None)
                    except Exception:  # noqa: BLE001
                        pass
                    self.cm = self.c = None
                    time.sleep(10 * intento)
            raise RuntimeError("la base no responde")


def paginas_de(b: bytes) -> int:
    try:
        from pypdf import PdfReader
        return len(PdfReader(io.BytesIO(b)).pages)
    except Exception:  # noqa: BLE001 — un PDF raro: que lo juzgue el conteo de tokens
        return 10


def paginas(b: bytes, indices: list[int]) -> bytes:
    """Un PDF con sólo esas páginas (en su orden)."""
    from pypdf import PdfReader, PdfWriter
    lector_pdf = PdfReader(io.BytesIO(b))
    w = PdfWriter()
    for i in indices:
        if 0 <= i < len(lector_pdf.pages):
            w.add_page(lector_pdf.pages[i])
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def recortar(b: bytes, n: int) -> bytes:
    """Las primeras n páginas de un PDF (el resto del acta suele ser anexos)."""
    return paginas(b, list(range(n)))


def leer_contrato(claude, lector, ocid: str, ids: list[int], urls: list[str], formatos: list[str]) -> dict:
    fila = {"ocid": ocid, "clase": lector.CLASE, "version": lector.VERSION, "modelo": MODELO, "documentos": [],
            "paginas": 0, "estado": "sin_pdf", "salida": None, "banderas": [], "tokens_in": None, "tokens_out": None,
            "costo_usd": 0, "detalle": None}
    pdfs: list[tuple[str, bytes]] = []
    for doc_id, url, formato in zip(ids, urls, formatos):
        if fila["paginas"] >= TOPE_PAGINAS:
            break
        try:
            partes = pdfs_de(bajar_r2(url), formato)
        except Exception as e:  # noqa: BLE001
            fila["detalle"] = f"no se pudo bajar {doc_id}: {str(e)[:120]}"
            continue
        # Un lector puede ordenar los PDF de un ZIP (las bases: primero el que se llama «bases»).
        if hasattr(lector, "ordenar_pdfs"):
            partes = lector.ordenar_pdfs(partes)
        usados = False
        for nombre, b in partes:
            n = paginas_de(b)
            queda = TOPE_PAGINAS - fila["paginas"]
            if queda <= 0:
                break
            # Un lector puede elegir qué páginas leer (las bases: la sección con los requisitos); si no, las primeras.
            elegir = getattr(lector, "elegir_paginas", None)
            if n > queda or elegir:
                try:
                    indices = elegir(b, queda) if elegir else list(range(queda))
                    if len(indices) < n:
                        b, n = paginas(b, indices), len(indices)
                except Exception:  # noqa: BLE001 — no se puede cortar: se salta ese PDF
                    continue
                if not n:
                    continue
            pdfs.append((nombre, b))
            fila["paginas"] += n
            usados = True
        if usados:
            fila["documentos"].append(doc_id)
    if not pdfs:
        return fila
    while True:
        mensajes = bloques_pdf(pdfs, lector.PEDIDO)
        n_in = claude.messages.count_tokens(model=MODELO, system=lector.SISTEMA, messages=mensajes).input_tokens
        if n_in <= TOPE_TOKENS or len(pdfs) == 1:
            break
        pdfs.pop()
    if n_in > TOPE_TOKENS * 1.5:
        return {**fila, "estado": "grande", "detalle": f"{n_in} tokens en un solo PDF"}
    r = claude.messages.create(model=MODELO, max_tokens=16000, system=lector.SISTEMA, messages=mensajes,
                               output_config={"effort": "low", "format": {"type": "json_schema", "schema": lector.ESQUEMA}})
    u = r.usage
    fila.update(modelo=r.model, tokens_in=u.input_tokens, tokens_out=u.output_tokens,
                costo_usd=round(costo_usd(r.model, u.input_tokens, u.output_tokens), 6))
    if r.stop_reason == "refusal":
        return {**fila, "estado": "rechazo", "detalle": str(getattr(r, "stop_details", ""))[:300]}
    if r.stop_reason == "max_tokens":
        return {**fila, "estado": "truncada"}
    texto = next((b.text for b in r.content if b.type == "text"), "")
    try:
        salida = json.loads(texto)
    except json.JSONDecodeError:
        return {**fila, "estado": "json_invalido", "detalle": texto[:300]}
    return {**fila, "estado": "ok", "salida": salida, "banderas": lector.banderas_de(salida)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--clase", required=True)
    ap.add_argument("--tope-usd", type=float, default=10.0)
    ap.add_argument("--hilos", type=int, default=8)
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--segunda", action="store_true",
                    help="una segunda lectura independiente (versión <v>-2): las banderas que dependen del juicio del "
                         "modelo se publican sólo si las dos coinciden (migración 246)")
    ap.add_argument("--solo-con-banderas", action="store_true",
                    help="con --segunda: sólo los contratos cuya primera lectura encontró alguna bandera (lo único que la "
                         "segunda confirma)")
    a = ap.parse_args()
    lector = importlib.import_module(f"lector.{a.clase}")
    version_base = lector.VERSION
    if a.segunda:
        lector = _Segunda(lector)
    consulta = PENDIENTES
    if a.segunda and a.solo_con_banderas:
        consulta = PENDIENTES.replace(
            " GROUP BY d.ocid",
            "   AND EXISTS (SELECT 1 FROM documento_lectura f WHERE f.ocid = d.ocid AND f.clase = %(clase)s"
            " AND f.version = %(version_base)s AND f.estado = 'ok' AND f.banderas <> '{}')\n GROUP BY d.ocid", 1)
    base = Base(a.entorno)
    pendientes = base.hacer(lambda cur: (cur.execute(consulta, {"tipos": lector.TIPOS_DOC, "clase": lector.CLASE,
                                                                "version": lector.VERSION, "version_base": version_base}),
                                         cur.fetchall())[1])
    if a.limite:
        pendientes = pendientes[: a.limite]
    print(f"{a.entorno}: {len(pendientes)} contratos por leer ({lector.CLASE} {lector.VERSION}, tope USD {a.tope_usd})", flush=True)
    claude = cliente_claude()
    gastado, hechos, t0 = 0.0, 0, time.time()
    cuenta: dict[str, int] = {}
    candado = threading.Lock()

    def uno(fila_p):
        ocid, ids, urls, formatos = fila_p
        try:
            return leer_contrato(claude, lector, ocid, list(ids), list(urls), list(formatos))
        except Exception as e:  # noqa: BLE001 — se guarda como error y se reintenta en la próxima corrida
            return {"ocid": ocid, "clase": lector.CLASE, "version": lector.VERSION, "modelo": MODELO, "documentos": [],
                    "paginas": None, "estado": "error", "salida": None, "banderas": [], "tokens_in": None,
                    "tokens_out": None, "costo_usd": 0, "detalle": f"{type(e).__name__}: {str(e)[:300]}"}

    with ThreadPoolExecutor(max_workers=a.hilos) as pool:
        futuros, i = set(), 0
        while i < len(pendientes) or futuros:
            while i < len(pendientes) and len(futuros) < a.hilos * 2 and gastado < a.tope_usd:
                futuros.add(pool.submit(uno, pendientes[i]))
                i += 1
            if not futuros:
                break
            listo = next(as_completed(futuros))
            futuros.discard(listo)
            fila = listo.result()
            guardable = {**fila, "salida": json.dumps(fila["salida"], ensure_ascii=False) if fila["salida"] is not None else None}
            base.hacer(lambda cur, f=guardable: cur.execute(GUARDAR, f))
            with candado:
                gastado += float(fila["costo_usd"] or 0)
                hechos += 1
                cuenta[fila["estado"]] = cuenta.get(fila["estado"], 0) + 1
            print(f"  {hechos}/{len(pendientes)} {fila['ocid']}: {fila['estado']} {fila['paginas']} págs "
                  f"{fila['tokens_in']}+{fila['tokens_out']} USD {fila['costo_usd']} {fila['banderas']} "
                  f"| USD {gastado:.2f} {round(time.time() - t0)} s", flush=True)
            if gastado >= a.tope_usd and i < len(pendientes):
                print(f"  tope de USD {a.tope_usd} alcanzado: no se mandan más", flush=True)
                i = len(pendientes)
    print(f"FIN {lector.CLASE}: {hechos} contratos, USD {gastado:.2f}, {cuenta}", flush=True)


if __name__ == "__main__":
    main()
