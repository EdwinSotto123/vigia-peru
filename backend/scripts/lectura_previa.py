#!/usr/bin/env python3
"""LECTURA PREVIA: los documentos de un contrato leídos ENTEROS antes de analizarlo, con el mismo código del agente,
sin apuro y guardados donde el análisis los toma: el texto (documentos_texto) y la extracción ordenada (su caché).

  python -X utf8 backend/scripts/lectura_previa.py prod 1231921
  python -X utf8 backend/scripts/lectura_previa.py prod --archivo ocids.txt --tope-usd 5

Por qué (2026-11-24): el OCR y la extracción corrían DENTRO del análisis (una Lambda de 900 s) y con el límite de uso
de Workers AI lleno se perdían: en 7 días, 4 143 de 4 684 análisis perdieron parte de sus documentos y 3 387 terminaron
con uno o ningún ítem. En 1231921 el requerimiento (~40 ítems) estaba escaneado dentro del Word de un RAR, y con el
texto completo las bases (59 páginas) seguían sin caber en el plazo del lector («parse timeout»).

Cómo: corre la fase de documentos del agente (`seleccionar_documentos` + `parse_documentos_lote`: abrir ZIP/RAR/Word,
texto por página, extracción con el modelo de la Lambda) con un plazo de horas, y:
  · el OCR es LOCAL y abierto (Docling: RapidOCR + estructura de tablas), sin modelo de lenguaje ni límite de uso; el
    modelo de visión de Workers AI queda de respaldo para una página que Docling no lea;
  · el modelo de lenguaje sólo ORDENA el texto (ítems, montos, bloques), el mismo de la Lambda, para que su caché sirva.
El análisis encuentra todo hecho y no vuelve a leer. Un contrato queda COMPLETO si ningún documento quedó con páginas
sin leer, extracción fallida o fuera de plazo. El gasto (del acumulador del agente) va al libro como «lectura previa».
"""
from __future__ import annotations

try:   # torch antes que todo: en Windows, cargado después de otras librerías falla con WinError 1114 (Docling lo usa)
    import torch  # noqa: F401
except Exception:  # noqa: BLE001
    pass

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

import tunel_rds  # noqa: E402
from lector.base import bajar_r2, ssm  # noqa: E402

# ── Entorno de la Lambda (infrastructure/deploy/aws/agentes.sh), para que la caché de extracción sea la misma ──
for k, v in {
    "LLM_BACKEND": "compatible", "LLM_COMPAT_URL": "https://vigia-llm.vigiaperu.workers.dev/v1",
    "LLM_COMPAT_MODEL": "@cf/zai-org/glm-5.3-flash", "WORKERS_AI_REASONING": "low", "WORKERS_AI_SIN_RESPALDO": "1",
    "LLM_COMPAT_TIMEOUT_S": "180", "GOOGLE_CLOUD_PROJECT": "no-gcp", "ALMACEN_DOCS": "r2", "DOCAI_ENABLED": "0",
    # Sin apuro: el plazo del lector es de horas, sin tope de páginas de OCR, de a un documento.
    "PARSE_GLOBAL_BUDGET_S": "7200", "PARSE_OVERALL_TIMEOUT_S": "7200", "OCR_BUDGET_S": "3600",
    "OCR_DOC_BUDGET_S": "3600", "OCR_MAX_PAGINAS": "400", "OCR_PARALELO": "1", "OCR_DPI": "200",
    "PARSE_UNIT_WORKERS": "1", "PARSE_LOTE_WORKERS": "2",
}.items():
    os.environ.setdefault(k, v)
os.environ.setdefault("LLM_COMPAT_TOKEN", ssm("/vigia/llm/token"))

# ── La base por el túnel: el agente se conecta con PGHOST/PGPORT/… (tools/_core.py), así que se abre antes de importarlo ──
_TUNEL = tunel_rds.tunel(tunel_rds.BASES["prod"])
_HOST, _PUERTO = _TUNEL.__enter__()
os.environ.update({"PGHOST": _HOST, "PGPORT": str(_PUERTO), "PGUSER": tunel_rds.USUARIO, "PGDATABASE": "vigia",
                   "PGSSLMODE": "require",
                   "PGPASSWORD": tunel_rds._aws("ssm", "get-parameter", "--name",
                                                tunel_rds.CLAVES_CI["vigia-db"] if tunel_rds.USUARIO == "vigia_ci"
                                                else tunel_rds.CLAVES["vigia-db"], "--with-decryption",
                                                "--query", "Parameter.Value")})

from agents._shared import profiles  # noqa: E402
from tools import costo_llm  # noqa: E402
from tools._core import _pg  # noqa: E402
from tools.doc_select import seleccionar_documentos  # noqa: E402
from tools.documentos import contenedores as _cont  # noqa: E402
from tools.documentos import ocr_texto as _ocr  # noqa: E402
from tools.documentos import orquestacion as _orq  # noqa: E402
from tools.documentos._base import _perfil_params  # noqa: E402
from tools.documentos.lote import parse_documentos_lote  # noqa: E402

TIPOS = {"bienes": ["bienes"], "servicios": ["servicios"], "obras": ["obras"], "consultoria": ["consultoria"],
         "otros": ["convenio", "directa", "otro"]}   # como masivo_agentes.py: la red decide el perfil
# Lo que deja un documento sin leer entero: el contrato no queda COMPLETO.
_INCOMPLETO = {"ocr_gemini_vision", "ocr_tope_paginas", "ocr_tope_tiempo"}
_INCOMPLETO_LIMITE = {"error_documento", "fuera_de_plazo", "segunda_pasada_fallida", "descarga_fallida"}


def log(m: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}", flush=True)


# ── Los documentos, del almacén (R2), como el lector ──
def _bytes_de_doc(doc: dict, state: dict):
    if not doc.get("gs"):
        return None, "failed", "sin copia en el almacén"
    try:
        return bajar_r2(doc["gs"]), "r2", None
    except Exception as e:  # noqa: BLE001
        return None, "failed", f"{type(e).__name__}: {str(e)[:80]}"


_orq._bytes_de_doc = _bytes_de_doc

# ── RAR en Windows: `rarfile` con el tar del sistema no lee el contenido; se extrae con tar.exe (libarchive) ──
_TAR_WINDOWS = Path(r"C:\Windows\System32\tar.exe")


def _leer_rar_con_tar(blob: bytes) -> list[tuple[str, bytes]]:
    with tempfile.TemporaryDirectory() as d:
        arch, dest = Path(d) / "x.rar", Path(d) / "x"
        arch.write_bytes(blob)
        dest.mkdir()
        subprocess.run([str(_TAR_WINDOWS), "-xf", str(arch), "-C", str(dest)], check=True, capture_output=True, timeout=300)
        return [(f.relative_to(dest).as_posix(), f.read_bytes()) for f in sorted(dest.rglob("*")) if f.is_file()]


if os.name == "nt" and _TAR_WINDOWS.exists():
    _cont._leer_rar = _leer_rar_con_tar

# ── OCR abierto y local: Docling (RapidOCR + estructura de tablas). El modelo de visión, sólo de respaldo ──
_ocr_llm = _ocr._ocr_paginas_gemini
_conv: dict = {}
_conv_lock = threading.Lock()


def _convertidor():
    if "c" not in _conv:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions, TableFormerMode
        from docling.document_converter import DocumentConverter, ImageFormatOption
        op = PdfPipelineOptions()
        op.do_ocr = True
        op.do_table_structure = True
        op.table_structure_options.mode = TableFormerMode.ACCURATE
        op.table_structure_options.do_cell_matching = True
        op.images_scale = 2.0
        op.ocr_options = RapidOcrOptions(force_full_page_ocr=True, lang=["es"])
        _conv["c"] = DocumentConverter(format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=op)})
    return _conv["c"]


_FILA_ITEM = re.compile(r"^\|\s*(\d{1,3})\s*\|", re.M)


def numeracion_corregida(md: str) -> str:
    """En una tabla, un número de ítem que rompe la secuencia y al revés sí calza («07, 80, 09» → «08») era el OCR
    leyendo los dígitos invertidos. Sólo se corrige ese caso."""
    lineas = md.split("\n")
    nums = [(i, int(m.group(1)), m.group(1)) for i, l in enumerate(lineas) for m in [_FILA_ITEM.match(l)] if m]
    for k, (i, n, txt) in enumerate(nums):
        prev = nums[k - 1][1] if k > 0 else None
        if prev is None or n == prev + 1 or len(txt) != 2:
            continue
        if int(txt[::-1]) == prev + 1:
            lineas[i] = lineas[i].replace(txt, txt[::-1], 1)
            nums[k] = (i, int(txt[::-1]), txt[::-1])
    return "\n".join(lineas)


_stats = {"paginas": 0, "respaldo": 0}
_CANTIDAD_RARA = re.compile(r"\|\s*[^|\s]*[€$£¥@][^|]*\|")


def tabla_dudosa(md: str) -> bool:
    """¿La tabla de esta página salió mal? (1231921, comparado con el modelo de visión: Docling saltó filas, leyó «90»
    por 06 y «€0» por una cantidad, y dejó tablas grandes en un solo bloque). Dudosa si en alguna tabla los números de
    ítem no son correlativos (un salto o una repetición que no reinicia en 1), si una celda trae un símbolo de moneda
    suelto donde va una cantidad, o si hay ≥ 3 líneas que empiezan con un número de ítem fuera de toda tabla."""
    bloques, actual = [], []
    for l in md.split("\n"):
        if l.lstrip().startswith("|"):
            actual.append(l)
        elif actual:
            bloques.append(actual)
            actual = []
    if actual:
        bloques.append(actual)
    for b in bloques:
        nums = [int(m.group(1)) for l in b for m in [_FILA_ITEM.match(l.strip())] if m]
        for p, n in zip(nums, nums[1:]):
            if n != p + 1 and n != 1:
                return True
        if any(_CANTIDAD_RARA.search(l) for l in b):
            return True
    sueltas = [l for l in md.split("\n") if not l.lstrip().startswith("|") and re.match(r"^\s*\d{2}\s+[A-ZÁÉÍÓÚÑ]{3,}", l)]
    return len(sueltas) >= 3


def _ocr_docling(rendered: list[tuple[int, bytes]]) -> list[str]:
    from io import BytesIO

    from docling.datamodel.base_models import DocumentStream
    out: list[str] = []
    for idx, png in rendered:
        try:
            with _conv_lock:   # un convertidor, una página a la vez (usa todos los núcleos)
                r = _convertidor().convert(DocumentStream(name=f"p{idx}.png", stream=BytesIO(png)))
            out.append(numeracion_corregida(r.document.export_to_markdown()).strip())
        except Exception as e:  # noqa: BLE001
            log(f"[docling] página {idx}: {type(e).__name__}: {str(e)[:120]}")
            out.append("")
    # Las páginas que Docling no leyó o cuya tabla no pasa la validación van al modelo de visión (de respaldo).
    faltan = [k for k, t in enumerate(out) if len(t) < 40 or tabla_dudosa(t)]
    _stats["paginas"] += len(out)
    _stats["respaldo"] += len(faltan)
    if faltan:
        try:
            for k, t in zip(faltan, _ocr_llm([rendered[k] for k in faltan])):
                out[k] = t or out[k]
        except Exception as e:  # noqa: BLE001
            log(f"[docling] respaldo con el modelo falló: {str(e)[:120]}")
    return out


# El motor del OCR: «servicio» (vigia-ocr, Docling en un Cloudflare Container: el mismo que usa la Lambda), «docling»
# (Docling en esta PC) o «modelo» (el modelo de visión de Workers AI). El respaldo con el modelo para las páginas dudosas,
# sólo con OCR_RESPALDO_LLM=1 (Workers AI se cuida: 2026-11-24).
MOTOR_OCR = os.getenv("LECTURA_PREVIA_OCR", "servicio")
if MOTOR_OCR == "servicio":
    os.environ.setdefault("OCR_URL", "https://vigia-ocr.vigiaperu.workers.dev")
    os.environ.setdefault("OCR_TOKEN", ssm("/vigia/ocr/token"))
    os.environ["OCR_PARALELO"] = os.getenv("OCR_PARALELO_SERVICIO", "3")   # lotes a la vez: van a instancias distintas
    from tools.documentos import ocr_servicio as _srv
    _ocr_paginas_srv = _srv.ocr_paginas

    def _contar(rendered, fin, respaldo=None):
        out = _ocr_paginas_srv(rendered, fin, respaldo)
        _stats["paginas"] += len(out)
        return out

    _srv.ocr_paginas = _contar
elif MOTOR_OCR == "docling":
    os.environ.pop("OCR_URL", None)
    _ocr._ocr_paginas_gemini = _ocr_docling
else:
    os.environ.pop("OCR_URL", None)


# ── Un contrato ──
def leer_contrato(ocid: str, rehacer: bool, rehacer_texto: bool = False) -> dict:
    cn = _pg()
    try:
        cur = cn.cursor()
        cur.execute("SELECT ocds_payload::text, lower(tipo_contratacion) FROM convocatorias WHERE ocid = %s", (ocid,))
        fila = cur.fetchone()
        if not fila:
            return {"estado": "sin_convocatoria"}
        ocds = json.loads(fila[0]) if fila[0] else None
        red = next((r for r, tipos in TIPOS.items() if fila[1] in tipos), "otros")
        cur.execute("SELECT url_origen, url_gcs FROM documentos_vigentes(%s)", (ocid,))
        doc_urls = {u: g for u, g in cur.fetchall() if u and g}
        if rehacer_texto:   # el texto (y su extracción) se descarta: se vuelve a leer todo
            cur.execute("DELETE FROM documentos_texto WHERE ocid = %s", (ocid,))
            cn.commit()
        elif rehacer:       # sólo la extracción guardada
            cur.execute("UPDATE documentos_texto SET extraccion = NULL WHERE ocid = %s", (ocid,))
            cn.commit()
    finally:
        cn.close()
    state = {"ocid": ocid, "ocds": ocds or {}, "doc_urls": doc_urls, "perfil": profiles.get_profile(red), "recortes": [],
             "_parse_deadline": time.monotonic() + float(os.environ["PARSE_GLOBAL_BUDGET_S"])}
    bloque, prio, mx = _perfil_params(state)
    elegidos, omitidos = seleccionar_documentos(ocid, state["ocds"], doc_urls, prio, mx)
    t0 = time.monotonic()
    usd0 = costo_llm.resumen()["costo_usd"]
    # Lo que el registro publica y no está en el almacén (p. ej. las bases en RAR o Word que el descargador no bajaba hasta
    # el 2026-11-24): no se puede leer; queda como falta y se pide su descarga.
    sin_copia = [d for d in elegidos if not d.get("gs")]
    res = parse_documentos_lote(state, elegidos, parser_bloque=bloque, prioridad=prio)
    faltas = [f"{r.get('donde')}: {r.get('limite')}" for r in state["recortes"] if isinstance(r, dict)
              and (str(r.get("donde", "")).split(":")[0] in _INCOMPLETO or r.get("limite") in _INCOMPLETO_LIMITE)]
    faltas += [f"sin copia en el almacén: {d.get('titulo')} [{d.get('formato')}]" for d in sin_copia
               if not any(str(d.get("titulo")) in f for f in faltas)]
    items = (state.get("parser_raw_consolidated") or {}).get("items_consolidados") or []
    r = {"estado": "completo" if not faltas else "falta", "red": red, "docs": len(elegidos), "omitidos": len(omitidos),
         "ok": res.get("n_ok"), "items": len(items), "segundos": round(time.monotonic() - t0),
         "usd": round(costo_llm.resumen()["costo_usd"] - usd0, 4), "faltas": faltas[:8]}
    cn = _pg()
    try:
        cur = cn.cursor()
        cur.execute("""INSERT INTO lectura_previa (ocid, completo, documentos, omitidos, items, faltas, costo_usd, segundos, actualizado_at)
                       VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, now())
                       ON CONFLICT (ocid) DO UPDATE SET completo = EXCLUDED.completo, documentos = EXCLUDED.documentos,
                         omitidos = EXCLUDED.omitidos, items = EXCLUDED.items, faltas = EXCLUDED.faltas,
                         costo_usd = EXCLUDED.costo_usd, segundos = EXCLUDED.segundos, actualizado_at = now()""",
                    (ocid, not faltas, len(elegidos), len(omitidos), len(items), json.dumps(faltas, ensure_ascii=False), r["usd"], r["segundos"]))
        if sin_copia:
            cur.execute("""INSERT INTO pedidos_descarga (ocid, motivo) SELECT %s, 'lectura'
                            WHERE NOT EXISTS (SELECT 1 FROM pedidos_descarga WHERE ocid_corto(ocid) = ocid_corto(%s)
                                                AND estado IN ('pendiente', 'descargando'))""", (ocid, ocid))
            r["pedido_descarga"] = True
        cn.commit()
    finally:
        cn.close()
    return r


# Lo que el masivo tomaría (backend/scripts/masivo_agentes.py `candidatos`) y todavía no tiene su lectura previa completa.
CANDIDATOS_SQL = """
  WITH leidos AS (
    SELECT ocid, count(DISTINCT clase) FILTER (WHERE estado = 'ok' AND clase <> 'comite') AS docs,
           bool_or(clase = 'contrato' AND estado = 'ok') OR bool_or(clase = 'consultas' AND estado = 'ok') AS rico
      FROM documento_lectura GROUP BY ocid
    HAVING bool_or(clase = 'buena_pro' AND estado = 'ok') AND bool_or(clase = 'bases' AND estado = 'ok')),
  libro AS (
    SELECT ocid, bool_or(estado IN ('ok', 'en_vuelo')) AS tomado, count(*) FILTER (WHERE estado = 'error') AS fallas
      FROM agente_masivo WHERE ocid IS NOT NULL GROUP BY ocid)
  SELECT cv.ocid
    FROM convocatorias cv JOIN leidos l ON l.ocid = cv.ocid AND l.rico
    LEFT JOIN libro m ON m.ocid = cv.ocid
    LEFT JOIN lectura_previa lp ON lp.ocid = cv.ocid
   WHERE cv.procesable AND lower(cv.tipo_contratacion) = ANY(%s)
     AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.codigo = 'OECE-' || cv.ocid)
     AND NOT COALESCE(m.tomado, false) AND COALESCE(m.fallas, 0) < 2
     AND (lp.ocid IS NULL OR (NOT lp.completo AND lp.actualizado_at < now() - interval '1 day'))
   ORDER BY l.docs DESC, riesgo_contrato(cv.ocid) DESC NULLS LAST, cv.cuantia_referencial DESC NULLS LAST
   LIMIT %s"""


def candidatos(n: int, redes: list[str]) -> list[str]:
    tipos = [t for r in redes for t in TIPOS[r]]
    cn = _pg()
    try:
        cur = cn.cursor()
        cur.execute(CANDIDATOS_SQL, (tipos, n))
        return [f[0] for f in cur.fetchall()]
    finally:
        cn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Lectura previa de los documentos de unos contratos (texto + extracción).")
    ap.add_argument("entorno", choices=["prod"])
    ap.add_argument("ocids", nargs="*")
    ap.add_argument("--archivo")
    ap.add_argument("--tope-usd", type=float, default=5.0)
    ap.add_argument("--rehacer", action="store_true", help="descarta la extracción guardada y la vuelve a hacer")
    ap.add_argument("--rehacer-texto", action="store_true", help="también vuelve a leer el texto (OCR) de sus documentos")
    ap.add_argument("--candidatos", type=int, default=0, help="toma los N próximos contratos del masivo sin lectura previa completa")
    ap.add_argument("--redes", default="bienes,servicios,obras,consultoria,otros", help="redes para --candidatos")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ocids = list(dict.fromkeys(a.ocids + ([x.strip() for x in Path(a.archivo).read_text(encoding="utf-8").splitlines() if x.strip()]
                                          if a.archivo else [])))
    if a.candidatos:
        ocids += [o for o in candidatos(a.candidatos, [r.strip() for r in a.redes.split(",") if r.strip()]) if o not in ocids]
        log(f"{len(ocids)} contratos para la lectura previa")
    costo_llm.iniciar()
    completos = 0
    try:
        for ocid in ocids:
            gastado = costo_llm.resumen()["costo_usd"]
            if gastado >= a.tope_usd:
                log(f"[--] tope de US$ {a.tope_usd} alcanzado (US$ {gastado:.4f})")
                break
            try:
                r = leer_contrato(ocid, a.rehacer, a.rehacer_texto)
            except Exception as e:  # noqa: BLE001
                r = {"estado": "error", "error": f"{type(e).__name__}: {str(e)[:200]}"}
            completos += r["estado"] == "completo"
            log(f"[{r['estado'].upper():>10}] {ocid} " + " ".join(f"{k}={v}" for k, v in r.items() if k != "estado"))
    finally:
        tot = costo_llm.resumen()
        log(f"OCR ({MOTOR_OCR}): {_stats['paginas']} páginas, {_stats['respaldo']} al modelo de visión de respaldo")
        log(f"fin: {completos} de {len(ocids)} completos; US$ {tot['costo_usd']:.4f} en {tot['llamadas']} llamadas "
            f"({', '.join(f'{e['etapa']} {e['costo_usd']:.4f}' for e in tot['por_etapa'][:4])})")
        if tot["costo_usd"] > 0:
            try:
                cn = _pg()
                cn.cursor().execute(
                    "INSERT INTO agente_masivo (red, estado, costo, motivo, origen, terminado_en) "
                    "VALUES ('externo', 'externo', %s, %s, %s, now())",
                    (round(tot["costo_usd"], 4), f"lectura previa: {len(ocids)} contratos (OCR local con Docling, extracción con el modelo)",
                     f"lectura-previa-{time.strftime('%Y%m%d-%H%M')}"))
                cn.commit()
                cn.close()
            except Exception as e:  # noqa: BLE001
                log(f"[EXC] no pude anotar el gasto: {str(e)[:120]}")
        _TUNEL.__exit__(None, None, None)


if __name__ == "__main__":
    main()
