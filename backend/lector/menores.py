#!/usr/bin/env python3
"""Lee con Claude Haiku 5.5 los PDF de los contratos menores (≤8 UIT) y guarda lo extraído en menor_lectura (251).

  python -X utf8 backend/lector/menores.py prod --clase menor_tdr --tope-usd 40
  python -X utf8 backend/lector/menores.py prod --clase menor_contrato --tope-usd 30
  python -X utf8 backend/lector/menores.py prod --clase menor_tdr --segunda --solo-con-banderas --tope-usd 5
  python -X utf8 backend/lector/menores.py prod --clase menor_tdr --limite 20          # una prueba

  menor_tdr       el requerimiento (TDR o especificaciones) espejado en el R2: seace/menores/req/<id>.pdf
  menor_contrato  el contrato u orden registrado en el Buscador de Contratos del SEACE (prod4, en vivo y sin WAF)

Del de mayor monto al de menor; reanudable (salta lo ya leído salvo los `error`); para al llegar a --tope-usd. Usa la
misma lectura que los documentos de los procesos (leer.py: tope de páginas y de tokens, tramos). Además guarda la
`huella` del texto de cada PDF (SHA-1 del texto normalizado, si tiene texto) para reconocer el mismo requerimiento en
varios contratos. Al final, refrescar_menor_senales() pasa lo leído a las banderas (migración 252).
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import io
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector.base import CLIENTE, bajar_r2, cliente_claude, norma  # noqa: E402
from lector.leer import MODELO, Base, _Segunda, leer_contrato  # noqa: E402

BUCKET = {"prod": "vigia-peru-batch", "dev": "vigia-peru-batch-dev"}
PROD4_DOC = "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

PENDIENTES = {
    "menor_tdr": """
SELECT m.id_contrato FROM seace_menores m
 WHERE m.req_r2 AND m.monto > 0
   AND NOT EXISTS (SELECT 1 FROM menor_lectura l WHERE l.id_contrato = m.id_contrato AND l.clase = %(clase)s
                      AND l.version = %(version)s AND l.estado <> 'error') {extra}
 ORDER BY m.monto DESC, m.id_contrato""",
    "menor_contrato": """
SELECT m.id_contrato FROM seace_menores m
 WHERE m.id_documento_contrato IS NOT NULL AND m.monto > 0
   AND NOT EXISTS (SELECT 1 FROM menor_lectura l WHERE l.id_contrato = m.id_contrato AND l.clase = %(clase)s
                      AND l.version = %(version)s AND l.estado <> 'error') {extra}
 ORDER BY m.monto DESC, m.id_contrato""",
}
CON_BANDERAS = """AND EXISTS (SELECT 1 FROM menor_lectura f WHERE f.id_contrato = m.id_contrato AND f.clase = %(clase)s
                       AND f.version = %(version_base)s AND f.estado = 'ok' AND f.banderas && %(confirmar)s::text[])"""

GUARDAR = """
INSERT INTO menor_lectura (id_contrato, clase, version, modelo, paginas, estado, salida, banderas, huella, tokens_in,
                           tokens_out, costo_usd, detalle, leido_at)
VALUES (%(id)s, %(clase)s, %(version)s, %(modelo)s, %(paginas)s, %(estado)s, %(salida)s, %(banderas)s, %(huella)s,
        %(tokens_in)s, %(tokens_out)s, %(costo_usd)s, %(detalle)s, now())
ON CONFLICT (id_contrato, clase, version) DO UPDATE SET
  modelo = EXCLUDED.modelo, paginas = EXCLUDED.paginas, estado = EXCLUDED.estado, salida = EXCLUDED.salida,
  banderas = EXCLUDED.banderas, huella = COALESCE(EXCLUDED.huella, menor_lectura.huella), tokens_in = EXCLUDED.tokens_in,
  tokens_out = EXCLUDED.tokens_out, costo_usd = EXCLUDED.costo_usd, detalle = EXCLUDED.detalle, leido_at = now()
"""

_sesion = threading.local()


def bajar_prod4(id_documento: str) -> bytes:
    import requests
    s = getattr(_sesion, "s", None)
    if s is None:
        s = _sesion.s = requests.Session()
    r = s.get(PROD4_DOC + id_documento, timeout=120,
              headers={"User-Agent": UA, "Referer": "https://prod4.seace.gob.pe/contratos/publico/",
                       "Origin": "https://prod4.seace.gob.pe", "Accept": "application/pdf,*/*"})
    r.raise_for_status()
    return r.content


def huella(b: bytes) -> str | None:
    """SHA-1 del texto del PDF (sin números, tildes ni signos): el mismo requerimiento aunque cambie la fecha o el monto.
    None si es escaneado (poco texto)."""
    try:
        from pypdf import PdfReader
        texto = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(b)).pages[:30])
    except Exception:  # noqa: BLE001
        return None
    t = re.sub(r"[0-9]+", " ", norma(texto))
    t = " ".join(t.split())
    return hashlib.sha1(t.encode()).hexdigest() if len(t) >= 400 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--clase", required=True, choices=sorted(PENDIENTES))
    ap.add_argument("--tope-usd", type=float, default=5.0)
    ap.add_argument("--hilos", type=int, default=6)
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--segunda", action="store_true")
    ap.add_argument("--solo-con-banderas", action="store_true")
    ap.add_argument("--sin-refrescar", action="store_true", help="no correr refrescar_menor_senales() al final")
    a = ap.parse_args()
    lector = importlib.import_module(f"lector.{a.clase}")
    version_base = lector.VERSION
    if a.segunda:
        lector = _Segunda(lector)
    extra = CON_BANDERAS if a.segunda and a.solo_con_banderas else ""
    base = Base(a.entorno)
    params = {"clase": lector.CLASE, "version": lector.VERSION, "version_base": version_base,
              "confirmar": list(getattr(lector, "BANDERAS_A_CONFIRMAR", lector.BANDERAS)) or ["-"]}
    filas = base.hacer(lambda cur: (cur.execute(PENDIENTES[a.clase].format(extra=extra), params), cur.fetchall())[1])
    ids = [f[0] for f in filas][: a.limite or None]
    # Lo registrado de cada uno: de dónde bajar el contrato y con qué comparar lo leído (banderas_contexto).
    ctx = {r[0]: {"doc": r[1], "monto": float(r[2] or 0), "moneda": r[3], "proveedor_ruc": r[4]} for r in base.hacer(
        lambda cur: (cur.execute("""SELECT id_contrato, id_documento_contrato, monto, moneda, proveedor_ruc FROM seace_menores
                                     WHERE id_contrato = ANY(%s)""", (ids,)), cur.fetchall())[1])} if ids else {}
    print(f"{a.entorno}: {len(ids)} contratos menores por leer ({lector.CLASE} {lector.VERSION}, tope USD {a.tope_usd})", flush=True)
    claude = cliente_claude()
    gastado, hechos, t0 = 0.0, 0, time.time()
    cuenta: dict[str, int] = {}

    def uno(idc: int) -> dict:
        crudo: dict[str, bytes] = {}

        def bajar(url: str) -> bytes:
            b = bajar_prod4(url.removeprefix("prod4:")) if url.startswith("prod4:") else bajar_r2(url)
            crudo["b"] = b
            return b

        url = (f"prod4:{ctx[idc]['doc']}" if a.clase == "menor_contrato"
               else f"gs://{BUCKET[a.entorno]}/seace/menores/req/{idc}.pdf")
        try:
            f = leer_contrato(claude, lector, str(idc), [idc], [url], ["pdf"], bajar=bajar)
        except Exception as e:  # noqa: BLE001 — se guarda como error y se reintenta en la próxima corrida
            f = {"estado": "error", "modelo": MODELO, "paginas": None, "salida": None, "banderas": [], "tokens_in": None,
                 "tokens_out": None, "costo_usd": 0, "detalle": f"{type(e).__name__}: {str(e)[:300]}"}
        banderas = list(f.get("banderas") or [])
        if f["estado"] == "ok" and hasattr(lector, "banderas_contexto"):
            banderas = sorted(set(banderas) | set(lector.banderas_contexto(f["salida"], ctx[idc])))
        return {"id": idc, "clase": lector.CLASE, "version": lector.VERSION, "modelo": f.get("modelo") or MODELO,
                "paginas": f.get("paginas"), "estado": f["estado"], "banderas": banderas,
                "salida": json.dumps(f["salida"], ensure_ascii=False) if f.get("salida") is not None else None,
                "huella": huella(crudo["b"]) if "b" in crudo and not a.segunda else None,
                "tokens_in": f.get("tokens_in"), "tokens_out": f.get("tokens_out"), "costo_usd": f.get("costo_usd") or 0,
                "detalle": f.get("detalle")}

    with ThreadPoolExecutor(max_workers=a.hilos) as pool:
        futuros, i = set(), 0
        while i < len(ids) or futuros:
            while i < len(ids) and len(futuros) < a.hilos * 2 and gastado < a.tope_usd:
                futuros.add(pool.submit(uno, ids[i]))
                i += 1
            if not futuros:
                break
            listo = next(as_completed(futuros))
            futuros.discard(listo)
            fila = listo.result()
            base.hacer(lambda cur, f=fila: cur.execute(GUARDAR, f))
            gastado += float(fila["costo_usd"] or 0)
            hechos += 1
            cuenta[fila["estado"]] = cuenta.get(fila["estado"], 0) + 1
            if hechos % 25 == 0 or hechos <= 5 or fila["banderas"]:
                print(f"  {hechos}/{len(ids)} {fila['id']}: {fila['estado']} {fila['paginas']} págs "
                      f"{fila['tokens_in']}+{fila['tokens_out']} USD {fila['costo_usd']} {fila['banderas']} "
                      f"| USD {gastado:.2f} {round(time.time() - t0)} s", flush=True)
            if gastado >= a.tope_usd and i < len(ids):
                print(f"  tope de USD {a.tope_usd} alcanzado: no se mandan más", flush=True)
                i = len(ids)
    print(f"FIN {lector.CLASE} {lector.VERSION}: {hechos} contratos menores, USD {gastado:.2f}, {cuenta}", flush=True)
    if not a.sin_refrescar and hechos:
        n = base.hacer(lambda cur: (cur.execute("SELECT refrescar_menor_senales()"), cur.fetchone()[0])[1])
        print(f"refrescar_menor_senales(): {n} señales", flush=True)


if __name__ == "__main__":
    main()
