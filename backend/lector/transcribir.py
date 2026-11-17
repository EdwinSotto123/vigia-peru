#!/usr/bin/env python3
"""Transcribir con visión las páginas ESCANEADAS de un documento, una sola vez, y guardar el texto donde lo usan todos.

  python -X utf8 backend/lector/transcribir.py prod --limite 20 --tope-usd 2
  python -X utf8 backend/lector/transcribir.py prod --medir                     # cuántas páginas esperan
  python -X utf8 backend/lector/transcribir.py prod --cola cortos --limite 500  # garantías, adicionales, resoluciones…

Por qué: cerca de dos de cada tres bases recientes traen un bloque escaneado dentro de su parte específica (el
requerimiento pegado como imagen: especificaciones, términos de referencia, requisitos de calificación). Sin transcribir,
esas páginas no existen para ningún lector: es la pérdida de información más grande que se midió.

Qué hace, por cada documento de la cola (hoy: las bases cuya ficha quedó en «espera_vision», lector/por_pieza.py):
  1. baja el archivo del R2 y saca el PDF de la pieza (si es un ZIP, su archivo interno);
  2. convierte a imagen SÓLO las páginas escaneadas (no las que ya tienen texto) y las manda al modelo abierto de visión
     (GLM 5.3 flash por vigia-llm) de a pocas por pedido, con la orden de transcribir literalmente;
  3. escribe el texto de cada página en documentos_texto (la misma fila, la misma página, marcada `ocr`), rehace el texto
     corrido y deja constancia del gasto en pieza_lectura (lector «transcripcion»): cuenta para el tope de lectura.
Después la ficha de esas bases vuelve sola a la cola de lectura (el texto del documento cambió).

No transcribe dos veces la misma página ni toca páginas con texto. Si una página sale vacía, queda como estaba.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector.base import bajar_r2  # noqa: E402

VERSION = "t1"
TOPE_TOTAL_USD = 315.0                 # el mismo tope de lectura con modelo (lector/por_pieza.py)
POR_PEDIDO = 6                         # imágenes por pedido: con 12 o más Workers AI falla
DPI = 120
MIN_TRANSCRITO = 40                    # menos caracteres que esto no es una transcripción

SISTEMA = """Transcribes páginas escaneadas de documentos de contratación pública del Perú. Recibes varias imágenes, cada
una es una página, en orden (índices 0, 1, 2…). Devuelves el texto de cada una.
- Transcribe LITERALMENTE todo lo que se lee: no resumas, no corrijas, no completes lo que no se ve.
- Las tablas van como filas, con « | » entre columnas.
- Conserva números, montos, fechas, RUC y nombres tal como están escritos.
- No describas sellos, firmas ni logos. Si una página no se puede leer, su texto va vacío.
- Un elemento por cada imagen, con su índice."""
PEDIDO = "Transcribe cada página."
ESQUEMA = {"type": "object", "additionalProperties": False, "required": ["paginas"], "properties": {
    "paginas": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["indice", "texto"],
                                           "properties": {"indice": {"type": "integer"}, "texto": {"type": "string"}}}}}}

COLA = """
SELECT p.id, p.sha256, p.archivo, p.pag_ini, g.url_gcs, lower(g.formato), l.detalle
  FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id JOIN documentos_gcs g ON g.id = p.doc_id
  LEFT JOIN convocatorias c ON c.ocid = p.ocid
 WHERE l.lector = 'bases' AND l.estado = 'espera_vision' AND g.url_gcs IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM pieza_lectura x WHERE x.pieza_id = p.id AND x.lector = 'transcripcion' AND x.version = %(version)s)
 ORDER BY c.fecha_convocatoria DESC NULLS LAST, p.id DESC
 LIMIT %(limite)s
"""
# La otra cola: los documentos cortos y firmados que casi siempre son un escaneo (garantías, adicionales, ampliaciones,
# resoluciones, nulidades, informes de desierto). Se transcriben todas sus páginas sin texto.
CORTOS = ("garantia", "adicional", "reduccion", "ampliacion_plazo", "adenda", "resolucion_contrato", "nulidad", "informe_desierto")
COLA_CORTOS = """
SELECT p.id, p.sha256, p.archivo, p.pag_ini, g.url_gcs, lower(g.formato),
       jsonb_build_object('escaneadas', (SELECT jsonb_agg((e.p->>'n')::int ORDER BY (e.p->>'n')::int)
                                           FROM jsonb_array_elements(t.paginas) AS e(p)
                                          WHERE (e.p->>'n') ~ '^[0-9]+$' AND (e.p->>'n')::int BETWEEN p.pag_ini AND p.pag_fin
                                            AND length(coalesce(e.p->>'texto', '')) < 300))::text
  FROM documento_pieza p JOIN documentos_gcs g ON g.id = p.doc_id JOIN documentos_texto t ON t.sha256 = p.sha256
 WHERE p.tipo_documento = ANY (%(tipos)s) AND p.paginas <= %(max_paginas)s AND p.paginas_con_texto < p.paginas
   AND g.url_gcs IS NOT NULL AND jsonb_typeof(t.paginas) = 'array'
   AND NOT EXISTS (SELECT 1 FROM pieza_lectura x WHERE x.pieza_id = p.id AND x.lector = 'transcripcion' AND x.version = %(version)s)
 ORDER BY p.id DESC
 LIMIT %(limite)s
"""
GASTADO = "SELECT COALESCE(sum(costo_usd), 0)::float FROM pieza_lectura WHERE modelo <> 'plantilla'"
ANOTAR = """
INSERT INTO pieza_lectura (pieza_id, lector, version, modelo, estado, salida, sobrante, tokens_in, tokens_out, costo_usd, detalle, leido_at)
VALUES (%(pieza_id)s, 'transcripcion', %(version)s, %(modelo)s, %(estado)s, %(salida)s, 0, %(tokens_in)s, %(tokens_out)s, %(costo_usd)s,
        %(detalle)s, now())
ON CONFLICT (pieza_id, lector, version) DO UPDATE SET
  modelo = EXCLUDED.modelo, estado = EXCLUDED.estado, salida = EXCLUDED.salida, tokens_in = EXCLUDED.tokens_in,
  tokens_out = EXCLUDED.tokens_out, costo_usd = EXCLUDED.costo_usd, detalle = EXCLUDED.detalle, leido_at = now()
"""


class _Lector:
    SISTEMA, PEDIDO, ESQUEMA = SISTEMA, PEDIDO, ESQUEMA


def pdf_de_la_pieza(datos: bytes, formato: str, archivo: str) -> bytes | None:
    """El PDF de la pieza: el archivo mismo o, en un ZIP, su archivo interno (por nombre; sin descomprimir a disco)."""
    if datos.startswith(b"%PDF"):
        return datos
    if (formato or "").lower() != "zip":
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(datos)) as z:
            nombres = [m.filename for m in z.infolist() if not m.is_dir() and m.filename.lower().endswith(".pdf")]
            elegido = next((n for n in nombres if n[:200] == archivo), None) \
                or next((n for n in nombres if Path(n).name == Path(archivo).name), None) \
                or (nombres[0] if len(nombres) == 1 else None)
            return z.read(elegido) if elegido else None
    except zipfile.BadZipFile:
        return None


def imagenes(pdf: bytes, indices: list[int]) -> list[tuple[int, bytes]]:
    """Las páginas pedidas (índice desde 0 dentro del PDF) como JPEG."""
    import fitz  # PyMuPDF

    out = []
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        for i in indices:
            if 0 <= i < len(doc):
                out.append((i, doc[i].get_pixmap(dpi=DPI).tobytes(output="jpeg", jpg_quality=70)))
    return out


def transcribir_paginas(motor, pdf: bytes, indices: list[int]) -> tuple[dict[int, str], dict]:
    """→ ({índice de página: texto}, {tokens_in, tokens_out, costo_usd, fallos})."""
    textos: dict[int, str] = {}
    uso = {"tokens_in": 0, "tokens_out": 0, "costo_usd": 0.0, "fallos": []}
    paginas = imagenes(pdf, indices)
    for k in range(0, len(paginas), POR_PEDIDO):
        grupo = paginas[k: k + POR_PEDIDO]
        bloques = [{"type": "text", "text": f"Van {len(grupo)} páginas escaneadas, con índices 0 a {len(grupo) - 1} en este orden."}]
        bloques += [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}} for _, jpg in grupo]
        bloques.append({"type": "text", "text": PEDIDO})
        r = motor.pedir(_Lector, bloques, len(grupo))
        uso["tokens_in"] += r["tokens_in"] or 0
        uso["tokens_out"] += r["tokens_out"] or 0
        uso["costo_usd"] += float(r["costo_usd"] or 0)
        if r["estado"] != "ok":
            uso["fallos"].append(f"{r['estado']}: {str(r.get('detalle') or '')[:80]}")
            continue
        for e in (r["salida"] or {}).get("paginas") or []:
            try:
                i = int(e.get("indice"))
            except (TypeError, ValueError):
                continue
            t = str(e.get("texto") or "").replace("\x00", "").strip()
            if 0 <= i < len(grupo) and len(t) >= MIN_TRANSCRITO:
                textos[grupo[i][0]] = t
    return textos, uso


def armar_texto(paginas: list[dict]) -> str:
    """El texto corrido de documentos_texto: una marca por página y, si hay varios archivos, una por archivo."""
    partes, actual = [], None
    varios = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if varios and p.get("archivo") != actual:
            actual = p.get("archivo")
            partes.append(f"⟦archivo: {actual}⟧")
        partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    return "\n".join(partes).strip()


def guardar_texto(cur, sha256: str, por_numero: dict[int, str], modelo: str) -> int:
    """Escribe la transcripción en las páginas de documentos_texto (sólo las que seguían casi vacías) y rehace el texto."""
    cur.execute("SELECT paginas, motor FROM documentos_texto WHERE sha256 = %s FOR UPDATE", (sha256,))
    fila = cur.fetchone()
    if not fila or not isinstance(fila[0], list):
        return 0
    paginas, motor = fila
    cambiadas = 0
    for p in paginas:
        n = int(p.get("n") or 0)
        nuevo = por_numero.get(n)
        if nuevo and len((p.get("texto") or "").strip()) < 300 and len(nuevo) > len(p.get("texto") or ""):
            p.update(texto=nuevo, chars=len(nuevo), ocr="glm_vision")
            cambiadas += 1
    if cambiadas:
        nuevo_motor = motor if "glm_vision" in (motor or "") else f"{motor or 'pymupdf'}+glm_vision"
        cur.execute("""UPDATE documentos_texto SET paginas = %s::jsonb, texto = %s, motor = %s, extraccion = NULL, actualizado_at = now()
                        WHERE sha256 = %s""", (json.dumps(paginas, ensure_ascii=False), armar_texto(paginas), nuevo_motor, sha256))
    return cambiadas


def uno(motor, fila, max_paginas: int) -> dict:
    pieza_id, sha256, archivo, pag_ini, url, formato, detalle = fila
    res = {"pieza_id": pieza_id, "version": VERSION, "modelo": motor.nombre, "estado": "error", "salida": None, "tokens_in": 0,
           "tokens_out": 0, "costo_usd": 0, "detalle": None, "_sha": sha256, "_textos": {}}
    try:
        escaneadas = [int(n) for n in (json.loads(detalle or "{}").get("escaneadas") or [])][:max_paginas]
    except (ValueError, TypeError):
        escaneadas = []
    if not escaneadas:
        return {**res, "estado": "sin_paginas"}
    pdf = pdf_de_la_pieza(bajar_r2(url), formato, archivo or "")
    if pdf is None:
        return {**res, "estado": "sin_pdf", "detalle": "no se halló el PDF de la pieza en el archivo"}
    textos, uso = transcribir_paginas(motor, pdf, [n - int(pag_ini or 1) for n in escaneadas])
    por_numero = {i + int(pag_ini or 1): t for i, t in textos.items()}
    return {**res, "estado": "ok" if por_numero else "sin_texto", "tokens_in": uso["tokens_in"], "tokens_out": uso["tokens_out"],
            "costo_usd": round(uso["costo_usd"], 6), "detalle": "; ".join(uso["fallos"])[:300] or None,
            "salida": json.dumps({"pedidas": escaneadas, "transcritas": sorted(por_numero),
                                  "caracteres": sum(len(t) for t in por_numero.values())}), "_textos": por_numero}


def main() -> None:
    from lector.motor_workers import MODELO_DEFECTO, MotorWorkers
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--limite", type=int, default=20, help="documentos")
    ap.add_argument("--tope-usd", type=float, default=2.0)
    ap.add_argument("--max-paginas", type=int, default=80, help="páginas escaneadas por documento")
    ap.add_argument("--hilos", type=int, default=3)
    ap.add_argument("--modelo", default=None)
    ap.add_argument("--medir", action="store_true")
    ap.add_argument("--cola", choices=["bases", "cortos"], default="bases",
                    help="bases: las que esperan visión para su ficha; cortos: garantías, adicionales, resoluciones, desiertos")
    a = ap.parse_args()
    t0 = time.time()
    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        cur.execute(GASTADO)
        total = cur.fetchone()[0]
        if a.cola == "cortos":
            cur.execute(COLA_CORTOS, {"version": VERSION, "limite": 100000 if a.medir else a.limite, "tipos": list(CORTOS),
                                      "max_paginas": 25})
        else:
            cur.execute(COLA, {"version": VERSION, "limite": 100000 if a.medir else a.limite})
        cola = cur.fetchall()
        cn.commit()
        paginas_cola = 0
        for f in cola:
            try:
                paginas_cola += len(json.loads(f[6] or "{}").get("escaneadas") or [])
            except (ValueError, TypeError):
                pass
        print(f"{a.entorno}: {len(cola)} documentos en cola con {paginas_cola} páginas escaneadas; gastado USD {total:.2f} de {TOPE_TOTAL_USD}",
              flush=True)
        if a.medir or not cola or total >= TOPE_TOTAL_USD:
            return
        motor = MotorWorkers(a.modelo or MODELO_DEFECTO)
        gastado, hechos, paginas_ok, caracteres = 0.0, 0, 0, 0
        cuenta: dict[str, int] = {}
        with ThreadPoolExecutor(max_workers=a.hilos) as pool:
            pendientes = list(cola)
            futuros = {}
            while pendientes or futuros:
                while pendientes and len(futuros) < a.hilos and gastado < a.tope_usd and total + gastado < TOPE_TOTAL_USD:
                    f = pendientes.pop(0)
                    futuros[pool.submit(uno, motor, f, a.max_paginas)] = f
                if not futuros:
                    break
                listo = next(as_completed(futuros))
                f = futuros.pop(listo)
                try:
                    r = listo.result()
                except Exception as e:  # noqa: BLE001 — queda como error; no se anota para que se reintente
                    cuenta[f"error: {type(e).__name__}"] = cuenta.get(f"error: {type(e).__name__}", 0) + 1
                    continue
                textos, sha = r.pop("_textos"), r.pop("_sha")
                if textos:
                    paginas_ok += guardar_texto(cur, sha, textos, r["modelo"])
                    caracteres += sum(len(t) for t in textos.values())
                cur.execute(ANOTAR, r)
                cn.commit()
                gastado += float(r["costo_usd"] or 0)
                hechos += 1
                cuenta[r["estado"]] = cuenta.get(r["estado"], 0) + 1
                if hechos % 5 == 0:
                    print(f"  {hechos} documentos, {paginas_ok} páginas, USD {gastado:.3f} {cuenta} {round(time.time() - t0)} s", flush=True)
                if gastado >= a.tope_usd:
                    pendientes = []
    print(f"FIN transcripción: {hechos} documentos, {paginas_ok} páginas escritas ({caracteres} caracteres), USD {gastado:.3f} "
          f"(USD {gastado / max(paginas_ok, 1):.5f} por página), {cuenta}, {round(time.time() - t0)} s")


if __name__ == "__main__":
    main()
