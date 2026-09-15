"""Tools del dominio: documentos.

Dos caminos conviven:
  · `parse_documentos_lote` / `parse_documentos_seleccionados` (WS D, 2026-09-15): selección
    determinista (tools/doc_select.py), OCR una sola vez por sha256 (tabla documentos_texto,
    páginas ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia verificable.
  · `list_documents` / `parse_document_pdf` (legacy, tool del LlmAgent): misma expansión de
    contenedores sin topes y mismo schema, pero por URL y sin caché entre corridas.
"""

from tools._core import *  # noqa: F401,F403


def _norm_txt(s: str) -> str:
    """MAYÚSCULAS sin tildes, espacios colapsados — para comparar descripciones."""
    import unicodedata
    s = " ".join((s or "").strip().upper().split())
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


_TIPOS_ADJUDICACION = ("acta", "buena_pro", "buena pro", "otorgamiento", "adjudic",
                       "evaluac", "calificac", "contrato", "orden de compra",
                       "orden_de_compra", "propuesta")


def _es_doc_de_adjudicacion(tipo: str) -> bool:
    """True si el `tipo_documento_detectado` corresponde a la etapa de ADJUDICACIÓN
    o CONTRATO (acta de buena pro, cuadro de evaluación, contrato/orden de compra).
    Solo esos documentos contienen comité, motivos de adjudicación y acta. Un
    Bases/TDR/EETT/Resumen es PRE-adjudicación: no existen ahí, y si el LLM los
    'rellenó', son inventados → se descartan (fix determinista, sin blocklist de
    nombres)."""
    t = (tipo or "").lower()
    return any(k in t for k in _TIPOS_ADJUDICACION)


def list_documents(ocid: str, tool_context: ToolContext) -> dict:
    """Lista los documentos publicados en SEACE para esta convocatoria.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con documents (lista con id, title, documentType, url,
        format, has_b64).
    """
    cr = tool_context.state.get("ocds") or {}
    docs_b64 = tool_context.state.get("docs_b64") or {}
    # Recolectar documentos de TODAS las etapas, no solo `tender`. El contrato
    # firmado (Orden de Compra) vive en `contracts.documents` y antes quedaba
    # invisible → nunca se parseaba (contrato_final salía null). Mapeo de etapa
    # para que el agente priorice (Bases/Resumen→Convocatoria, Acta→Adjudicación,
    # Contrato/garantía→Contrato).
    docs: list[dict] = []
    for stage in ("tender", "awards", "contracts"):
        node = cr.get(stage)
        arr = node if isinstance(node, list) else ([node] if node else [])
        for nd in arr:
            if isinstance(nd, dict):
                for d in (nd.get("documents") or []):
                    if isinstance(d, dict):
                        docs.append({**d, "_stage": stage})
    return {
        "n_documents": len(docs),
        "documents": [
            {
                "id": d.get("id"), "title": d.get("title"),
                "documentType": d.get("documentType"), "url": d.get("url"),
                "format": d.get("format"), "stage": d.get("_stage"),
                "has_b64_preloaded": d.get("url") in docs_b64,
            }
            for d in docs
        ],
        "_note": "La selección y el parseo en lote los hace parse_documentos_seleccionados (determinista).",
    }

def _item_key(it: dict):
    """Clave semántica para dedup de ítems (fix #1): descripción normalizada +
    cantidad. Evita que el MISMO ítem, numerado distinto en dos documentos
    ('2' vs '02', '1.0' vs '01'), sobreviva duplicado y duplique el trabajo del
    market agent. Devuelve None si no hay descripción ni número."""
    import unicodedata
    desc = (it.get("descripcion_corta") or it.get("descripcion") or "").strip().upper()
    desc = " ".join(desc.split())
    desc = "".join(c for c in unicodedata.normalize("NFKD", desc)
                   if not unicodedata.combining(c))
    if desc:
        req = (it.get("requerimiento_tecnico_detallado") or "").strip()
        # Cabeceras de objeto/agregador (SIN requerimiento): el mismo
        # "ADQUISICIÓN DE LLANTAS..." aparece como "ítem 1" en cada documento
        # (acta, reporte, contrato) → dedup por descripción SOLA para no
        # multiplicarlo. Ítems reales (con requerimiento) usan desc+cantidad
        # para no fusionar productos distintos del mismo rubro.
        return ("d", desc) if not req else ("d", desc, it.get("cantidad"))
    num = it.get("numero")
    if num is not None and str(num).strip():
        return ("n", str(num).strip())
    return None


def _analyze_pdf_layout(blob: bytes) -> dict:
    """Analiza la estructura de un PDF para detectar páginas cuyo contenido
    está rasterizado como imagen (es decir, el PDF tiene texto extraíble bajo,
    pero las páginas tienen imágenes grandes que cubren la mayoría del área).
    Estas páginas necesitan ser renderizadas a PNG y pasadas a Gemini Vision
    porque el OCR implícito del SDK sobre el bytestream del PDF muchas veces
    no recupera bien el contenido.

    Returns:
        {
          "n_pages": int,
          "needs_render_pages": [indices 0-based],
          "low_text_pages": [indices con <300 chars],
          "total_text_chars": int,
          "es_pdf_completamente_escaneado": bool,
        }
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        return {"error": f"pymupdf not available: {e}", "needs_render_pages": []}

    doc = fitz.open(stream=blob, filetype="pdf")
    needs_render: list[int] = []
    low_text: list[int] = []
    total_chars = 0
    n = len(doc)
    for i in range(n):
        page = doc[i]
        text = (page.get_text() or "").strip()
        n_chars = len(text)
        total_chars += n_chars
        if n_chars < 300:
            low_text.append(i)
        if n_chars >= 600:
            # página con texto suficiente — no requiere render
            continue
        # ¿hay imágenes cubriendo el área de la página?
        try:
            page_area = float(page.rect.width * page.rect.height) or 1.0
        except Exception:
            page_area = 1.0
        img_area = 0.0
        try:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    for r in page.get_image_rects(xref):
                        img_area += float(r.width * r.height)
                except Exception:
                    # algunas builds no exponen image_rects con xref
                    pass
        except Exception:
            pass
        ratio = img_area / page_area if page_area else 0.0
        if ratio > 0.25:
            needs_render.append(i)
    es_escaneado = len(low_text) >= max(3, int(0.7 * n))
    doc.close()
    return {
        "n_pages": n,
        "needs_render_pages": needs_render,
        "low_text_pages": low_text,
        "total_text_chars": total_chars,
        "es_pdf_completamente_escaneado": es_escaneado,
    }

def _render_pdf_pages_to_png(
    blob: bytes, page_indices: list[int], dpi: int = 160,
) -> list[tuple[int, bytes]]:
    """Renderiza páginas específicas de un PDF a PNG bytes.

    Args:
        blob: bytes del PDF.
        page_indices: lista de índices 0-based de páginas a renderizar.
        dpi: resolución de render. 160 DPI = ~1300x1700 px en página A4, balance
             OCR vs tamaño.

    Returns:
        Lista de tuples (page_index_0based, png_bytes).
    """
    try:
        import fitz
    except Exception:
        return []
    doc = fitz.open(stream=blob, filetype="pdf")
    out: list[tuple[int, bytes]] = []
    try:
        for i in page_indices:
            if i < 0 or i >= len(doc):
                continue
            try:
                pix = doc[i].get_pixmap(dpi=dpi)
                out.append((i, pix.tobytes("png")))
            except Exception:
                continue
    finally:
        doc.close()
    return out

# ── Page-sharding: parte un PDF grande en sub-PDFs por rango de páginas ──
# Cada shard se procesa con su propia llamada Gemini (más chica, más rápida y
# sin riesgo de truncar el JSON), en paralelo (acotado por _throttle_gemini), y
# el merge de parse_document_pdf consolida items/firmantes/etc. por número.
PARSE_PAGES_PER_SHARD = int(os.getenv("PARSE_PAGES_PER_SHARD", "12"))
PARSE_SHARD_THRESHOLD = int(os.getenv("PARSE_SHARD_THRESHOLD", "16"))
PARSE_MAX_WORKERS = int(os.getenv("PARSE_MAX_WORKERS", "4"))
# Timeout por-llamada Gemini (ms): ninguna extracción de un shard puede colgarse
# más de esto. Visto en prod: una sola llamada de 7m36s congelaba toda la corrida.
PARSE_CALL_TIMEOUT_MS = int(os.getenv("PARSE_CALL_TIMEOUT_MS", "120000"))
# Techo POR-DOCUMENTO (s): una sola llamada a parse_document_pdf devuelve dentro
# de este presupuesto; los shards que no terminaron se marcan como timeout.
PARSE_OVERALL_TIMEOUT_S = int(os.getenv("PARSE_OVERALL_TIMEOUT_S", "600"))
# Techo GLOBAL del parser (s) across TODA la corrida: el primer parse_document_pdf
# fija un deadline compartido en state; cada documento respeta lo que queda. Así la
# SUMA de todos los PDFs no se come el wall de Cloud Run (1800s) y siempre se llega
# al writer + persist + force_flush. Debe dejar margen para el resto del pipeline.
PARSE_GLOBAL_BUDGET_S = int(os.getenv("PARSE_GLOBAL_BUDGET_S", "700"))


def _split_pdf_by_pages(blob: bytes, label: str,
                        pages_per_shard: int = PARSE_PAGES_PER_SHARD,
                        threshold: int = PARSE_SHARD_THRESHOLD,
                        overlap: int = 1) -> list[tuple[str, bytes]]:
    """Si el PDF supera `threshold` páginas, lo parte en sub-PDFs de
    ~`pages_per_shard` páginas (con `overlap` págs de solape para no cortar un
    ítem a la mitad). Devuelve [(label, blob)] tal cual si es chico o si falla."""
    try:
        import fitz
        src = fitz.open(stream=blob, filetype="pdf")
        n = src.page_count
        if n <= threshold:
            src.close()
            return [(label, blob)]
        shards: list[tuple[str, bytes]] = []
        for start in range(0, n, pages_per_shard):
            a = max(0, start - overlap)
            b = min(n - 1, start + pages_per_shard - 1)
            dst = fitz.open()
            dst.insert_pdf(src, from_page=a, to_page=b)
            shards.append((f"{label} [pp.{a + 1}-{b + 1}/{n}]", dst.tobytes()))
            dst.close()
            if b >= n - 1:
                break
        src.close()
        print(json.dumps({"pdf_sharded": label[:80], "n_pages": n, "n_shards": len(shards)}), flush=True)
        return shards or [(label, blob)]
    except Exception as e:
        print(json.dumps({"pdf_shard_error": str(e)[:160], "label": label[:80]}), flush=True)
        return [(label, blob)]


# ═══════════════════════════════════════════════════════════════════════════════
# Parser en LOTE (WS D · plan 2026-09-15): documentos elegidos de forma determinista
# (tools/doc_select.py), OCR UNA sola vez por sha256 (tabla documentos_texto, páginas con
# marcador ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia
# {documento_sha256, pagina, cita} por ítem/firmante/postor/comité/motivo. Ningún tope es
# silencioso: cada recorte va a state['recortes'] = [{donde, limite, omitido}].
# ═══════════════════════════════════════════════════════════════════════════════
import hashlib as _hashlib
import subprocess as _subprocess
import tempfile as _tempfile

from tools.doc_select import (  # noqa: F401  (re-exportado vía `from tools import *`)
    seleccionar_documentos, rank_documento, recorte_seleccion, PRIORIDAD_DEFAULT, MAX_DOCS_DEFAULT,
)

# Versión del extractor de TEXTO (OCR + layout + marcadores). Cambiarla invalida la caché
# de `documentos_texto` (se vuelve a hacer OCR). La extracción estructurada se cachea
# aparte por (bloque, PARSER_SCHEMA_VERSION, modelo) dentro de `extraccion` JSONB.
VERSION_PARSER = os.getenv("PARSER_TEXT_VERSION", "texto-v1")
PARSER_SCHEMA_VERSION = os.getenv("PARSER_SCHEMA_VERSION", "schema-v2")
# Chars de texto OCR por llamada Gemini (≈ 150K tokens). Documentos más largos se parten
# por páginas en varias llamadas y se fusionan — no se omite nada.
PARSE_MAX_CHARS_POR_LLAMADA = int(os.getenv("PARSE_MAX_CHARS_POR_LLAMADA", "600000"))
PARSE_LOTE_WORKERS = int(os.getenv("PARSE_LOTE_WORKERS", "3"))
PARSE_REUSE_EXTRACCION = os.getenv("PARSE_REUSE_EXTRACCION", "1") != "0"
TEXTO_LITERAL_MAX = 4000
CITA_MAX = 240

_BLOQUES_VALIDOS = ("servicio", "obra", "sustento_directa")
_IMG_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp")


# ── Schema del parser: base + bloque del perfil ────────────────────────────────────────
def _schema_evidencia(desc: str = "") -> "gtypes.Schema":
    from google.genai import types as gtypes
    return gtypes.Schema(
        type=gtypes.Type.ARRAY,
        description=(desc or "Respaldo LITERAL de este dato en el documento: "
                     "`pagina` = número N del marcador ⟦p.N⟧ donde aparece; `cita` = fragmento "
                     f"textual copiado tal cual (≤ {CITA_MAX} chars). Sin evidencia el dato NO se persiste."),
        items=gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "pagina": gtypes.Schema(type=gtypes.Type.INTEGER, nullable=True),
                "cita": gtypes.Schema(type=gtypes.Type.STRING),
            },
            required=["cita"],
        ),
    )


def _schema_bloque(bloque: str | None) -> "gtypes.Schema | None":
    """Bloque extra del schema según `parser_bloque` del perfil (§4.2 de la auditoría)."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    if not bloque:
        return None
    if bloque == "servicio":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para Términos de Referencia / Bases de un SERVICIO o CONSULTORÍA: la unidad de "
            "análisis es el entregable/actividad y la tarifa (HH, mes, visita, km), no un bien físico. "
            "Dejá null si el documento no describe un servicio."),
            properties={
                "alcance": S(type=T.STRING, nullable=True, description="Alcance del servicio, LITERAL (≤ 1500 chars)."),
                "actividades": S(type=T.ARRAY, items=S(type=T.STRING), description="Actividades/tareas exigidas, literales."),
                "entregables": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "nombre": S(type=T.STRING), "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "porcentaje_pago": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["nombre"])),
                "plazo_total_dias": S(type=T.INTEGER, nullable=True),
                "personal_clave": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "cargo": S(type=T.STRING), "profesion": S(type=T.STRING, nullable=True),
                    "experiencia_min_anios": S(type=T.NUMBER, nullable=True),
                    "dedicacion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["cargo"])),
                "experiencia_postor": S(type=T.OBJECT, nullable=True, properties={
                    "monto_facturado_min": S(type=T.NUMBER, nullable=True),
                    "n_contratos": S(type=T.INTEGER, nullable=True),
                    "rubro": S(type=T.STRING, nullable=True)}),
                "tarifas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "concepto": S(type=T.STRING), "unidad": S(type=T.STRING, nullable=True),
                    "precio_unitario": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["concepto"])),
                "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "tipo": S(type=T.STRING), "formula": S(type=T.STRING, nullable=True),
                    "tope_pct": S(type=T.NUMBER, nullable=True)}, required=["tipo"])),
                "subcontratacion_permitida": S(type=T.BOOLEAN, nullable=True),
                "forma_pago": S(type=T.STRING, nullable=True),
                "lugar_prestacion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "obra":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para OBRAS: expediente técnico, presupuesto y ejecución (adicionales, ampliaciones, "
            "valorizaciones). Dejá null si el documento no es de una obra."),
            properties={
                "expediente_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "memoria": S(type=T.STRING, nullable=True, description="Memoria descriptiva, LITERAL (≤ 1500 chars)."),
                    "presupuesto_total": S(type=T.NUMBER, nullable=True),
                    "partidas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "codigo": S(type=T.STRING, nullable=True), "descripcion": S(type=T.STRING),
                        "metrado": S(type=T.NUMBER, nullable=True), "unidad": S(type=T.STRING, nullable=True),
                        "precio_unitario": S(type=T.NUMBER, nullable=True), "parcial": S(type=T.NUMBER, nullable=True),
                        "pagina": S(type=T.INTEGER, nullable=True)}, required=["descripcion"])),
                    "gastos_generales_pct": S(type=T.NUMBER, nullable=True),
                    "utilidad_pct": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "cronograma": S(type=T.STRING, nullable=True)}),
                "residente_requisitos": S(type=T.STRING, nullable=True),
                "supervisor_requisitos": S(type=T.STRING, nullable=True),
                "garantia_fiel_cumplimiento": S(type=T.STRING, nullable=True),
                "adelantos": S(type=T.STRING, nullable=True),
                "adicionales": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True),
                    "pct_acumulado": S(type=T.NUMBER, nullable=True), "motivo": S(type=T.STRING, nullable=True),
                    "resolucion": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "ampliaciones_plazo": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "dias": S(type=T.INTEGER, nullable=True),
                    "motivo": S(type=T.STRING, nullable=True), "resolucion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "valorizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "periodo": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "sustento_directa":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para contratación DIRECTA / convenio / consultoría por causal: la causal invocada y el "
            "expediente que la sustenta (informes, acto aprobatorio, cotizaciones). Dejá null si el "
            "documento no sustenta una directa ni es un convenio."),
            properties={
                "causal_articulo": S(type=T.STRING, nullable=True, description="Artículo/literal invocado, LITERAL."),
                "causal_texto": S(type=T.STRING, nullable=True, description="Fundamento textual de la causal (≤ 1500 chars)."),
                "informe_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "informe_legal": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "acto_aprobatorio": S(type=T.OBJECT, nullable=True, properties={
                    "tipo": S(type=T.STRING, nullable=True, description="resolución de alcaldía / acuerdo de concejo / resolución ejecutiva regional / …"),
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}),
                "cotizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "proveedor": S(type=T.STRING), "ruc": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["proveedor"])),
                "proveedor_unico_justificacion": S(type=T.STRING, nullable=True),
                "fecha_publicacion_seace": S(type=T.STRING, nullable=True),
                "convenio": S(type=T.OBJECT, nullable=True, properties={
                    "entidades_parte": S(type=T.ARRAY, items=S(type=T.STRING)),
                    "objeto": S(type=T.STRING, nullable=True), "aportes": S(type=T.STRING, nullable=True),
                    "vigencia": S(type=T.STRING, nullable=True)}),
                "evidencia": _schema_evidencia(),
            })
    raise ValueError(f"parser_bloque desconocido: {bloque!r} (válidos: {_BLOQUES_VALIDOS})")


def _parser_schema(bloque: str | None = None) -> "gtypes.Schema":
    """Schema de extracción: base (ítems, postores, firmantes, comité, motivos, estudio de
    mercado, contrato final) + bloque del perfil. Cada ítem/firmante/postor/comité/motivo
    lleva `evidencia: [{pagina, cita}]`; el requerimiento va LITERAL en `texto_literal`."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    props = {
        "cuantia_total": S(type=T.NUMBER, nullable=True),
        "fuente_financiamiento": S(type=T.STRING, nullable=True),
        "modalidad": S(type=T.STRING, nullable=True),
        "tipo_documento_detectado": S(
            type=T.STRING, nullable=True,
            description=(
                "Tipo de documento OECE detectado a partir del contenido: "
                "bases_administrativas, bases_integradas, terminos_de_referencia, expediente_tecnico, "
                "resumen_ejecutivo, informe_sustento, acta_buena_pro, cuadro_evaluacion, contrato, "
                "orden_de_compra, adenda, propuesta_economica, absolucion_consultas, otro."
            ),
        ),
        "contiene_requerimiento": S(
            type=T.BOOLEAN, nullable=True,
            description=(
                "True si en este documento aparece la sección 'REQUERIMIENTO' / 'Términos de "
                "Referencia' / 'Especificaciones Técnicas' / 'Expediente técnico' con detalle técnico."
            ),
        ),
        "items": S(
            type=T.ARRAY,
            items=S(
                type=T.OBJECT,
                properties={
                    "numero": S(type=T.STRING, nullable=True,
                        description="Número del ítem como string: '1', '1.1', '2'. Sub-numeración con punto si el OCDS agrupa varios productos en un ítem."),
                    "padre_ocds_item": S(type=T.STRING, nullable=True,
                        description="Si es desglose de un ítem padre del OCDS, número del padre."),
                    "descripcion_corta": S(type=T.STRING, description="TÍTULO del ítem tal como aparece (1 línea, ≤200 chars)."),
                    "cantidad": S(type=T.NUMBER, nullable=True),
                    "unidad": S(type=T.STRING, nullable=True, description="UND, KG, M3, LITRO, SACO, MES, HH, SERVICIO, etc."),
                    "precio_unitario_referencial": S(type=T.NUMBER, nullable=True),
                    "cuantia_referencial_item": S(type=T.NUMBER, nullable=True),
                    "marca_o_modelo_exigido": S(type=T.STRING, nullable=True,
                        description="Texto exacto de marca/modelo cuando aparece ('o similar' incluido). Null si genérico o no aplica."),
                    "certificaciones_exigidas": S(type=T.ARRAY, items=S(type=T.STRING),
                        description="Normas/certificaciones exigidas, cada string LITERAL (≤80 chars)."),
                    "valores_tecnicos_clave": S(type=T.OBJECT, nullable=True,
                        description="Valores numéricos discretos del requerimiento. Solo los que aparezcan.",
                        properties={
                            "potencia_min_hp": S(type=T.NUMBER, nullable=True),
                            "potencia_min_kw": S(type=T.NUMBER, nullable=True),
                            "capacidad_volumen": S(type=T.STRING, nullable=True),
                            "capacidad_carga_ton": S(type=T.NUMBER, nullable=True),
                            "peso_operativo_ton": S(type=T.STRING, nullable=True),
                            "alcance_m": S(type=T.NUMBER, nullable=True),
                            "ano_fabricacion_min": S(type=T.INTEGER, nullable=True),
                            "estado": S(type=T.STRING, nullable=True),
                            "presentacion": S(type=T.STRING, nullable=True),
                            "color": S(type=T.STRING, nullable=True),
                            "material": S(type=T.STRING, nullable=True),
                        }),
                    "garantia": S(type=T.OBJECT, nullable=True, properties={
                        "meses": S(type=T.INTEGER, nullable=True), "horas": S(type=T.INTEGER, nullable=True),
                        "alcance": S(type=T.STRING, nullable=True)}),
                    "condiciones_entrega": S(type=T.OBJECT, nullable=True, properties={
                        "plazo_dias_calendario": S(type=T.INTEGER, nullable=True),
                        "lugar_entrega": S(type=T.STRING, nullable=True),
                        "modalidad": S(type=T.STRING, nullable=True)}),
                    "requisitos_postor": S(type=T.OBJECT, nullable=True,
                        description="Requisitos al postor (no al bien/servicio).",
                        properties={
                            "experiencia_minima_soles": S(type=T.NUMBER, nullable=True),
                            "anos_experiencia_min": S(type=T.NUMBER, nullable=True),
                            "n_contratos_similares": S(type=T.INTEGER, nullable=True),
                            "certificaciones_postor": S(type=T.ARRAY, items=S(type=T.STRING)),
                            "infraestructura_exigida": S(type=T.STRING, nullable=True),
                            "personal_clave": S(type=T.ARRAY, items=S(type=T.STRING)),
                        }),
                    "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "causal": S(type=T.STRING), "monto_o_porcentaje": S(type=T.STRING, nullable=True),
                        "base_calculo": S(type=T.STRING, nullable=True)}, required=["causal"])),
                    "subitems": S(type=T.ARRAY,
                        description="Si el ítem es un PAQUETE/LOTE/CANASTA con N productos distintos, listalos acá.",
                        items=S(type=T.OBJECT, properties={
                            "descripcion": S(type=T.STRING), "cantidad": S(type=T.NUMBER, nullable=True),
                            "unidad": S(type=T.STRING, nullable=True), "presentacion": S(type=T.STRING, nullable=True),
                            "specs_clave": S(type=T.STRING, nullable=True)}, required=["descripcion"])),
                    "texto_literal": S(type=T.STRING, nullable=True,
                        description=(
                            f"EXTRACTO LITERAL (copiado tal cual, SIN resumir ni reescribir) del requerimiento "
                            "técnico de este ítem: especificaciones, normas, garantía, plazo, requisitos del postor. "
                            f"Copiá el requerimiento COMPLETO hasta agotar los {TEXTO_LITERAL_MAX} chars (no elijas un "
                            "fragmento corto: si hay 3 páginas de especificaciones, transcribí las 3 hasta el tope). "
                            "Si es más largo que el tope, copiá desde el inicio y declará en `texto_literal_paginas` "
                            "TODAS las páginas que abarca. Null si el documento no tiene requerimiento para este ítem."
                        )),
                    "texto_literal_paginas": S(type=T.ARRAY, items=S(type=T.INTEGER),
                        description="Páginas (N de ⟦p.N⟧) donde vive el requerimiento de este ítem."),
                    "evidencia": _schema_evidencia(),
                },
                required=["descripcion_corta"],
            ),
        ),
        "postores": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
            "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING),
            "monto_oferta": S(type=T.NUMBER, nullable=True), "es_ganador": S(type=T.BOOLEAN, nullable=True),
            "item": S(type=T.STRING, nullable=True), "evidencia": _schema_evidencia()},
            required=["razon_social"])),
        "firmantes": S(type=T.ARRAY,
            description="Personas que FIRMAN el documento (actas, cuadros, contratos). Solo con DNI, entidad real o firma visible.",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "dni": S(type=T.STRING, nullable=True),
                "cargo": S(type=T.STRING, nullable=True), "rol_en_documento": S(type=T.STRING, nullable=True),
                "entidad": S(type=T.STRING, nullable=True), "fecha_firma": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "comite_evaluacion": S(type=T.ARRAY,
            description="Composición del Comité de Selección si el documento lo lista (solo actas/cuadros/contratos).",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "cargo": S(type=T.STRING, nullable=True),
                "rol": S(type=T.STRING, nullable=True), "certificacion_sican": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "motivos_adjudicacion": S(type=T.ARRAY,
            description="Para cada ganador, el motivo documentado en el acta/reporte de buena pro.",
            items=S(type=T.OBJECT, properties={
                "ganador_razon_social": S(type=T.STRING), "ganador_ruc": S(type=T.STRING, nullable=True),
                "item_adjudicado": S(type=T.STRING, nullable=True), "criterio_decisivo": S(type=T.STRING, nullable=True),
                "posicion_ranking": S(type=T.INTEGER, nullable=True),
                "observaciones_evaluacion": S(type=T.STRING, nullable=True),
                "competidores_descalificados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia()}, required=["ganador_razon_social"])),
        "lugar_fecha_acta": S(type=T.OBJECT, nullable=True, properties={
            "lugar": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
            "hora": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
        "fundamento_legal": S(type=T.ARRAY, items=S(type=T.STRING),
            description="Normas/artículos citados LITERALMENTE por el documento."),
        "estudio_mercado": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es un Resumen Ejecutivo / Informe que sustenta la contratación: estudio de mercado y causal. Si no, null.",
            properties={
                "resumen": S(type=T.STRING, nullable=True),
                "valor_referencial": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "comparacion_precio_historico": S(type=T.STRING, nullable=True),
                "causal_articulo": S(type=T.STRING, nullable=True),
                "causal_texto": S(type=T.STRING, nullable=True),
                "proveedores_evaluados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "descalificaciones": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia(),
            }),
        "contrato_final": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es la ORDEN DE COMPRA/SERVICIO o el CONTRATO firmado: condiciones finales. Si no, null.",
            properties={
                "precio_final_total": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "cronograma_entregas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "descripcion": S(type=T.STRING, nullable=True), "cantidad": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True)})),
                "penalidades": S(type=T.ARRAY, items=S(type=T.STRING)),
                "forma_pago": S(type=T.STRING, nullable=True),
                "proveedor_ruc": S(type=T.STRING, nullable=True),
                "plazo_ejecucion_dias": S(type=T.INTEGER, nullable=True),
                "fecha_suscripcion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            }),
        "resumen": S(type=T.STRING, nullable=True, description="3-4 líneas describiendo el documento REAL."),
    }
    if bloque:
        props[bloque] = _schema_bloque(bloque)
    return S(type=T.OBJECT, properties=props)


# ── Contenedores: ZIP / RAR / DOCX / XLSX / DOC / imágenes → unidades de texto ────────
def _sha256_hex(blob: bytes) -> str:
    return _hashlib.sha256(blob).hexdigest()


def _unidad(nombre: str, kind: str, data=None, paginas=None) -> dict:
    """kind ∈ {'pdf' (data=bytes), 'paginas' (paginas=[{texto}] ya extraídas), 'imagenes' (data=pdf sintético)}."""
    return {"nombre": nombre, "kind": kind, "data": data, "paginas": paginas}


def _paginar_texto(texto: str, max_chars: int = 4500) -> list[str]:
    t = (texto or "").strip()
    if not t:
        return []
    return [t[i:i + max_chars] for i in range(0, len(t), max_chars)]


def _docx_a_unidades(blob: bytes, nombre: str) -> list[dict]:
    """DOCX → páginas de texto (párrafos + tablas, python-docx) + una unidad 'imagenes'
    (PDF sintético con las imágenes embebidas) para OCR. Sin pasar el texto por Document AI."""
    out: list[dict] = []
    text_chunks: list[str] = []
    try:
        from docx import Document
        d = Document(io.BytesIO(blob))
        for para in d.paragraphs:
            t = (para.text or "").strip()
            if t:
                text_chunks.append(t)
        for tbl in d.tables:
            for row in tbl.rows:
                cells = [(c.text or "").strip() for c in row.cells]
                line = " | ".join(c for c in cells if c)
                if line.strip(" |"):
                    text_chunks.append(line)
    except Exception as e:
        print(f"[lote] python-docx falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
    pags = _paginar_texto("\n".join(text_chunks))
    if pags:
        out.append(_unidad(nombre, "paginas", paginas=[{"texto": p} for p in pags]))
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():
                if name.startswith("word/media/") and name.lower().endswith(_IMG_EXTS):
                    try:
                        images.append((name, z.read(name)))
                    except Exception:
                        continue
    except Exception:
        pass
    if images:
        synth = _images_to_synthetic_pdf(images)
        if synth:
            out.append(_unidad(f"{nombre} (imágenes embebidas)", "imagenes", data=synth))
    return out


def _xlsx_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """XLSX → una página por hoja (filas ' | '); requiere openpyxl (si falta → recorte)."""
    try:
        import openpyxl
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (openpyxl no instalado)"}]
    try:
        wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xlsx_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]
    paginas: list[dict] = []
    for ws in wb.worksheets:
        lines = []
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v).strip() for v in row]
            if any(cells):
                lines.append(" | ".join(cells).rstrip(" |"))
        txt = f"[hoja: {ws.title}]\n" + "\n".join(lines)
        for chunk in _paginar_texto(txt, 12000):
            paginas.append({"texto": chunk})
    return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []


def _xls_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    try:
        import xlrd  # type: ignore
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.xls: xlrd no instalado)"}]
    try:
        wb = xlrd.open_workbook(file_contents=blob)
        paginas = []
        for sh in wb.sheets():
            lines = []
            for r in range(sh.nrows):
                cells = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                if any(cells):
                    lines.append(" | ".join(cells).rstrip(" |"))
            for chunk in _paginar_texto(f"[hoja: {sh.name}]\n" + "\n".join(lines), 12000):
                paginas.append({"texto": chunk})
        return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xls_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _doc_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """`.doc` legado → texto con `antiword` si está en PATH (no está en la imagen de Cloud
    Run por defecto); si no, recorte formato_no_soportado."""
    import shutil
    tool = shutil.which("antiword")
    if not tool:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.doc: antiword no disponible)"}]
    try:
        with _tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tf:
            tf.write(blob)
            path = tf.name
        try:
            res = _subprocess.run([tool, "-t", path], capture_output=True, timeout=60)
            txt = res.stdout.decode("utf-8", errors="replace")
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass
        pags = [{"texto": p} for p in _paginar_texto(txt)]
        if not pags:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_sin_texto", "omitido": nombre}]
        return [_unidad(nombre, "paginas", paginas=pags)], []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _leer_rar(blob: bytes) -> list[tuple[str, bytes]]:
    """Lista [(nombre, bytes)] de un RAR con `rarfile` (backends unar/bsdtar/7z/unrar)."""
    import rarfile
    with _tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tf:
        tf.write(blob)
        rar_path = tf.name
    out: list[tuple[str, bytes]] = []
    try:
        with rarfile.RarFile(rar_path) as rf:
            for info in rf.infolist():
                if info.is_dir():
                    continue
                try:
                    out.append((info.filename, rf.read(info)))
                except Exception as e:
                    out.append((info.filename, b""))
                    print(f"[lote] rar: no pude leer {info.filename[:60]}: {str(e)[:80]}", flush=True)
    finally:
        try:
            os.unlink(rar_path)
        except Exception:
            pass
    return out


def _expandir_contenedor(blob: bytes, nombre: str, prioridad: tuple[str, ...] | None = None,
                         depth: int = 0) -> tuple[list[dict], list[dict]]:
    """Blob de cualquier formato → (unidades de texto, recortes). SIN topes de cantidad: un ZIP
    con 9 PDFs produce 9 unidades ordenadas por la prioridad del perfil (título del archivo),
    no por `namelist()`. Lo que no se puede abrir (7z, .doc sin antiword, PDF cifrado, RAR
    sin backend) queda como recorte `formato_no_soportado` / `*_ilegible` — nunca en silencio."""
    recortes: list[dict] = []
    unidades: list[dict] = []
    if not blob:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "vacio", "omitido": nombre}]
    if depth > 3:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "profundidad_zip>3", "omitido": nombre}]
    low = nombre.lower()
    head = blob[:8]

    def _hijos(entries: list[tuple[str, bytes]], prefix: str) -> None:
        # Orden determinista: prioridad del perfil sobre el nombre del archivo, luego nombre.
        ranked = sorted(entries, key=lambda e: (rank_documento(e[0], None, prioridad or PRIORIDAD_DEFAULT)[0],
                                                e[0].lower()))
        imgs: list[tuple[str, bytes]] = []
        for name, data in ranked:
            base = name.rsplit("/", 1)[-1]
            if not base or name.endswith("/"):
                continue
            if base.lower().endswith(_IMG_EXTS):
                imgs.append((name, data))
                continue
            u, r = _expandir_contenedor(data, f"{prefix}{name}", prioridad, depth + 1)
            unidades.extend(u)
            recortes.extend(r)
        if imgs:
            synth = _images_to_synthetic_pdf(imgs)
            if synth:
                unidades.append(_unidad(f"{prefix}{len(imgs)} imágenes (escaneo→PDF)", "imagenes", data=synth))
            else:
                recortes.append({"donde": f"contenedor:{prefix[:80]}", "limite": "imagenes_ilegibles",
                                 "omitido": [n for n, _ in imgs][:20]})

    if head[:4] == b"Rar!":
        try:
            entries = _leer_rar(blob)
        except Exception as e:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "rar_no_extraible",
                         "omitido": f"{nombre} ({type(e).__name__}: {str(e)[:100]})"}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:2] == b"PK":
        if _is_docx_blob(blob):
            return _docx_a_unidades(blob, nombre), []
        if low.endswith(".xlsx") or _es_xlsx_blob(blob):
            return _xlsx_a_unidades(blob, nombre)
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                entries = []
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    try:
                        entries.append((info.filename, z.read(info)))
                    except Exception as e:
                        recortes.append({"donde": f"contenedor:{nombre[:80]}", "limite": "zip_entrada_ilegible",
                                         "omitido": f"{info.filename} ({str(e)[:60]})"})
        except zipfile.BadZipFile:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "zip_corrupto", "omitido": nombre}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:4] == b"%PDF":
        try:
            import fitz
            d = fitz.open(stream=blob, filetype="pdf")
            if d.is_encrypted and not d.authenticate(""):
                d.close()
                return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "pdf_cifrado", "omitido": nombre}]
            d.close()
        except Exception:
            pass
        return [_unidad(nombre, "pdf", data=blob)], []
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado", "omitido": f"{nombre} (.7z)"}]
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # OLE2: .doc / .xls
        if low.endswith(".xls"):
            return _xls_a_unidades(blob, nombre)
        return _doc_a_unidades(blob, nombre)
    if low.endswith(_IMG_EXTS) or head[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"II*\x00", b"MM\x00*"):
        synth = _images_to_synthetic_pdf([(nombre, blob)])
        if synth:
            return [_unidad(nombre, "imagenes", data=synth)], []
    if low.endswith((".txt", ".csv", ".md")):
        try:
            txt = blob.decode("utf-8", errors="replace")
            return [_unidad(nombre, "paginas", paginas=[{"texto": p} for p in _paginar_texto(txt)])], []
        except Exception:
            pass
    return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                 "omitido": f"{nombre} (bytes {blob[:4].hex()}, {len(blob)} B)"}]


def _es_xlsx_blob(blob: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            return any(n == "xl/workbook.xml" for n in z.namelist())
    except Exception:
        return False


# ── Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas) ──
def _paginas_pymupdf(pdf: bytes, page_offset: int) -> tuple[list[dict], list[dict]]:
    """Fallback sin Document AI: texto extraíble por página; las páginas rasterizadas
    (texto < 300 chars con imagen > 25 % del área) se transcriben con Gemini Vision en
    lotes de ≤ 8 PNGs. Devuelve (paginas, recortes)."""
    import fitz
    recortes: list[dict] = []
    layout = _analyze_pdf_layout(pdf)
    d = fitz.open(stream=pdf, filetype="pdf")
    paginas: list[dict] = []
    try:
        for i in range(len(d)):
            t = (d[i].get_text() or "").strip()
            paginas.append({"n": page_offset + i + 1, "texto": t, "chars": len(t)})
    finally:
        d.close()
    need = list(layout.get("needs_render_pages") or [])
    if need:
        try:
            rendered = _render_pdf_pages_to_png(pdf, need, dpi=160)
            for k in range(0, len(rendered), 8):
                lote = rendered[k:k + 8]
                textos = _ocr_paginas_gemini(lote)
                for (idx, _png), txt in zip(lote, textos):
                    if txt and len(txt) > paginas[idx]["chars"]:
                        paginas[idx] = {"n": page_offset + idx + 1, "texto": txt, "chars": len(txt), "ocr": "gemini_vision"}
        except Exception as e:
            recortes.append({"donde": "ocr_gemini_vision", "limite": "fallo",
                             "omitido": f"páginas rasterizadas {[page_offset + i + 1 for i in need][:30]} ({str(e)[:80]})"})
    return paginas, recortes


def _ocr_paginas_gemini(rendered: list[tuple[int, bytes]]) -> list[str]:
    """Transcripción literal de ≤ 8 páginas PNG con Gemini (solo fallback sin Document AI)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    schema = gtypes.Schema(type=gtypes.Type.OBJECT, properties={
        "paginas": gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.OBJECT, properties={
            "indice": gtypes.Schema(type=gtypes.Type.INTEGER), "texto": gtypes.Schema(type=gtypes.Type.STRING)},
            required=["indice", "texto"]))}, required=["paginas"])
    parts = [gtypes.Part.from_text(text=(
        f"Adjunto {len(rendered)} imágenes de páginas escaneadas (índices 0..{len(rendered) - 1}, en ese orden). "
        "Transcribí LITERALMENTE todo el texto de cada una (tablas como filas con ' | '). No resumas, no "
        "inventes, no completes. Si una página es ilegible, devolvé texto vacío para ese índice."))]
    for _idx, png in rendered:
        parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))
    cfg = gtypes.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                       max_output_tokens=65535, temperature=0.0,
                                       http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS))
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=DEFAULT_GEMINI_MODEL, contents=parts, config=cfg))
    data = _safe_parse_json((resp.text or "").strip()) or {}
    out = [""] * len(rendered)
    for p in (data.get("paginas") or []):
        try:
            i = int(p.get("indice"))
            if 0 <= i < len(out):
                out[i] = str(p.get("texto") or "").strip()
        except Exception:
            continue
    return out


def _texto_de_unidades(unidades: list[dict]) -> dict:
    """Todas las unidades → páginas con numeración GLOBAL continua ({n, texto, chars, archivo}),
    texto con marcadores ⟦archivo: …⟧ / ⟦p.N⟧, motor y recortes."""
    from tools.docai import docai_enabled, extract_docai, marcar_paginas
    use_docai = False
    try:
        use_docai = docai_enabled()
    except Exception:
        pass
    paginas: list[dict] = []
    recortes: list[dict] = []
    motores: set[str] = set()
    truncado = False
    for u in unidades:
        offset = len(paginas)
        nombre = u["nombre"]
        if u["kind"] == "paginas":
            for i, p in enumerate(u["paginas"] or []):
                t = (p.get("texto") or "").strip()
                paginas.append({"n": offset + i + 1, "texto": t, "chars": len(t), "archivo": nombre})
            motores.add("texto_nativo")
            continue
        pdf = u["data"]
        res = None
        if use_docai:
            try:
                res = extract_docai(pdf, page_offset=offset)
            except Exception as e:
                print(f"[lote] docai falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
                res = None
        if res:
            for p in res["paginas"]:
                p["archivo"] = nombre
            paginas.extend(res["paginas"])
            recortes.extend(res.get("recortes") or [])
            truncado = truncado or bool(res.get("truncado"))
            motores.add("docai")
        else:
            try:
                pags, rec = _paginas_pymupdf(pdf, offset)
            except Exception as e:
                recortes.append({"donde": f"ocr:{nombre[:80]}", "limite": "pdf_ilegible", "omitido": f"{nombre} ({str(e)[:80]})"})
                truncado = True
                continue
            for p in pags:
                p["archivo"] = nombre
            paginas.extend(pags)
            recortes.extend(rec)
            motores.add("pymupdf+gemini_vision" if any(p.get("ocr") for p in pags) else "pymupdf")
    # Texto con marcadores; cabecera ⟦archivo⟧ cuando cambia la unidad (contenedores).
    partes: list[str] = []
    cur_archivo = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if multi and p.get("archivo") != cur_archivo:
            cur_archivo = p.get("archivo")
            partes.append(f"⟦archivo: {cur_archivo}⟧")
        partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    texto = "\n".join(partes).strip()
    motor = "+".join(sorted(motores)) if len(motores) > 1 else (next(iter(motores)) if motores else "ninguno")
    return {"paginas": paginas, "texto": texto, "n_paginas": len(paginas), "chars": sum(p["chars"] for p in paginas),
            "motor": motor, "truncado": truncado or any(p.get("error") for p in paginas), "recortes": recortes}


# ── Caché en BD: documentos_texto ──────────────────────────────────────────────────────
def _texto_cache_get(sha256: str) -> dict | None:
    """Fila de documentos_texto con la versión actual del extractor de texto, o None."""
    if not sha256:
        return None
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes
                 FROM documentos_texto WHERE sha256=%s AND version_parser=%s""",
            (sha256, VERSION_PARSER),
        )
        row = cur.fetchone()
        if not row:
            return None
        n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes = row
        if isinstance(paginas, str):
            paginas = json.loads(paginas)
        if isinstance(extraccion, str):
            extraccion = json.loads(extraccion)
        if isinstance(recortes, str):
            recortes = json.loads(recortes)
        return {"n_paginas": n_paginas, "texto": texto or "", "paginas": paginas or [], "truncado": bool(truncado),
                "motor": motor, "formato": formato, "extraccion": extraccion or {}, "recortes": recortes or [],
                "chars": sum(int(p.get("chars") or 0) for p in (paginas or []))}
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (get): {str(e)[:120]}", flush=True)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _texto_cache_put(sha256: str, ocid: str | None, url_gcs: str | None, formato: str | None, tx: dict) -> bool:
    if not sha256:
        return False
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO documentos_texto (sha256, ocid, url_gcs, formato, n_paginas, motor, version_parser,
                                             texto, paginas, truncado, recortes, actualizado_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, now())
               ON CONFLICT (sha256) DO UPDATE SET
                 ocid=COALESCE(EXCLUDED.ocid, documentos_texto.ocid), url_gcs=COALESCE(EXCLUDED.url_gcs, documentos_texto.url_gcs),
                 formato=EXCLUDED.formato, n_paginas=EXCLUDED.n_paginas, motor=EXCLUDED.motor,
                 version_parser=EXCLUDED.version_parser, texto=EXCLUDED.texto, paginas=EXCLUDED.paginas,
                 truncado=EXCLUDED.truncado, recortes=EXCLUDED.recortes, extraccion=NULL, actualizado_at=now()""",
            (sha256, _short_ocid(ocid) if ocid else None, url_gcs, formato, tx["n_paginas"], tx["motor"], VERSION_PARSER,
             tx["texto"], json.dumps(tx["paginas"], ensure_ascii=False), bool(tx["truncado"]),
             json.dumps(tx.get("recortes") or [], ensure_ascii=False)),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (put): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _extraccion_cache_put(sha256: str, clave: str, extraccion: dict) -> bool:
    if not sha256:
        return False
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE documentos_texto
                  SET extraccion = COALESCE(extraccion, '{}'::jsonb) || %s::jsonb, actualizado_at = now()
                WHERE sha256 = %s""",
            (json.dumps({clave: extraccion}, ensure_ascii=False, default=str), sha256),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (extraccion): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Extracción estructurada sobre el texto (con reintento por rango de páginas) ────────
_SYSTEM_LOTE = (
    "Sos un extractor experto en documentos del Sistema Electrónico de Contrataciones del Estado "
    "(SEACE) del Perú y del OECE (ex-OSCE): Bases Administrativas/Integradas, Términos de Referencia "
    "(TDR), Especificaciones Técnicas (EETT), Expedientes Técnicos, Resúmenes Ejecutivos e informes "
    "que sustentan una contratación directa, Actas de Buena Pro, Cuadros de evaluación, Contratos, "
    "Órdenes de compra/servicio, Adendas y Propuestas.\n\n"
    "ENTRADA: el TEXTO OCR del documento completo. Cada página empieza con un marcador ⟦p.N⟧ (N = número "
    "de página). Si el documento es un paquete (ZIP/RAR), cada archivo interno empieza con ⟦archivo: nombre⟧ "
    "y la numeración de páginas es continua a lo largo de todos los archivos.\n\n"
    "SALIDA: SOLO JSON conforme al schema. Sos un EXTRACTOR PURO: volcás HECHOS del documento a campos "
    "discretos. NO emitís juicios legales ni banderas de riesgo (eso lo hace otro agente sobre tu output).\n\n"
    "REGLAS DE INTEGRIDAD (innegociables):\n"
    "  · NUNCA inventes contenido. Si un dato no está en el texto, el campo va null / lista vacía. Preferí "
    "campo vacío a campo inventado. JAMÁS uses placeholders ni ejemplos de memoria (marcas, RUC, nombres, "
    "normas, cifras) que no aparezcan literalmente en el texto.\n"
    "  · EVIDENCIA OBLIGATORIA: cada ítem, postor, firmante, miembro de comité, motivo de adjudicación, "
    "estudio de mercado, contrato final y bloque del perfil lleva `evidencia: [{pagina, cita}]` con la "
    "página del marcador ⟦p.N⟧ donde aparece y una cita textual copiada tal cual (≤ 240 chars). Sin "
    "evidencia el dato no se persiste; con evidencia falsa (cita que no está en esa página) el dato se "
    "descarta y se cuenta como alucinación.\n"
    "  · `texto_literal` de cada ítem es un EXTRACTO LITERAL (copiado, sin resumir ni reescribir) del "
    "requerimiento técnico de ese ítem, hasta 4000 chars, con `texto_literal_paginas` = páginas que abarca. "
    "El resumen legible lo hace otro agente: vos no resumís.\n"
    "  · Copiá marcas, normas, cifras y nombres LITERALES del texto — no traduzcas, no normalices, no completes.\n"
    "  · BASES / TDR / EETT / RESUMEN EJECUTIVO son PRE-adjudicación: NO tienen firmantes del comité, "
    "motivos de adjudicación ni acta. En esos documentos dejá `firmantes=[]`, `comite_evaluacion=[]`, "
    "`motivos_adjudicacion=[]`, `lugar_fecha_acta=null`. Solo ACTAS / CUADROS DE EVALUACIÓN / CONTRATOS "
    "los tienen.\n"
    "  · FIRMANTE válido solo si hay (a) DNI visible, o (b) entidad REAL con nombre concreto, o (c) firma "
    "legible al pie con nombre. Plantillas/proformas ('POSTOR 1', 'EL CONTRATISTA', 'Juan Pérez') → no van.\n"
    "  · El OBJETO del contrato viene del OCDS y debe coincidir con lo que extraés. Si tu extracción "
    "discrepa radicalmente, revisá tu lectura del texto.\n"
    "  · Si el texto es ilegible o está vacío: contiene_requerimiento=false, items=[], resumen='No se pudo "
    "extraer información legible del documento'.\n"
)


def _prompt_lote(label: str, bloque: str | None, ocds_ctx: dict, rango: tuple[int, int] | None,
                 tipo_hint: str | None) -> str:
    objeto = str(ocds_ctx.get("objeto") or "")[:600]
    entidad = str(ocds_ctx.get("entidad") or "")[:200]
    items_ocds = ocds_ctx.get("items") or []
    items_txt = "\n".join(f"  - ítem {i + 1}: {str(it)[:200]}" for i, it in enumerate(items_ocds[:40]))
    rango_txt = (f"Este texto cubre SOLO las páginas {rango[0]}-{rango[1]} del documento (extracción por rango: "
                 "extraé todo lo que haya en estas páginas; lo demás lo cubren otras llamadas).\n") if rango else ""
    bloque_txt = ""
    if bloque == "servicio":
        bloque_txt = ("BLOQUE `servicio` (perfil SERVICIOS/CONSULTORÍA): si el documento describe el servicio (TDR/Bases), "
                      "completá alcance (literal), actividades, entregables con plazo y % de pago, plazo total, personal "
                      "clave (cargo, profesión, años, dedicación), experiencia exigida al postor, tarifas (concepto/unidad/precio), "
                      "penalidades, si se permite subcontratar, forma de pago y lugar. Cada entregable/personal/tarifa con su página.\n")
    elif bloque == "obra":
        bloque_txt = ("BLOQUE `obra` (perfil OBRAS): expediente técnico (memoria literal, presupuesto total, partidas con "
                      "metrado/unidad/precio/parcial, GG % y utilidad %, plazo, cronograma), requisitos de residente y supervisor, "
                      "garantía de fiel cumplimiento, adelantos; y si es adenda/valorización: adicionales (n, monto, % acumulado, "
                      "motivo, resolución), ampliaciones de plazo y valorizaciones. Cada partida/adicional con su página.\n")
    elif bloque == "sustento_directa":
        bloque_txt = ("BLOQUE `sustento_directa` (perfil OTROS: directa/convenio/consultoría por causal): causal invocada "
                      "(artículo y texto LITERAL), informe técnico e informe legal (número, fecha, firmante), acto aprobatorio "
                      "(tipo, número, fecha), cotizaciones (proveedor, RUC, monto, fecha), justificación de proveedor único, fecha "
                      "de publicación en SEACE; para convenios: entidades parte, objeto, aportes, vigencia.\n")
    return (
        f"DOCUMENTO: {label}\n"
        + (f"Tipo declarado en SEACE: {tipo_hint}\n" if tipo_hint else "")
        + f"CONTEXTO OCDS — entidad: {entidad} · objeto: {objeto}\n"
        + (f"Ítems del OCDS (referencia para numerar; NO para inventar):\n{items_txt}\n" if items_txt else "")
        + rango_txt
        + "\nHacé esto, en orden:\n"
        "PASO 1 — `tipo_documento_detectado` por el contenido; `contiene_requerimiento` si hay sección REQUERIMIENTO / "
        "TDR / EETT / expediente técnico con detalle.\n"
        "PASO 2 — `items[]`: un objeto por ítem del proceso (cada fila de una tabla de ítems es un ítem; si el OCDS "
        "tiene 1 ítem que agrupa varios productos, sub-numerá 1.1, 1.2 con `padre_ocds_item`='1' y conservá el padre). "
        "Para cada ítem: campos discretos (cantidad, unidad, precios, marca, normas, valores técnicos, garantía, entrega, "
        "requisitos del postor, penalidades, subitems) + `texto_literal` (extracto literal ≤ 4000 chars) + "
        "`texto_literal_paginas` + `evidencia`.\n"
        "PASO 3 — `postores`, `firmantes`, `comite_evaluacion`, `motivos_adjudicacion`, `lugar_fecha_acta` SOLO si el "
        "documento es acta/cuadro/contrato (con evidencia y página).\n"
        "PASO 4 — `fundamento_legal`: normas citadas literalmente por el documento.\n"
        "PASO 5 — `estudio_mercado` SOLO si es Resumen Ejecutivo / informe de sustento; `contrato_final` SOLO si es "
        "contrato / orden de compra o servicio firmado. En cualquier otro documento ambos van null.\n"
        + (f"PASO 6 — {bloque_txt}" if bloque_txt else "")
        + "PASO FINAL — `cuantia_total`, `fuente_financiamiento`, `modalidad` y `resumen` (3-4 líneas del documento REAL).\n"
        "Devolvé SOLO JSON. Sin markdown, sin fences, sin texto antes ni después."
    )


def _finish_reason(resp) -> str:
    try:
        return str(resp.candidates[0].finish_reason or "")
    except Exception:
        return ""


def _llamar_extractor(texto: str, label: str, bloque: str | None, ocds_ctx: dict,
                      rango: tuple[int, int] | None, tipo_hint: str | None) -> tuple[dict, bool, dict]:
    """Una llamada Gemini sobre `texto`. Devuelve (data, truncado, uso)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    cfg_kwargs = dict(
        response_mime_type="application/json",
        response_schema=_parser_schema(bloque),
        max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),
        system_instruction=_SYSTEM_LOTE,
    )
    temp = os.getenv("PARSER_TEMPERATURE", "").strip()
    if temp:
        try:
            cfg_kwargs["temperature"] = float(temp)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(**cfg_kwargs)
    parts = [
        gtypes.Part.from_text(text="═══ TEXTO OCR DEL DOCUMENTO (marcadores ⟦p.N⟧ por página) ═══\n" + texto),
        gtypes.Part.from_text(text=_prompt_lote(label, bloque, ocds_ctx, rango, tipo_hint)),
    ]
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    t0 = time.monotonic()
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=model, contents=parts, config=config))
    dt = time.monotonic() - t0
    raw_text = (resp.text or "").strip()
    fr = _finish_reason(resp)
    truncado = "MAX_TOKENS" in fr.upper()
    try:
        data = json.loads(raw_text)
    except Exception:
        data = _safe_parse_json(raw_text)
        truncado = True  # solo se pudo recuperar cerrando llaves → hubo corte
    if not isinstance(data, dict):
        data = {}
    um = getattr(resp, "usage_metadata", None)
    uso = {"modelo": model, "segundos": round(dt, 1), "finish_reason": fr,
           "tokens_prompt": int(getattr(um, "prompt_token_count", 0) or 0) if um else 0,
           "tokens_output": int(getattr(um, "candidates_token_count", 0) or 0) if um else 0,
           "tokens_thoughts": int(getattr(um, "thoughts_token_count", 0) or 0) if um else 0}
    print(f"[lote-llm] {label[:50]} rango={rango} · {len(texto):,} chars → {uso['tokens_output']} tok out · "
          f"{dt:.0f}s · {fr}{' · TRUNCADO' if truncado else ''}", flush=True)
    return data, truncado, uso


def _merge_extraccion(a, b):
    """Fusión recursiva de dos extracciones (de rangos/llamadas distintas del MISMO doc):
    listas → concatenación con dedupe exacto; dicts → unión campo a campo; escalares →
    el primero no vacío."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge_extraccion(a.get(k), v) if k in a else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        out = list(a)
        seen = {json.dumps(x, sort_keys=True, default=str) for x in a}
        for x in b:
            key = json.dumps(x, sort_keys=True, default=str)
            if key not in seen:
                out.append(x)
                seen.add(key)
        return out
    if a in (None, "", [], {}):
        return b
    return a


def _texto_rango(paginas: list[dict], a: int, b: int) -> str:
    partes = []
    cur = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if a <= p["n"] <= b:
            if multi and p.get("archivo") != cur:
                cur = p.get("archivo")
                partes.append(f"⟦archivo: {cur}⟧")
            partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    return "\n".join(partes)


def _extraer_rango(paginas: list[dict], a: int, b: int, label: str, bloque: str | None, ocds_ctx: dict,
                   tipo_hint: str | None, recortes: list[dict], usos: list[dict], depth: int = 0,
                   rango_explicito: bool = False) -> dict:
    """Extrae las páginas [a, b]. Si el JSON llega truncado (MAX_TOKENS) y el rango tiene más
    de una página, se parte en dos y se re-pide cada mitad (hasta depth 2); si aun así se
    trunca, se registra el recorte y se devuelve lo recuperado con `_truncado=True`."""
    texto = _texto_rango(paginas, a, b)
    data, truncado, uso = _llamar_extractor(texto, label, bloque, ocds_ctx, (a, b) if rango_explicito else None, tipo_hint)
    usos.append({**uso, "rango": [a, b]})
    if not truncado:
        return data
    if b > a and depth < 2:
        mid = (a + b) // 2
        print(f"[lote] JSON truncado en págs {a}-{b} → re-pido {a}-{mid} y {mid + 1}-{b}", flush=True)
        left = _extraer_rango(paginas, a, mid, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        right = _extraer_rango(paginas, mid + 1, b, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        merged = _merge_extraccion(left, right)
        merged["_truncado"] = bool(left.get("_truncado") or right.get("_truncado"))
        return merged
    recortes.append({"donde": f"extraccion:{label[:80]}", "limite": "max_output_tokens=65535",
                     "omitido": f"páginas {a}-{b}: JSON truncado tras {depth} subdivisiones; se conserva lo recuperado"})
    data["_truncado"] = True
    return data


def _extraer_documento(tx: dict, label: str, bloque: str | None, ocds_ctx: dict, tipo_hint: str | None) -> dict:
    """Extracción estructurada de TODO el documento: se parte por páginas en llamadas de ≤
    PARSE_MAX_CHARS_POR_LLAMADA chars (nada se omite) y se fusiona. Devuelve la extracción con
    `_recortes`, `_usos` (tokens/tiempos por llamada) y `_truncado`."""
    paginas = tx["paginas"]
    recortes: list[dict] = []
    usos: list[dict] = []
    if not paginas:
        return {"_truncado": True, "_recortes": [{"donde": f"extraccion:{label[:80]}", "limite": "sin_texto", "omitido": label}],
                "_usos": [], "items": [], "resumen": "Documento sin texto extraíble"}
    # Rangos por chars
    rangos: list[tuple[int, int]] = []
    a = paginas[0]["n"]
    acc = 0
    for p in paginas:
        if acc + p["chars"] > PARSE_MAX_CHARS_POR_LLAMADA and acc > 0:
            rangos.append((a, p["n"] - 1))
            a = p["n"]
            acc = 0
        acc += p["chars"]
    rangos.append((a, paginas[-1]["n"]))
    if len(rangos) > 1:
        print(f"[lote] {label[:60]}: {tx['chars']:,} chars → {len(rangos)} llamadas por rango de páginas", flush=True)
    result: dict = {}
    for i, (ra, rb) in enumerate(rangos):
        parte = _extraer_rango(paginas, ra, rb, label, bloque, ocds_ctx, tipo_hint, recortes, usos,
                               rango_explicito=len(rangos) > 1)
        result = _merge_extraccion(result, parte) if result else parte
    result["_truncado"] = bool(result.get("_truncado")) or any(r.get("limite", "").startswith("max_output") for r in recortes)
    result["_recortes"] = recortes
    result["_usos"] = usos
    return result


# ── Post-proceso: evidencia verificable, sha256 por dato, alias de compat ──────────────
def _cita_en_pagina(cita: str, texto_pagina: str) -> bool:
    """¿La cita (normalizada) aparece en el texto de la página? Tolerante a espacios/tildes/caja;
    con citas largas basta con que aparezca un prefijo de 60 chars normalizados."""
    c = _norm_txt(cita or "")
    t = _norm_txt(texto_pagina or "")
    if not c or not t:
        return False
    if c in t:
        return True
    c2 = re.sub(r"[^A-Z0-9 ]", " ", c)
    t2 = re.sub(r"[^A-Z0-9 ]", " ", t)
    c2 = " ".join(c2.split()); t2 = " ".join(t2.split())
    if c2 and c2 in t2:
        return True
    return len(c2) > 60 and c2[:60] in t2


def _verificar_evidencia(obj: dict, paginas_by_n: dict[int, dict], sha256: str | None, stats: dict) -> None:
    """Marca cada evidencia como verificada/no verificada contra el texto de la página y
    estampa `documento_sha256`. No borra nada: V (verify.py) decide qué persistir."""
    if not isinstance(obj, dict):
        return
    obj["documento_sha256"] = sha256
    evs = obj.get("evidencia")
    if not isinstance(evs, list):
        obj["evidencia"] = []
        return
    out = []
    for ev in evs:
        if not isinstance(ev, dict):
            continue
        cita = str(ev.get("cita") or "")[:CITA_MAX]
        pagina = ev.get("pagina")
        try:
            pagina = int(pagina) if pagina is not None else None
        except Exception:
            pagina = None
        ok = False
        if pagina is not None and pagina in paginas_by_n:
            ok = _cita_en_pagina(cita, paginas_by_n[pagina].get("texto") or "")
            if not ok:  # tolerancia ±1 página (tablas que cruzan de página)
                for q in (pagina - 1, pagina + 1):
                    if q in paginas_by_n and _cita_en_pagina(cita, paginas_by_n[q].get("texto") or ""):
                        ok = True
                        pagina = q
                        break
        stats["total"] = stats.get("total", 0) + 1
        stats["verificadas"] = stats.get("verificadas", 0) + (1 if ok else 0)
        out.append({"pagina": pagina, "cita": cita, "verificada": ok, "documento_sha256": sha256})
    obj["evidencia"] = out


def _post_procesar(data: dict, tx: dict, sha256: str | None) -> dict:
    """Aplica verificación de evidencia a ítems/postores/firmantes/comité/motivos/bloques,
    recorta `texto_literal` al tope, y deja `requerimiento_tecnico_detallado` como ALIAS de
    `texto_literal` para los consumidores existentes (market, legal, self-eval)."""
    paginas_by_n = {int(p["n"]): p for p in (tx.get("paginas") or []) if p.get("n") is not None}
    stats: dict = {}
    for it in (data.get("items") or []):
        if not isinstance(it, dict):
            continue
        tl = it.get("texto_literal")
        if isinstance(tl, str) and len(tl) > TEXTO_LITERAL_MAX:
            it["texto_literal"] = tl[:TEXTO_LITERAL_MAX]
            it["texto_literal_truncado"] = True
        if it.get("texto_literal") and not it.get("requerimiento_tecnico_detallado"):
            it["requerimiento_tecnico_detallado"] = it["texto_literal"]
        _verificar_evidencia(it, paginas_by_n, sha256, stats)
    for key in ("postores", "firmantes", "comite_evaluacion", "motivos_adjudicacion"):
        for obj in (data.get(key) or []):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
    for key in ("estudio_mercado", "contrato_final", *_BLOQUES_VALIDOS):
        obj = data.get(key)
        if isinstance(obj, dict):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
    data["_evidencia_stats"] = stats
    return data


def _perfil_params(state: dict, parser_bloque=None, prioridad=None, max_docs=None) -> tuple[str | None, tuple[str, ...], int]:
    """(parser_bloque, doc_prioridad, parse_max_docs) desde argumentos, state['perfil'] (dataclass
    Profile de P, dict o nombre) o defaults de BIENES."""
    perfil = state.get("perfil")
    if isinstance(perfil, str):
        try:
            from agents._shared import profiles as _prof  # type: ignore
            perfil = _prof.get_profile() if perfil == getattr(_prof, "PROFILE", None) else perfil
        except Exception:
            pass

    def _g(name, default):
        if isinstance(perfil, dict):
            return perfil.get(name, default)
        return getattr(perfil, name, default) if perfil is not None else default

    bloque = parser_bloque if parser_bloque is not None else _g("parser_bloque", None)
    if bloque not in (None, *_BLOQUES_VALIDOS):
        print(f"[lote] parser_bloque desconocido {bloque!r} → sin bloque", flush=True)
        bloque = None
    prio = tuple(prioridad or _g("doc_prioridad", None) or PRIORIDAD_DEFAULT)
    mx = int(max_docs or _g("parse_max_docs", None) or MAX_DOCS_DEFAULT)
    return bloque, prio, mx


def _ocds_ctx(state: dict) -> dict:
    cr = state.get("ocds") or {}
    tender = cr.get("tender") or {}
    return {"objeto": tender.get("description") or tender.get("title") or "",
            "entidad": (cr.get("buyer") or {}).get("name") or "",
            "items": [f"{(it.get('description') or '')[:140]} · cant {it.get('quantity')} {((it.get('unit') or {}).get('name') or '')}"
                      for it in (tender.get("items") or []) if isinstance(it, dict)]}


def _bytes_de_doc(doc: dict, state: dict) -> tuple[bytes | None, str, str | None]:
    """Bytes del documento: gs:// del DocRef → cadena histórica (_fetch_doc_bytes: b64 inline,
    doc_urls, downloader local, relay, directo)."""
    gs = doc.get("gs")
    if gs:
        blob, err = _download_from_gcs(gs)
        if blob is not None:
            return blob, "gcs", None
        print(f"[lote] gcs falló para {gs[:80]}: {err}", flush=True)
    url = doc.get("url")
    if url:
        class _Ctx:
            __slots__ = ("state",)

            def __init__(self, st):
                self.state = st
        return _fetch_doc_bytes(url, _Ctx(state))
    return None, "failed", "sin gs:// ni url"


_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: dict[str, threading.Event] = {}


def _sha_por_url_get(ocid: str | None, url: str | None) -> str | None:
    """sha256 conocido para (ocid, url) en `documentos` (migración 17) — evita bajar de nuevo un
    documento que no está en documentos_gcs pero cuyo texto ya está cacheado."""
    if not ocid or not url:
        return None
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute("SELECT sha256 FROM documentos WHERE ocid=%s AND blob_url=%s AND sha256 IS NOT NULL LIMIT 1",
                    (_short_ocid(ocid), url))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _sha_por_url_put(ocid: str | None, url: str | None, sha256: str, doc: dict) -> None:
    if not ocid or not url or not sha256:
        return
    try:
        conn = _pg()
    except Exception:
        return
    try:
        cur = conn.cursor()
        cur.execute("UPDATE documentos SET sha256=%s WHERE ocid=%s AND blob_url=%s", (sha256, _short_ocid(ocid), url))
        if cur.rowcount == 0:
            cur.execute(
                """INSERT INTO documentos (ocid, tipo, nombre, blob_url, metadata, seccion, ocds_doc_id, sha256)
                   VALUES (%s, 'otro', %s, %s, %s, %s, %s, %s) ON CONFLICT (ocid, blob_url) DO UPDATE SET sha256=EXCLUDED.sha256""",
                (_short_ocid(ocid), doc.get("titulo") or "(sin título)", url,
                 json.dumps({"ocds_documentType": doc.get("tipo"), "format": doc.get("formato")}),
                 doc.get("seccion"), str(doc.get("id") or "") or None, sha256))
        conn.commit()
    except Exception as e:
        print(f"[lote] documentos.sha256 no actualizable: {str(e)[:100]}", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _esperar_sha(sha: str) -> bool:
    """Si otro hilo del MISMO lote ya está procesando este sha (bytes idénticos publicados
    con dos URLs), espera a que termine y devuelve True (→ leer de caché). Si no, reclama el
    sha y devuelve False."""
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.get(sha)
        if ev is None:
            _INFLIGHT[sha] = threading.Event()
            return False
    ev.wait(timeout=PARSE_OVERALL_TIMEOUT_S)
    return True


def _liberar_sha(sha: str) -> None:
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.pop(sha, None)
    if ev is not None:
        ev.set()


def _procesar_doc(doc: dict, state: dict, bloque: str, prioridad: tuple[str, ...], ocds_ctx: dict) -> dict:
    """Pipeline de UN documento: caché de texto → (descarga → expansión → OCR → persistir) →
    caché de extracción → (extracción → persistir) → post-proceso. Devuelve un dict con
    `tx` (texto), `ext` (extracción), `recortes`, `tiempos`, `sha256`, `cache`."""
    t0 = time.monotonic()
    label = f"{doc.get('titulo') or doc.get('id') or 'documento'}"
    if doc.get("formato"):
        label += f" [{doc['formato']}]"
    out = {"doc": doc, "sha256": doc.get("sha256"), "recortes": [], "tiempos": {}, "cache": {"texto": False, "extraccion": False}}
    ocid = state.get("ocid") or state.get("ocid_preloaded")
    sha = doc.get("sha256") or _sha_por_url_get(ocid, doc.get("url"))
    if sha and not doc.get("sha256"):
        doc["sha256"] = sha
        doc["_sha_desde_documentos"] = True
        out["sha256"] = sha
    reclamado: str | None = None
    if sha:
        if _esperar_sha(sha):
            out["cache"]["esperado_en_lote"] = True
        else:
            reclamado = sha
    try:
        tx = _texto_cache_get(sha) if sha else None
        blob = None
        if tx is None:
            blob, fuente, err = _bytes_de_doc(doc, state)
            out["tiempos"]["descarga_s"] = round(time.monotonic() - t0, 1)
            if blob is None:
                out["error"] = f"download_failed: {err}"
                out["recortes"].append({"donde": f"descarga:{label[:80]}", "limite": "descarga_fallida", "omitido": f"{label} ({err})"})
                return out
            if not sha:
                sha = _sha256_hex(blob)
                out["sha256"] = sha
                doc["sha256"] = sha
                if _esperar_sha(sha):
                    out["cache"]["esperado_en_lote"] = True
                else:
                    reclamado = sha
                tx = _texto_cache_get(sha)
            out["fuente"] = fuente
        return _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad)
    finally:
        if reclamado:
            _liberar_sha(reclamado)


def _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad) -> dict:
    """Segunda mitad de _procesar_doc: OCR (si hace falta) + extracción + post-proceso."""
    if tx is not None:
        out["cache"]["texto"] = True
        out["recortes"].extend(tx.get("recortes") or [])   # recortes del OCR original (chunks perdidos, etc.)
        print(f"[lote] texto en caché · {label[:60]} · {tx['n_paginas']} págs · {tx['chars']:,} chars", flush=True)
    else:
        t1 = time.monotonic()
        unidades, rec = _expandir_contenedor(blob, doc.get("titulo") or doc.get("url") or "documento", prioridad)
        out["recortes"].extend(rec)
        if not unidades:
            out["error"] = "sin_contenido_procesable"
            return out
        tx = _texto_de_unidades(unidades)
        tx["extraccion"] = {}
        out["recortes"].extend(tx.get("recortes") or [])
        out["tiempos"]["ocr_s"] = round(time.monotonic() - t1, 1)
        out["unidades"] = [{"nombre": u["nombre"], "kind": u["kind"]} for u in unidades]
        _texto_cache_put(sha, state.get("ocid") or state.get("ocid_preloaded"), doc.get("gs"), doc.get("formato"), tx)
        print(f"[lote] OCR · {label[:60]} · {len(unidades)} unidad(es) · {tx['n_paginas']} págs · {tx['chars']:,} chars · "
              f"{tx['motor']} · {out['tiempos']['ocr_s']}s", flush=True)
    out["tx"] = tx
    # ── extracción (cacheada por bloque + versión de schema + modelo) ──
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    clave = f"{bloque or 'base'}@{PARSER_SCHEMA_VERSION}@{model}"
    ext = None
    if PARSE_REUSE_EXTRACCION and isinstance(tx.get("extraccion"), dict) and isinstance(tx["extraccion"].get(clave), dict):
        ext = tx["extraccion"][clave]
        out["cache"]["extraccion"] = True
        print(f"[lote] extracción en caché · {label[:60]} · {clave}", flush=True)
    if ext is None:
        t2 = time.monotonic()
        ext = _extraer_documento(tx, label, bloque, ocds_ctx, doc.get("tipo"))
        out["tiempos"]["extraccion_s"] = round(time.monotonic() - t2, 1)
        out["recortes"].extend(ext.get("_recortes") or [])
        ext = _post_procesar(ext, tx, sha)
        _extraccion_cache_put(sha, clave, ext)   # incluye _recortes/_usos: en caché también se reportan
    else:
        out["recortes"].extend(ext.get("_recortes") or [])
    out["ext"] = ext
    out["tiempos"]["total_s"] = round(time.monotonic() - t0, 1)
    # Dejar el sha en `documentos` (ocid, url) también para los que vinieron de documentos_gcs:
    # cuando el blob expire (90 días) el texto sigue localizable por URL sin volver a bajarlo.
    if doc.get("url") and sha and not doc.get("_sha_desde_documentos"):
        _sha_por_url_put(state.get("ocid") or state.get("ocid_preloaded"), doc["url"], sha, doc)
    return out


def parse_documentos_lote(state: dict, docs: list[dict], *, parser_bloque: str | None = None,
                          prioridad: tuple[str, ...] | None = None) -> dict:
    """OCR una sola vez (documentos_texto por sha256, páginas con marcadores ⟦p.N⟧), extracción con
    schema (base + bloque del perfil) y evidencia {documento_sha256, pagina, cita}. Escribe
    state['parser_raw_consolidated'], state['documentos_texto'] = {sha256: {n_paginas, chars, truncado}},
    y añade a state['recortes'].

    `docs`: lista de DocRef de `seleccionar_documentos`. El perfil sale de los kwargs o de
    state['perfil'] (defaults de bienes). Devuelve un resumen compacto (conteos, por documento,
    recortes, tiempos) apto para el trace."""
    t_ini = time.monotonic()
    bloque, prio, _mx = _perfil_params(state, parser_bloque, prioridad)
    ocds_ctx = _ocds_ctx(state)
    state.setdefault("recortes", [])
    state.setdefault("documentos_texto", {})
    docs = [d for d in (docs or []) if isinstance(d, dict)]
    if not docs:
        state["recortes"].append({"donde": "parser_lote", "limite": "sin_documentos", "omitido": "ningún documento elegible"})
        return {"n_docs": 0, "n_ok": 0, "recortes": state["recortes"][-1:], "_note": "sin documentos"}

    # Presupuesto global compartido con el resto del pipeline (mismo mecanismo que parse_document_pdf).
    now = time.monotonic()
    deadline = state.get("_parse_deadline")
    if not isinstance(deadline, (int, float)):
        deadline = now + PARSE_GLOBAL_BUDGET_S
        state["_parse_deadline"] = deadline
    budget = max(60.0, deadline - now)

    resultados: list[dict | None] = [None] * len(docs)
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, PARSE_LOTE_WORKERS))
    futures = {ex.submit(_procesar_doc, d, state, bloque, prio, ocds_ctx): i for i, d in enumerate(docs)}
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=budget):
            i = futures[fut]
            try:
                resultados[i] = fut.result()
            except Exception as e:
                resultados[i] = {"doc": docs[i], "error": f"{type(e).__name__}: {str(e)[:160]}", "recortes": [], "tiempos": {},
                                 "sha256": docs[i].get("sha256"), "cache": {}}
    except concurrent.futures.TimeoutError:
        pend = [i for i in futures.values() if resultados[i] is None]
        state["recortes"].append({"donde": "parser_lote", "limite": f"PARSE_GLOBAL_BUDGET_S={PARSE_GLOBAL_BUDGET_S} (restaban {budget:.0f}s)",
                                  "omitido": [{"id": docs[i].get("id"), "titulo": docs[i].get("titulo")} for i in pend]})
        for i in pend:
            resultados[i] = {"doc": docs[i], "error": "parse timeout", "recortes": [], "tiempos": {}, "sha256": docs[i].get("sha256"), "cache": {}}
    finally:
        ex.shutdown(wait=False, cancel_futures=True)

    # ── Consolidación cross-doc (misma forma que parse_document_pdf + bloques + documentos[]) ──
    raw = state.get("parser_raw_consolidated") or {}
    raw.setdefault("items_consolidados", [])
    raw.setdefault("items_otros_documentos", [])
    raw.setdefault("postores_consolidados", [])
    raw.setdefault("firmantes_consolidados", [])
    raw.setdefault("comite_evaluacion", [])
    raw.setdefault("motivos_adjudicacion", [])
    raw.setdefault("red_flags_observadas", [])
    raw.setdefault("fundamento_legal", [])
    raw.setdefault("documentos", [])
    raw.setdefault("resumenes", [])
    if bloque:
        raw.setdefault(f"bloque_{bloque}", {})

    existing_keys = {}
    for _it in raw["items_consolidados"]:
        _k = _item_key(_it)
        if _k is not None:
            existing_keys[_k] = _it
    seen_firm = {((f.get("nombre_completo") or "").upper(), (f.get("cargo") or "").upper()) for f in raw["firmantes_consolidados"]}
    seen_rucs = {p.get("ruc") for p in raw["postores_consolidados"] if p.get("ruc")}
    seen_nombres = {_norm_razon(p.get("razon_social")) for p in raw["postores_consolidados"]}
    estudio_best = state.get("estudio_mercado")
    contrato_best = state.get("contrato_final")
    gate_items: list[dict] = []
    gate_adj: list[dict] = []
    resumen_docs: list[dict] = []

    for r in resultados:
        if not r:
            continue
        doc = r["doc"]
        sha = r.get("sha256")
        tx = r.get("tx") or {}
        ext = r.get("ext") or {}
        for rec in (r.get("recortes") or []):
            state["recortes"].append(rec)
        if sha:
            state["documentos_texto"][sha] = {
                "n_paginas": tx.get("n_paginas"), "chars": tx.get("chars"), "truncado": bool(tx.get("truncado")) or bool(ext.get("_truncado")),
                "titulo": doc.get("titulo"), "tipo": doc.get("tipo"), "seccion": doc.get("seccion"), "formato": doc.get("formato"),
                "motor": tx.get("motor"), "cache_texto": bool((r.get("cache") or {}).get("texto")),
                "cache_extraccion": bool((r.get("cache") or {}).get("extraccion")),
                "tipo_documento_detectado": ext.get("tipo_documento_detectado"),
            }
        entrada_doc = {
            "id": doc.get("id"), "url": doc.get("url"), "gs": doc.get("gs"), "titulo": doc.get("titulo"), "tipo": doc.get("tipo"),
            "seccion": doc.get("seccion"), "formato": doc.get("formato"), "sha256": sha,
            "n_paginas": tx.get("n_paginas"), "chars": tx.get("chars"), "motor": tx.get("motor"),
            "unidades": r.get("unidades"), "cache": r.get("cache"), "tiempos": r.get("tiempos"),
            "tipo_documento_detectado": ext.get("tipo_documento_detectado"),
            "contiene_requerimiento": bool(ext.get("contiene_requerimiento")),
            "n_items": len(ext.get("items") or []), "n_firmantes": len(ext.get("firmantes") or []),
            "truncado": bool(tx.get("truncado")) or bool(ext.get("_truncado")),
            "evidencia": ext.get("_evidencia_stats"), "usos": ext.get("_usos"), "error": r.get("error"),
        }
        raw["documentos"].append(entrada_doc)
        resumen_docs.append(entrada_doc)
        if r.get("error") or not ext:
            continue
        # Ítems: los de documentos con REQUERIMIENTO van a items_consolidados; el resto no se
        # pierde: va a items_otros_documentos y queda registrado como recorte (antes: gate mudo).
        items = [it for it in (ext.get("items") or []) if isinstance(it, dict)]
        es_fuente_req = bool(ext.get("contiene_requerimiento")) or any(
            len(str(it.get("texto_literal") or it.get("requerimiento_tecnico_detallado") or "").strip()) > 40 for it in items)
        if es_fuente_req:
            for it in items:
                k = _item_key(it)
                if k is None:
                    raw["items_consolidados"].append(it)
                    continue
                prev = existing_keys.get(k)
                if prev is None:
                    raw["items_consolidados"].append(it)
                    existing_keys[k] = it
                else:
                    new_req = it.get("texto_literal") or it.get("requerimiento_tecnico_detallado") or ""
                    cur_req = prev.get("texto_literal") or prev.get("requerimiento_tecnico_detallado") or ""
                    if len(new_req) > len(cur_req):
                        prev["texto_literal"] = new_req
                        prev["requerimiento_tecnico_detallado"] = new_req
                        prev["texto_literal_paginas"] = it.get("texto_literal_paginas")
                        prev["documento_sha256"] = it.get("documento_sha256")
                    ev_prev = prev.get("evidencia") or []
                    prev["evidencia"] = ev_prev + [e for e in (it.get("evidencia") or []) if e not in ev_prev]
                    for kk, vv in it.items():
                        if prev.get(kk) in (None, "", [], {}) and vv not in (None, "", [], {}):
                            prev[kk] = vv
        elif items:
            raw["items_otros_documentos"].extend({**it, "_documento": doc.get("titulo")} for it in items)
            gate_items.append({"documento": doc.get("titulo"), "sha256": sha, "n_items": len(items)})
        for p in (ext.get("postores") or []):
            if not isinstance(p, dict):
                continue
            nom = _norm_razon(p.get("razon_social"))
            if p.get("ruc") and p["ruc"] in seen_rucs:
                continue
            if nom and nom in seen_nombres:
                # mismo postor ya visto (con o sin RUC): completar campos vacíos, no duplicar
                prev = next((q for q in raw["postores_consolidados"] if _norm_razon(q.get("razon_social")) == nom), None)
                if prev is not None:
                    for kk, vv in p.items():
                        if prev.get(kk) in (None, "", [], {}) and vv not in (None, "", [], {}):
                            prev[kk] = vv
                    if p.get("ruc"):
                        seen_rucs.add(p["ruc"])
                continue
            if p.get("ruc"):
                seen_rucs.add(p["ruc"])
            if nom:
                seen_nombres.add(nom)
            raw["postores_consolidados"].append(p)
        for f in (ext.get("firmantes") or []):
            if not isinstance(f, dict):
                continue
            key = ((f.get("nombre_completo") or "").strip().upper(), (f.get("cargo") or "").strip().upper())
            if not key[0] or key in seen_firm:
                continue
            seen_firm.add(key)
            raw["firmantes_consolidados"].append(f)
        if _es_doc_de_adjudicacion(ext.get("tipo_documento_detectado")):
            raw["comite_evaluacion"].extend(x for x in (ext.get("comite_evaluacion") or []) if isinstance(x, dict))
            raw["motivos_adjudicacion"].extend(x for x in (ext.get("motivos_adjudicacion") or []) if isinstance(x, dict))
            if ext.get("lugar_fecha_acta") and not raw.get("lugar_fecha_acta"):
                raw["lugar_fecha_acta"] = ext["lugar_fecha_acta"]
        elif (ext.get("comite_evaluacion") or ext.get("motivos_adjudicacion")):
            gate_adj.append({"documento": doc.get("titulo"), "tipo_detectado": ext.get("tipo_documento_detectado"),
                             "n_comite": len(ext.get("comite_evaluacion") or []), "n_motivos": len(ext.get("motivos_adjudicacion") or [])})
        raw["fundamento_legal"] = list(dict.fromkeys(raw["fundamento_legal"] + [str(x) for x in (ext.get("fundamento_legal") or [])]))
        if ext.get("cuantia_total") and not raw.get("cuantia_total"):
            raw["cuantia_total"] = ext["cuantia_total"]
        for k in ("modalidad", "fuente_financiamiento"):
            if ext.get(k) and not raw.get(k):
                raw[k] = ext[k]
        if ext.get("resumen"):
            raw["resumenes"].append({"documento": doc.get("titulo"), "sha256": sha, "resumen": ext["resumen"]})
        if isinstance(ext.get("estudio_mercado"), dict) and any(v not in (None, "", [], {}) for k, v in ext["estudio_mercado"].items() if k not in ("evidencia", "documento_sha256")):
            estudio_best = _mas_completo_lote(ext["estudio_mercado"], estudio_best)
        if isinstance(ext.get("contrato_final"), dict) and any(v not in (None, "", [], {}) for k, v in ext["contrato_final"].items() if k not in ("evidencia", "documento_sha256")):
            contrato_best = _mas_completo_lote(ext["contrato_final"], contrato_best)
        if bloque and isinstance(ext.get(bloque), dict):
            raw[f"bloque_{bloque}"] = _merge_extraccion(raw.get(f"bloque_{bloque}") or {}, ext[bloque])

    if gate_items:
        state["recortes"].append({"donde": "consolidacion_items", "limite": "solo_documentos_con_requerimiento",
                                  "omitido": gate_items})
    if gate_adj:
        state["recortes"].append({"donde": "consolidacion_comite_motivos", "limite": "solo_actas_cuadros_contratos",
                                  "omitido": gate_adj})
    raw["firmantes"] = raw["firmantes_consolidados"]
    raw["requerimiento_disponible"] = any(d.get("contiene_requerimiento") for d in raw["documentos"])
    if raw["resumenes"]:
        raw["resumen_ejecutivo"] = " · ".join(f"[{x['documento']}] {x['resumen']}" for x in raw["resumenes"])[:4000]
    state["parser_raw_consolidated"] = raw
    if estudio_best:
        state["estudio_mercado"] = estudio_best
    if contrato_best:
        state["contrato_final"] = contrato_best
    if bloque:
        raw[bloque] = raw.get(f"bloque_{bloque}") or {}          # alias corto (el driver lo lee como raw["servicio"], …)
        state[f"parser_bloque_{bloque}"] = raw[bloque]
    # document_analysis: si ningún LLM-agente lo escribió, lo armamos desde el raw para el
    # frontend/persistencia (mismo contenido que produce _backfill_document_analysis).
    da = state.get("document_analysis")
    if not isinstance(da, dict) or not da:
        state["document_analysis"] = {
            "items_consolidados": raw["items_consolidados"], "postores_extraidos": raw["postores_consolidados"],
            "firmantes": raw["firmantes_consolidados"], "comite_evaluacion": raw["comite_evaluacion"],
            "motivos_adjudicacion": raw["motivos_adjudicacion"], "lugar_fecha_acta": raw.get("lugar_fecha_acta"),
            "fundamento_legal": raw["fundamento_legal"], "modalidad": raw.get("modalidad"),
            "fuente_financiamiento": raw.get("fuente_financiamiento"), "cuantia_total": raw.get("cuantia_total"),
            "requerimiento_disponible": raw["requerimiento_disponible"], "resumen_ejecutivo": raw.get("resumen_ejecutivo"),
            "documentos": raw["documentos"], "_source": "parse_documentos_lote",
        }
    # caché por URL para la tool legacy (si el agente LLM la llama sobre el mismo doc → HIT)
    pdc = state.get("_parsed_doc_cache") or {}
    for d in resumen_docs:
        if d.get("url"):
            pdc[d["url"]] = {"n_pdfs_procesados": 1, "n_items_consolidados": d.get("n_items"), "_url": d["url"],
                             "_note": "procesado por parse_documentos_lote; detalle en state['parser_raw_consolidated']"}
    state["_parsed_doc_cache"] = pdc

    total_s = round(time.monotonic() - t_ini, 1)
    n_ok = sum(1 for d in resumen_docs if not d.get("error"))
    ev_tot = sum((d.get("evidencia") or {}).get("total", 0) for d in resumen_docs)
    ev_ok = sum((d.get("evidencia") or {}).get("verificadas", 0) for d in resumen_docs)
    resumen = {
        "n_docs": len(docs), "n_ok": n_ok, "n_error": len(docs) - n_ok,
        "n_cache_texto": sum(1 for d in resumen_docs if (d.get("cache") or {}).get("texto")),
        "n_cache_extraccion": sum(1 for d in resumen_docs if (d.get("cache") or {}).get("extraccion")),
        "n_items_consolidados": len(raw["items_consolidados"]), "n_items_otros_documentos": len(raw["items_otros_documentos"]),
        "n_postores": len(raw["postores_consolidados"]), "n_firmantes": len(raw["firmantes_consolidados"]),
        "n_paginas_total": sum(int(d.get("n_paginas") or 0) for d in resumen_docs),
        "chars_total": sum(int(d.get("chars") or 0) for d in resumen_docs),
        "evidencia": {"total": ev_tot, "verificadas": ev_ok},
        "bloque": bloque, "segundos": total_s,
        "documentos": [{k: d.get(k) for k in ("id", "titulo", "tipo", "formato", "sha256", "n_paginas", "chars", "motor",
                                                "n_items", "n_firmantes", "cache", "tiempos", "truncado", "error",
                                                "tipo_documento_detectado")} for d in resumen_docs],
        "recortes": [r for r in state["recortes"]],
        "_note": "Detalle completo en state['parser_raw_consolidated'] y state['documentos_texto']",
    }
    print(f"[lote] {n_ok}/{len(docs)} docs · {resumen['n_paginas_total']} págs · {resumen['chars_total']:,} chars · "
          f"{len(raw['items_consolidados'])} ítems · {len(raw['firmantes_consolidados'])} firmantes · "
          f"evidencia {ev_ok}/{ev_tot} verificada · {len(state['recortes'])} recortes · {total_s}s", flush=True)
    return resumen


def _norm_razon(s: str | None) -> str:
    """Razón social comparable: MAYÚSCULAS sin tildes ni puntuación ('S.A.C.' == 'SAC')."""
    return " ".join(re.sub(r"[^A-Z0-9 ]", "", _norm_txt(s or "")).split())


def _mas_completo_lote(nuevo, actual):
    def _peso(d):
        if not isinstance(d, dict):
            return 0
        return sum(1 for k, v in d.items() if k not in ("evidencia", "documento_sha256") and v not in (None, "", [], {}))
    return nuevo if _peso(nuevo) > _peso(actual) else actual


def parse_documentos_seleccionados(ocid: str, tool_context: ToolContext) -> dict:
    """Selecciona (determinista, por prioridad del perfil) y parsea EN LOTE todos los documentos
    del proceso: OCR una sola vez por sha256, extracción con evidencia por página. Una sola
    llamada reemplaza a list_documents + N × parse_document_pdf.

    Args:
        ocid: OCID de la convocatoria (largo o corto).

    Returns:
        Resumen compacto: n_docs, n_ok, ítems/firmantes consolidados, páginas, recortes.
        El detalle queda en state['parser_raw_consolidated'] y state['documentos_texto'].
    """
    state = tool_context.state
    bloque, prio, mx = _perfil_params(state)
    elegidos, omitidos = seleccionar_documentos(
        state.get("ocid") or ocid, state.get("ocds") or {}, state.get("doc_urls") or {}, prio, mx,
        doc_ids=state.get("doc_ids"),
    )
    state.setdefault("recortes", [])
    rec = recorte_seleccion(elegidos, omitidos, mx)
    if rec:
        state["recortes"].append(rec)
    state["documentos_seleccionados"] = elegidos
    state["documentos_omitidos"] = omitidos
    res = parse_documentos_lote(state, elegidos, parser_bloque=bloque, prioridad=prio)
    res["n_omitidos_seleccion"] = len(omitidos)
    return res


parse_documentos_seleccionados_tool = FunctionTool(func=parse_documentos_seleccionados)


def _paginas_a_pdf_sintetico(paginas: list[dict]) -> bytes | None:
    """Páginas de texto ({texto}) → PDF sintético (una página A4 por entrada) para el
    pipeline legacy de parse_document_pdf."""
    try:
        import fitz
    except Exception:
        return None
    out = fitz.open()
    try:
        for p in paginas:
            page = out.new_page(width=595, height=842)
            try:
                page.insert_textbox(fitz.Rect(36, 36, 559, 806), str(p.get("texto") or "")[:6000],
                                    fontsize=9, fontname="helv")
            except Exception:
                pass
        if len(out) == 0:
            return None
        return out.tobytes()
    finally:
        out.close()


def _parse_single_pdf_with_gemini(blob: bytes, source_label: str) -> dict:
    """Procesa un PDF (bytes) con Gemini. Devuelve dict con extracción
    o {"error": ...}.

    Estrategia híbrida:
      1. Analiza la layout del PDF con PyMuPDF.
      2. Si hay páginas con texto < 300 chars + imagen cubriendo > 25% del área
         (típico cuando el REQUERIMIENTO está rasterizado como imagen embebida),
         renderiza esas páginas a PNG 160 DPI y se las pasa a Gemini como
         `image/png` parts adicionales junto con el PDF.
      3. Gemini hace OCR visual de alta calidad sobre los PNGs y combina con el
         texto extraíble del resto del PDF.
    """
    from google.genai import types as gtypes
    client = _gemini_client()

    # ── Análisis layout ─────────────────────────────────────────────
    layout = _analyze_pdf_layout(blob)

    # ── Document AI OCR (per-use): texto del shard en UNA llamada barata.
    #    Si funciona, a Gemini le pasamos el TEXTO (no PNGs rasterizados) →
    #    menos tokens, más rápido, mejor extracción. Si falla o no está
    #    configurado, caemos al render histórico de PNGs (sin romper nada). ──
    docai_text: str | None = None
    try:
        from tools.docai import extract_text_docai
        docai_text = extract_text_docai(blob)
    except Exception as _e:
        print(f"[docai] caller error ({type(_e).__name__}: {str(_e)[:160]})", flush=True)
        docai_text = None
    print(
        f"[docai] {source_label[:55]} → "
        + (f"TEXTO {len(docai_text):,} chars (Gemini sobre texto)" if docai_text
           else "None → fallback render+Gemini Vision"),
        flush=True,
    )

    # Con texto OCR no hace falta rasterizar páginas (el OCR ya cubre las
    # rasterizadas). Sin texto OCR → render como antes.
    pages_to_render = [] if docai_text else (layout.get("needs_render_pages") or [])[:_MAX_RENDER_PAGES]
    rendered: list[tuple[int, bytes]] = []
    if pages_to_render:
        rendered = _render_pdf_pages_to_png(blob, pages_to_render, dpi=160)
    schema = _parser_schema(None)
    _cfg_extra = {}
    _t = os.getenv("PARSER_TEMPERATURE", "").strip()
    if _t:
        try:
            _cfg_extra["temperature"] = float(_t)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(
        **_cfg_extra,
        response_mime_type="application/json",
        response_schema=schema, max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),  # techo por-llamada
        system_instruction=(
            "Sos un extractor experto en documentos del Sistema Electrónico de "
            "Contrataciones del Estado (SEACE) del Perú y del Organismo Especializado "
            "para las Contrataciones Eficientes del Estado (OECE / ex-OSCE). "
            "Procesás Bases Administrativas, Términos de Referencia (TDR), "
            "Especificaciones Técnicas (EETT), Expedientes Técnicos, Actas de Buena "
            "Pro, Contratos y Propuestas Económicas.\n"
            "\n"
            "ENTRADA: vas a recibir UN PDF en `application/pdf`. ADEMÁS, en muchos "
            "casos vas a recibir entre 1 y 30 imágenes PNG ADICIONALES. Esas imágenes "
            "son RENDERS A 160 DPI de páginas específicas del MISMO PDF cuyo "
            "contenido está rasterizado como imagen embebida (típico en bases del "
            "OECE — la sección REQUERIMIENTO viene casi siempre como imagen pegada en "
            "un PDF, NO como texto). El prompt del usuario te indica el número de "
            "página al que corresponde cada PNG. DEBÉS combinar el texto extraíble "
            "del PDF con el contenido de las imágenes para reconstruir la información "
            "completa. SIN las imágenes el REQUERIMIENTO no se ve.\n"
            "\n"
            "MISIÓN CRÍTICA: localizar la sección 'REQUERIMIENTO' (también llamada "
            "'Términos de Referencia', 'Especificaciones Técnicas', 'Características "
            "Técnicas del Bien', 'Características Técnicas del Servicio', 'Alcance "
            "del Servicio' o 'Características de la Obra') y EXTRAERLA A CAMPOS "
            "ESTRUCTURADOS — no transcribir, no perder información, no truncar.\n"
            "\n"
            "⚠ ANTI-ALUCINACIÓN — REGLA CRÍTICA DE INTEGRIDAD:\n"
            "  · NUNCA INVENTES contenido. Si no podés leer claramente el texto del\n"
            "    PDF (porque está mal rasterizado, las imágenes adjuntas no son\n"
            "    legibles, o el PDF aparenta estar dañado), respondé:\n"
            "      contiene_requerimiento=false\n"
            "      items=[]\n"
            "      resumen='No se pudo extraer información legible del documento'\n"
            "    NO completes con un caso 'genérico' o 'plantilla' (ej. servicio de\n"
            "    limpieza, kit de útiles, broca traumatológica) basado en tu memoria\n"
            "    de bases administrativas peruanas. Si NO está EN EL DOCUMENTO,\n"
            "    NO existe.\n"
            "  · El OBJETO DEL CONTRATO viene en el OCDS (entregado por la entidad)\n"
            "    y debe coincidir con lo que extraés del PDF. Si tu extracción\n"
            "    discrepa radicalmente del objeto OCDS (ej. OCDS dice 'codeína\n"
            "    fosfato' pero el PDF según vos habla de 'limpieza'), prioritariamente\n"
            "    revisá si te equivocaste leyendo el PDF — probablemente el PDF\n"
            "    SÍ habla de codeína y vos lo malinterpretaste.\n"
            "\n"
            "\n"
            "REGLAS DE EXTRACCIÓN ESTRUCTURADA (no perder NADA relevante):\n"
            "  · Sos un EXTRACTOR ESTRUCTURADO. Tu trabajo es leer el documento y\n"
            "    volcar TODA la información relevante a CAMPOS DISCRETOS. Cada dato\n"
            "    tiene su lugar específico en el schema:\n"
            "      - Marca/modelo →  `marca_o_modelo_exigido` (string)\n"
            "      - Normas técnicas →  `certificaciones_exigidas` (lista corta)\n"
            "      - Valores numéricos (potencia, capacidad, año, peso, alcance)\n"
            "        →  `valores_tecnicos_clave` (objeto con campos numéricos discretos)\n"
            "      - Garantía →  `garantia` (objeto: meses, horas, alcance)\n"
            "      - Plazo y lugar de entrega →  `condiciones_entrega` (objeto)\n"
            "      - Requisitos al postor (experiencia mínima en soles, años,\n"
            "        certificaciones del postor como 'concesionario MTC', infra)\n"
            "        →  `requisitos_postor` (objeto)\n"
            "      - Penalidades (causal + % + base de cálculo)\n"
            "        →  `penalidades` (lista de objetos)\n"
            "      - Si el ítem es un PAQUETE/LOTE/CANASTA con N productos\n"
            "        adentro (típico en bases de alimentos, kits escolares)\n"
            "        →  `subitems` (lista anidada, NO uses sub-numeración\n"
            "        en items[] para esto; usá esta lista)\n"
            "      - El requerimiento del ítem, LITERAL (sin resumir, ≤ 4000 chars)\n"
            "        →  `texto_literal` + `texto_literal_paginas` + `evidencia` [{pagina, cita}]\n"
            "\n"
            "  · La spec técnica va en CAMPOS DISCRETOS y, además, copiada LITERAL en\n"
            "    `texto_literal` (hasta 4000 chars por ítem). NO resumas ni reescribas.\n"
            "  · EVIDENCIA: cada ítem/postor/firmante/comité/motivo lleva `evidencia`\n"
            "    [{pagina, cita}] con la página del marcador ⟦p.N⟧ y una cita textual.\n"
            "\n"
            "  · NO inventés especificaciones que no estén en el PDF/imágenes. Si un\n"
            "    campo no aparece, dejalo null.\n"
            "\n"
            "  · Asociás cada bloque de requerimiento con su NÚMERO DE ÍTEM "
            "(Ítem 1, Ítem 2, etc.). Si el documento tiene un solo ítem global, todo "
            "el REQUERIMIENTO se asocia a ese ítem.\n"
            "  · Si en el PDF figuran TABLAS de ítems (frecuente en bases para "
            "alimentos, uniformes, medicamentos, útiles), cada FILA de la tabla suele "
            "ser un ítem independiente — extraé un objeto en `items[]` por cada fila.\n"
            "  · NO inventás especificaciones que no estén en el PDF/imágenes.\n"
            "  · Si el documento NO contiene la sección REQUERIMIENTO (ej. es solo un "
            "acta o un contrato), dejá `contiene_requerimiento=false` y "
            "`texto_literal=null` en cada ítem.\n"
            "  · Detectás marcas/modelos explícitos que aparezcan en el documento, "
            "y por separado las certificaciones/normas técnicas (MTC, Euro, Tier, "
            "ISO, NTP, DIGESA, SENASA, ASTM, EPA, etc.). Copiá los strings LITERALES "
            "del PDF — no traduzcas, no normalices, no completes con tu memoria.\n"
            "  · Identificás 'red flags' documentales: especificaciones que restringen "
            "competencia (marca única sin 'o similar', certificación atípica, plazos "
            "ultra-cortos, experiencia desproporcionada, lotes empaquetados sin "
            "justificación).\n"
            "\n"
            "EXTRACCIÓN OBLIGATORIA (CRÍTICO PARA EL PIPELINE INVESTIGATIVO):\n"
            "\n"
            "  · `firmantes`: TODA persona que firma el documento al pie. Suele estar\n"
            "    en la última página con título, nombre, cargo y firma. Capturá nombre\n"
            "    completo, DNI (si aparece), cargo institucional, rol respecto al\n"
            "    documento (aprobador / evaluador / presidente_comite / representante_proveedor /\n"
            "    testigo) y entidad. ESPECIALMENTE en actas de buena pro y contratos.\n"
            "    Este dato es lo que cruzaremos con el gerente del proveedor para\n"
            "    detectar parentezco o cargo previo compartido.\n"
            "\n"
            "  · `comite_evaluacion`: composición del Comité de Selección / Comisión\n"
            "    Evaluadora si el documento lo lista. Capturá nombre, cargo, rol\n"
            "    (presidente/miembro_titular/miembro_suplente/secretario) y certificación\n"
            "    SICAN si se menciona.\n"
            "\n"
            "  · `motivos_adjudicacion`: si es Acta de Buena Pro o Reporte, para CADA\n"
            "    postor ganador documentá: por qué ganó (criterio_decisivo: 'menor\n"
            "    precio', 'único postor admitido', 'mejor calificación técnica', 'sorteo'),\n"
            "    posición en ranking, observaciones del comité (descalificaciones de\n"
            "    otros postores, ajustes de precio, etc.), competidores_descalificados\n"
            "    con razones específicas.\n"
            "\n"
            "  · `lugar_fecha_acta`: lugar, fecha y hora de emisión cuando aplique.\n"
            "\n"
            "🚨 BASES ADMINISTRATIVAS ≠ ACTA DE BUENA PRO 🚨\n"
            "Las BASES ADMINISTRATIVAS se publican ANTES de la convocatoria. NO\n"
            "tienen ni firmantes del comité, ni motivos de adjudicación, ni acta\n"
            "de buena pro. Esos datos solo existen en documentos posteriores:\n"
            "Acta de Buena Pro, Contrato firmado, Cuadro de Evaluación.\n"
            "Si el documento que estás procesando es BASES ADMINISTRATIVAS o\n"
            "TÉRMINOS DE REFERENCIA, dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes un\n"
            "comité de selección, ni un Presidente del Comité, ni una fecha de\n"
            "firma — eso es alucinación.\n"
            "\n"
            "Si el documento NO es un acta / reporte / contrato (ej. son bases\n"
            "administrativas puras), dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes nombres,\n"
            "cargos, RUCs, entidades, lugares ni fechas. JAMÁS uses placeholders\n"
            "tipo 'LUGAR_ACTA_EXAMPLE', 'FIRMANTE_ACTA_EXAMPLE', 'CARGO_EXAMPLE',\n"
            "'POSTOR_1_EXAMPLE', 'ENTIDAD_CONTRATANTE_EXAMPLE', '12345678901',\n"
            "'Nombre Apellido', 'Funcionario X', 'Juan Perez Quispe', 'Juan Pérez',\n"
            "ni cualquier valor genérico — son alucinaciones. Si el dato no está\n"
            "en el PDF, el campo va vacío/null. PREFERÍ campo vacío a campo\n"
            "inventado.\n"
            "\n"
            "REGLA DURA — VALIDACIÓN DE FIRMANTE:\n"
            "Para emitir un objeto en `firmantes[]` DEBÉS tener AL MENOS UNO de:\n"
            "  (a) DNI explícito del firmante (8 dígitos visibles en el PDF), o\n"
            "  (b) Nombre de la entidad REAL del firmante (no 'Entidad\n"
            "      Contratante' literal, sino 'Municipalidad de X', 'Ministerio\n"
            "      de Y', con nombre concreto que aparece en el PDF), o\n"
            "  (c) Imagen/firma escaneada visible al pie del documento que\n"
            "      acompañe un nombre legible.\n"
            "Si NINGUNA de las tres se cumple, el firmante NO va al output.\n"
            "\n"
            "Devolvé SOLO JSON conforme al schema, sin markdown, sin fences."
        ),
    )

    # ── Armado de parts ─────────────────────────────────────────────
    docai_note = ""
    if docai_text:
        # CON Document AI: mandamos SOLO el texto OCR del documento completo
        # (sin el PDF ni PNGs) → 1 llamada Gemini lean. Cap 1M chars ≈ 250K
        # tokens (cubre ~330 págs; entra de sobra en el contexto de Gemini 2.5).
        parts: list = [gtypes.Part.from_text(text=(
            "═══ TEXTO OCR DEL DOCUMENTO COMPLETO (Google Document AI, alta fidelidad) ═══\n"
            + docai_text[:1000000]
        ))]
        docai_note = (
            "ARRIBA está el TEXTO OCR COMPLETO del documento entero, extraído por "
            "Google Document AI (incluye tablas y páginas que estaban rasterizadas "
            "como imagen). Es la ÚNICA fuente — extraé de ahí TODOS los ítems, "
            "especificaciones técnicas y banderas. Procesá el documento completo.\n\n"
        )
    else:
        # SIN Document AI (fallback): PDF + PNGs renderizados (Gemini Vision).
        parts = [gtypes.Part.from_bytes(data=blob, mime_type="application/pdf")]
    render_note = ""
    if rendered:
        pages_human = ", ".join(str(i + 1) for i, _ in rendered)
        render_note = (
            f"ADJUNTO {len(rendered)} imágenes PNG a 160 DPI correspondientes a las "
            f"páginas {pages_human} del PDF (en ese mismo orden). Esas páginas tienen "
            f"el contenido RASTERIZADO COMO IMAGEN dentro del PDF (no texto extraíble), "
            f"por eso te las paso por separado. Hacé OCR visual sobre ellas y "
            f"transcribí palabra por palabra cualquier especificación técnica, tabla "
            f"de ítems, listado de marcas, certificación, plazo o requisito que "
            f"contengan. Lo más probable es que el REQUERIMIENTO completo viva "
            f"acá.\n\n"
        )
        for idx, png in rendered:
            parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))

    layout_note = ""
    if layout and not layout.get("error"):
        layout_note = (
            f"Layout detectado por PyMuPDF: {layout['n_pages']} páginas, "
            f"{layout['total_text_chars']:,} chars de texto extraíble, "
            f"{len(layout.get('low_text_pages') or [])} páginas con < 300 chars "
            f"de texto, {len(layout.get('needs_render_pages') or [])} páginas "
            f"rasterizadas (con contenido en imagen).\n\n"
        )

    prompt = (
        f"PDF a procesar: {source_label}.\n\n"
        f"{layout_note}"
        f"{docai_note}"
        f"{render_note}"
        "Hacé esto, en este orden:\n"
        "\n"
        "PASO 1 — Identificá el tipo de documento (Bases Administrativas, TDR, EETT, "
        "Acta de Buena Pro, Contrato, Propuesta, etc.) y completá `tipo_documento_detectado`.\n"
        "\n"
        "PASO 2 — BUSCÁ la sección REQUERIMIENTO. Suele estar en el Capítulo III de las "
        "Bases Estándar del OECE, titulada 'REQUERIMIENTO' o 'TÉRMINOS DE REFERENCIA' o "
        "'ESPECIFICACIONES TÉCNICAS'. Si la encontrás (sea como texto del PDF o como "
        "contenido OCR de las imágenes adjuntas), marcá `contiene_requerimiento=true`.\n"
        "\n"
        "PASO 3 — Para CADA ítem del proceso (1, 2, 3... — si hay tabla de ítems en\n"
        "el documento o en las imágenes, cada fila es un ítem) extraé toda la info\n"
        "del REQUERIMIENTO técnico en CAMPOS DISCRETOS del schema:\n"
        "\n"
        "  IDENTIFICACIÓN:\n"
        "  · `numero` (string): '1', '1.1', '2', etc.\n"
        "  · `padre_ocds_item`: null si es ítem root del OCDS; el número del padre\n"
        "    si es un sub-ítem dentro de un ítem compuesto.\n"
        "  · `descripcion_corta` (≤200 chars): TÍTULO del ítem tal como aparece en\n"
        "    el documento (no inventes una más corta).\n"
        "  · `cantidad`, `unidad`, `precio_unitario_referencial`, `cuantia_referencial_item`.\n"
        "\n"
        "  MARCA Y NORMAS (copia LITERAL del documento, NO uses ejemplos de memoria):\n"
        "  · `marca_o_modelo_exigido` (string corto): texto exacto del documento si\n"
        "    el ítem exige una marca/modelo. 'sin marca' si el ítem es genérico.\n"
        "    Null si la sección no menciona requisito de marca.\n"
        "  · `certificaciones_exigidas` (lista corta): solo los códigos de norma\n"
        "    LITERALES del documento (cada string como aparece).\n"
        "\n"
        "  VALORES NUMÉRICOS CLAVE (objeto `valores_tecnicos_clave`):\n"
        "    Llená SOLO los campos que aparecen en el documento; resto null:\n"
        "      potencia_min_hp / potencia_min_kw / capacidad_volumen ('1.0 m3') /\n"
        "      capacidad_carga_ton / peso_operativo_ton / alcance_m /\n"
        "      ano_fabricacion_min / estado ('nueva sin uso') /\n"
        "      presentacion (para consumibles: 'saco 50kg', 'lata 140g') /\n"
        "      color / material.\n"
        "\n"
        "  GARANTÍA (objeto `garantia`):\n"
        "      meses (int) / horas (int — maquinaria) / alcance ('comercial', 'fábrica').\n"
        "\n"
        "  ENTREGA (objeto `condiciones_entrega`):\n"
        "      plazo_dias_calendario / lugar_entrega / modalidad ('única', 'parcial').\n"
        "\n"
        "  REQUISITOS AL POSTOR (objeto `requisitos_postor`):\n"
        "      experiencia_minima_soles / anos_experiencia_min /\n"
        "      n_contratos_similares / certificaciones_postor (ej. 'concesionario MTC',\n"
        "      'representante oficial de marca') / infraestructura_exigida /\n"
        "      personal_clave.\n"
        "\n"
        "  PENALIDADES (lista `penalidades`):\n"
        "      [{causal, monto_o_porcentaje, base_calculo}, ...].\n"
        "      Ej. {causal: 'mora en entrega', monto_o_porcentaje: '0.10%',\n"
        "           base_calculo: 'sobre monto del bien por cada día'}.\n"
        "\n"
        "  SUB-ÍTEMS — si el ítem es un PAQUETE/LOTE/CANASTA con varios productos:\n"
        "      `subitems`: [{descripcion, cantidad, unidad, presentacion, specs_clave},...]\n"
        "      Ej. para 'CANASTA DE ALIMENTOS':\n"
        "        [{descripcion: 'Arroz superior', cantidad: 2, unidad: 'BOLSA',\n"
        "          presentacion: '1kg', specs_clave: 'grano largo, taquillado'}, ...]\n"
        "\n"
        "  REQUERIMIENTO LITERAL (`texto_literal`, ≤ 4000 chars):\n"
        "    Extracto copiado tal cual del documento con las especificaciones del ítem\n"
        "    (marca, normas, dimensiones, garantía, plazo, requisitos del postor). NO es\n"
        "    resumen: no reescribas, no completes con tu memoria. Anotá en\n"
        "    `texto_literal_paginas` las páginas (⟦p.N⟧) que abarca y en `evidencia`\n"
        "    una cita textual con su página. Si el documento no tiene requerimiento\n"
        "    para el ítem, null.\n"
        "\n"
        "PASO 4 — Identificá `postores` (RUC, razón social, monto, ganador) si el PDF/imágenes los "
        "mencionan (típicamente en actas y propuestas).\n"
        "\n"
        "PASO 5 — `fundamento_legal` (lista de artículos citados textualmente por el\n"
        "documento: 'Art. 55.1.b Ley 32069', 'Art. 2 TUO Ley 30225', 'D.S. 009-2025-EF\n"
        "Art. 12', etc.). Solo LO QUE EL DOCUMENTO CITA — no interpretes si están bien\n"
        "invocados o no. Eso lo evalúa `document_legal_analyst_agent` aparte.\n"
        "\n"
        "PASO 5.5 — SEGÚN EL TIPO DE DOCUMENTO, llená UNO de estos objetos (o ninguno):\n"
        "  · Si es RESUMEN EJECUTIVO o 'Informe que sustenta' (justifica una directa o\n"
        "    comparación de precios) → completá `estudio_mercado` (valor referencial,\n"
        "    comparación de precio histórico LITERAL, causal/artículo invocado, texto de\n"
        "    la causal, proveedores evaluados, descalificaciones). Es el 'POR QUÉ' del proceso.\n"
        "  · Si es ORDEN DE COMPRA / CONTRATO firmado ('Archivos del contrato') →\n"
        "    completá `contrato_final` (precio FINAL total + moneda, cronograma de\n"
        "    entregas, penalidades, forma de pago, RUC del proveedor). Es lo REALMENTE pagado.\n"
        "  · En CUALQUIER OTRO documento (Bases, acta, presentación, cuadros) → dejá\n"
        "    AMBOS objetos en null. NO inventes; copiá montos/causales LITERALES del PDF.\n"
        "\n"
        "PASO 6 — `cuantia_total`, `fuente_financiamiento`, `modalidad` (suma alzada / precios "
        "unitarios / esquema mixto / tarifas) y `resumen` (3-4 líneas).\n"
        "\n"
        "REGLAS FINALES:\n"
        "  · Sos EXTRACTOR puro: extraés HECHOS del documento. NO emitís juicios\n"
        "    legales ni banderas de riesgo — eso lo hace `document_legal_analyst_agent`\n"
        "    sobre tu output. Si tu extracción es buena (campos discretos completos,\n"
        "    frases textuales preservadas, sin invención), el analyst hace su trabajo\n"
        "    sin problema.\n"
        "  · Si el documento NO es una base / TDR / EETT, `contiene_requerimiento=false` y "
        "los requerimientos por ítem quedan en null.\n"
        "  · Devolvé SOLO JSON. SIN markdown, SIN fences, SIN texto antes ni después."
    )
    parts.append(gtypes.Part.from_text(text=prompt))

    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(
                    model=DEFAULT_GEMINI_MODEL, contents=parts, config=config,
                ),
            )
        text = (resp.text or "").strip()
        data = _safe_parse_json(text)
        if not isinstance(data, dict) or not data:
            return {"error": f"non-json response: {text[:200]}"}
        if "MAX_TOKENS" in _finish_reason(resp).upper():
            data["_truncado"] = True
        for _it in (data.get("items") or []):
            if isinstance(_it, dict) and _it.get("texto_literal") and not _it.get("requerimiento_tecnico_detallado"):
                _it["requerimiento_tecnico_detallado"] = _it["texto_literal"]
        data["_size_bytes"] = len(blob)
        data["_source"] = source_label
        data["_pdf_layout"] = {
            "n_pages": layout.get("n_pages"),
            "rendered_pages_1based": [i + 1 for i, _ in rendered],
            "total_text_chars": layout.get("total_text_chars"),
            "es_pdf_completamente_escaneado": layout.get("es_pdf_completamente_escaneado"),
        }
        # LOGGING DE ORIGEN POR-PDF (caza-contaminación): qué documento produjo
        # qué ítems. Si un run de acelerómetros loguea 'CARNE DE RES', el source
        # apunta al PDF/URL cruzado → confirma fetch-chain vs parser.
        try:
            _it = data.get("items") or []
            _first = str((_it[0] if _it else {}).get("descripcion_corta") or "")[:90]
            print(f"[parser-src] src={source_label} · bytes={len(blob)} · "
                  f"n_items={len(_it)} · first='{_first}'", flush=True)
        except Exception:
            pass
        return data
    except Exception as e:
        return {"error": f"gemini failed: {str(e)[:150]}", "_source": source_label}

def _fetch_doc_bytes(document_url: str, tool_context: ToolContext) -> tuple[bytes | None, str, str | None]:
    """Obtiene los bytes de un documento intentando 4 caminos en orden:

      1. state['docs_b64'][url]      → b64 inline (path rápido, cuando el
                                       bridge pre-cargó por POST).
      2. state['doc_urls'][url]      → URL pública de GCS donde el bridge
                                       archivó el PDF. Descargamos con
                                       google-cloud-storage (auth automática
                                       con la SA del Cloud Run).
      3. OECE_RELAY_URL (env var)    → Cloudflare Worker que bypassa el WAF.
      4. Descarga directa            → último recurso (SEACE bloquea IPs GCP,
                                       devuelve 403 casi seguro).

    Returns:
        (bytes_o_None, fuente_str, mensaje_error_o_None)
        fuente_str ∈ {'inline_b64', 'gcs', 'relay', 'direct'}
    """
    # Helper: normalizar URL para matching robusto (sin query/fragment, sin trailing slash).
    # Necesario porque la URL del OCDS puede tener variantes (?v=1, /, encoding) que
    # difieren de la URL que el cliente registró en doc_urls/docs_b64.
    def _norm(u: str) -> str:
        try:
            from urllib.parse import urlparse, urlunparse
            p = urlparse(u)
            path = p.path.rstrip("/")
            return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", "")).lower()
        except Exception:
            return (u or "").lower()

    target_norm = _norm(document_url)

    def _lookup(d: dict):
        if document_url in d:
            return d[document_url]
        # Fallback: match por URL normalizada
        for k, v in d.items():
            if _norm(k) == target_norm:
                return v
        return None

    # 1) inline b64
    docs_b64 = tool_context.state.get("docs_b64") or {}
    pdf_b64 = _lookup(docs_b64)
    if pdf_b64:
        try:
            return base64.b64decode(pdf_b64, validate=True), "inline_b64", None
        except Exception as e:
            return None, "inline_b64", f"invalid_b64: {e}"

    # 2) GCS (preferido cuando no hay b64)
    doc_urls = tool_context.state.get("doc_urls") or {}
    gcs_target = _lookup(doc_urls)
    if gcs_target:
        blob, err = _download_from_gcs(gcs_target)
        if blob is not None:
            return blob, "gcs", None
        # si GCS falla, seguimos a relay/directo
        gcs_error = err
    else:
        gcs_error = None

    # 2.5) Downloader local (puente residencial peruano vía túnel) — el path
    #      CONFIABLE: SEACE bloquea IPs de datacenter (Cloud Run, colos de CF)
    #      con 403 pero acepta IPs residenciales PE. El servicio corre en la
    #      máquina del usuario, descarga con su IP, sube a GCS y devuelve gs://.
    dl_base = os.getenv("LOCAL_DOWNLOADER_URL", "").strip()
    if dl_base:
        try:
            ocid_hint = (
                tool_context.state.get("ocid")
                or tool_context.state.get("ocid_preloaded")
                or ""
            )
            r = requests.post(
                f"{dl_base.rstrip('/')}/download",
                json={"url": document_url, "ocid": ocid_hint},
                headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                timeout=180,
            )
            if r.status_code == 200:
                gs = (r.json() or {}).get("gcs_path")
                if gs:
                    blob, err = _download_from_gcs(gs)
                    if blob is not None:
                        return blob, "local_downloader", None
                    downloader_error = f"downloader_gcs_read={err}"
                else:
                    downloader_error = "downloader_sin_gcs_path"
            else:
                downloader_error = f"downloader HTTP {r.status_code}"
        except Exception as e:
            downloader_error = f"downloader_exception: {str(e)[:120]}"
    else:
        downloader_error = None

    # 3) relay (Cloudflare Worker)
    relay_base = os.getenv("OECE_RELAY_URL", "").strip()
    if relay_base:
        try:
            relay_url = (
                f"{relay_base.rstrip('/')}/?url={requests.utils.quote(document_url, safe='')}"
            )
            r = requests.get(relay_url, headers=BROWSER, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, "relay", None
            relay_error = f"relay HTTP {r.status_code}"
        except Exception as e:
            relay_error = f"relay_exception: {str(e)[:120]}"
    else:
        relay_error = "OECE_RELAY_URL no configurado"

    # 4) directo
    try:
        r = requests.get(document_url, headers=BROWSER, timeout=30)
        if r.status_code == 200:
            return r.content, "direct", None
        direct_error = f"direct HTTP {r.status_code}"
    except Exception as e:
        direct_error = f"direct_exception: {str(e)[:120]}"

    # Todo falló — construimos error compuesto
    parts = []
    if gcs_target:
        parts.append(f"gcs={gcs_error or 'failed'}")
    if dl_base:
        parts.append(f"downloader={downloader_error}")
    parts.append(f"relay={relay_error}")
    parts.append(direct_error)
    return None, "failed", " · ".join(parts)

def _download_from_gcs(gcs_or_https_url: str) -> tuple[bytes | None, str | None]:
    """Descarga bytes desde GCS. Acepta dos formas de URL:
      · gs://bucket/path                          → usa google-cloud-storage SDK
      · https://storage.googleapis.com/bucket/p   → requests.get directo (más rápido,
        sin auth — funciona con buckets públicos de lectura que es nuestro caso).

    Para buckets privados con SA en Cloud Run, el path SDK se autentica con
    Application Default Credentials.
    """
    if gcs_or_https_url.startswith("https://"):
        try:
            r = requests.get(gcs_or_https_url, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, None
            return None, f"https GET HTTP {r.status_code}"
        except Exception as e:
            return None, f"https_exception: {str(e)[:200]}"

    # gs:// → SDK
    if not gcs_or_https_url.startswith("gs://"):
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    try:
        from google.cloud import storage
    except Exception as e:
        return None, f"google-cloud-storage no instalado: {e}"
    rest = gcs_or_https_url[5:]
    if "/" not in rest:
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    bucket_name, blob_path = rest.split("/", 1)
    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        data = blob.download_as_bytes()
        if data and len(data) > 100:
            return data, None
        return None, "gcs blob vacío o muy chico"
    except Exception as e:
        return None, f"gcs_exception: {str(e)[:200]}"

def _is_docx_blob(blob: bytes) -> bool:
    """True si el blob es un archivo DOCX (Office Open XML).
    Un DOCX siempre empieza con PK (ZIP) y contiene `word/document.xml`.
    SEACE V3 publica algunas Bases Administrativas en DOCX en lugar de PDF.
    """
    if not blob or blob[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            names = z.namelist()
            return any(n == "word/document.xml" for n in names)
    except zipfile.BadZipFile:
        return False

def _docx_to_synthetic_pdf(blob: bytes) -> bytes | None:
    """Convierte un DOCX en un PDF sintético procesable por el pipeline de
    Gemini. Estrategia híbrida:

      1. Extrae texto + tablas con python-docx → páginas de texto plano.
      2. Extrae imágenes embebidas (word/media/*) → páginas separadas con cada
         imagen renderizada full-page.

    El PDF sintético NO es visualmente bonito pero sí leíble por Gemini, que
    hará OCR Vision sobre las imágenes y leerá el texto plano directamente.

    Returns: bytes del PDF resultante o None si la conversión falla.
    """
    try:
        from docx import Document
        import fitz
    except Exception:
        return None

    # 1. Texto + tablas del DOCX
    text_chunks: list[str] = []
    try:
        d = Document(io.BytesIO(blob))
        for para in d.paragraphs:
            t = (para.text or "").strip()
            if t:
                text_chunks.append(t)
        for tbl in d.tables:
            for row in tbl.rows:
                cells = [(c.text or "").strip() for c in row.cells]
                line = " | ".join(c for c in cells if c)
                if line.strip(" |"):
                    text_chunks.append(line)
    except Exception:
        pass

    # 2. Imágenes embebidas (PNG/JPEG/etc en word/media/)
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():
                if name.startswith("word/media/") and not name.endswith("/"):
                    ext = name.rsplit(".", 1)[-1].lower()
                    if ext in ("png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"):
                        try:
                            images.append((name, z.read(name)))
                        except Exception:
                            continue
    except Exception:
        pass

    if not text_chunks and not images:
        return None

    # 3. Construir PDF sintético con PyMuPDF
    out_doc = fitz.open()
    full_text = "\n".join(text_chunks)
    # Páginas de texto: A4 portrait, 1700pt de alto, 595pt de ancho
    PAGE_W, PAGE_H = 595, 842
    MARGIN = 36
    FONT_SIZE = 9
    LINE_H = 12
    if full_text:
        # Dividir en chunks que caben en una página
        max_chars_per_page = 4500  # heurístico
        text_pages = [full_text[i:i + max_chars_per_page]
                      for i in range(0, len(full_text), max_chars_per_page)] or [""]
        for chunk in text_pages:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            try:
                page.insert_textbox(
                    fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                    chunk, fontsize=FONT_SIZE, fontname="helv",
                )
            except Exception:
                # Fallback: insertar como texto plano sin caja
                try:
                    page.insert_text((MARGIN, MARGIN + FONT_SIZE), chunk[:3000], fontsize=FONT_SIZE)
                except Exception:
                    pass
    # Páginas de imagen: una imagen por página (full-bleed)
    for name, img_bytes in images:
        try:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            page.insert_image(
                fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                stream=img_bytes,
            )
        except Exception:
            continue
    try:
        pdf_bytes = out_doc.tobytes()
    finally:
        out_doc.close()
    return pdf_bytes if pdf_bytes else None

def _images_to_synthetic_pdf(images: list[tuple[str, bytes]]) -> bytes | None:
    """Convierte una lista de imágenes (JPG/PNG/TIFF/BMP) en un PDF sintético
    de 1 imagen por página. Útil para bases SEACE que vienen como ZIP de
    escaneos sueltos. Gemini hace OCR Vision sobre cada página.
    """
    try:
        import fitz  # PyMuPDF
    except Exception:
        return None
    if not images:
        return None
    out = fitz.open()
    try:
        for name, img_bytes in images:
            try:
                # Insertar como página completa A4 (vertical o horizontal según aspect)
                pix = fitz.Pixmap(img_bytes)
                w, h = pix.width, pix.height
                # A4 = 595x842 pt; ajustamos orientación
                if w > h:
                    page = out.new_page(width=842, height=595)
                else:
                    page = out.new_page(width=595, height=842)
                rect = page.rect
                page.insert_image(rect, stream=img_bytes)
            except Exception:
                continue
        if len(out) == 0:
            return None
        pdf_bytes = out.tobytes()
    finally:
        out.close()
    return pdf_bytes if pdf_bytes else None

def parse_document_pdf(document_url: str, tool_context: ToolContext) -> dict:
    """Descarga un documento de SEACE y lo procesa con Gemini 2.5 Flash.
    SI el documento es un ZIP, descomprime y procesa TODOS los PDFs internos
    en paralelo (hasta 5 por archivo). Devuelve un consolidado.

    Estrategia de descarga (en orden):
      1. state['docs_b64'][url] — inline b64 del bridge (PDFs chicos).
      2. state['doc_urls'][url] — GCS bucket (PDFs grandes archivados por el bridge).
      3. OECE_RELAY_URL — Cloudflare Worker que bypassa el WAF.
      4. Directo — último recurso (suele dar 403 desde IPs de GCP).

    Args:
        document_url: URL del documento (`tender.documents[].url` del OCDS).

    Returns:
        Diccionario con `pdfs_procesados` (lista, uno por PDF interno), más
        consolidados: items_consolidados, postores_consolidados, red_flags,
        cuantia_total, fundamento_legal. Si la descarga falló, devuelve
        `error` + `_fetch_attempts` describiendo qué se intentó.
    """
    # ── Caché por URL (fix #2): si ya parseamos este documento en este run, NO
    #    re-descargamos ni re-OCR'eamos (Document AI + Gemini son caros). El primer
    #    parseo ya volcó su data a state['parser_raw_consolidated']; devolvemos el
    #    output compacto cacheado.
    _pdoc_cache = tool_context.state.get("_parsed_doc_cache") or {}
    if document_url in _pdoc_cache:
        print(f"[parse] cache HIT · ...{document_url[-44:]} — evito re-descarga/re-OCR", flush=True)
        return _pdoc_cache[document_url]

    blob, fetch_source, fetch_error = _fetch_doc_bytes(document_url, tool_context)
    if blob is None:
        return {
            "error": "download_failed",
            "url": document_url,
            "_fetch_attempts": fetch_error,
        }

    # Expansión de contenedores SIN topes (ZIP/RAR anidados, DOCX, XLSX, imágenes): cada
    # archivo interno es una unidad, ordenada por la prioridad del perfil. Lo que no se
    # pudo abrir queda en state['recortes'] (antes: 3 PDF + 3 DOCX por ZIP, sin registro).
    _prio = _perfil_params(tool_context.state)[1]
    _unidades, _rec = _expandir_contenedor(blob, document_url.rsplit("/", 1)[-1][:80], _prio)
    if _rec:
        tool_context.state.setdefault("recortes", [])
        tool_context.state["recortes"].extend(_rec)
    pdf_blobs: list[tuple[str, bytes]] = []
    for _u in _unidades:
        if _u["kind"] in ("pdf", "imagenes") and _u.get("data"):
            pdf_blobs.append((_u["nombre"], _u["data"]))
        elif _u["kind"] == "paginas":
            _synth = _paginas_a_pdf_sintetico(_u.get("paginas") or [])
            if _synth:
                pdf_blobs.append((f"{_u['nombre']} (texto→PDF sintético)", _synth))
    if not pdf_blobs:
        return {"error": "sin_contenido_procesable", "url": document_url, "size": len(blob),
                "first_bytes_hex": blob[:8].hex(), "recortes": _rec}

    # Estrategia de partición según el extractor disponible:
    #   · CON Document AI: NO shardeаmos para Gemini. El doc entero va como 1
    #     unidad → docai.extract_text_docai hace OCR (chunkeа a ≤30 págs INTERNO
    #     por el límite de la API) y CONCATENA el texto → Gemini estructura TODO
    #     en UNA sola llamada (90 págs ≈ 200-300K chars, entran de sobra).
    #   · SIN Document AI (fallback): page-sharding histórico — sub-PDFs por
    #     rango → varias llamadas Gemini Vision más chicas en paralelo.
    try:
        from tools.docai import docai_enabled
        _use_docai = docai_enabled()
    except Exception:
        _use_docai = False

    _expanded: list[tuple[str, bytes]] = []
    for (name, b) in pdf_blobs:
        if isinstance(b, (bytes, bytearray)) and b[:4] == b"%PDF" and not _use_docai:
            _expanded.extend(_split_pdf_by_pages(bytes(b), name))
        else:
            _expanded.append((name, b))  # con docai: doc entero (1 sola llamada Gemini)
    pdf_blobs = _expanded

    pdfs_procesados: list[dict] = [None] * len(pdf_blobs)
    # La concurrencia REAL la limita _throttle_gemini (semáforo global) para no
    # gatillar el rate limiter; el pool sólo encola los shards listos.
    #
    # TECHO GLOBAL: `as_completed(timeout=...)` corta a los PARSE_OVERALL_TIMEOUT_S
    # aunque algún shard se haya quedado lento. Antes esto usaba un `with` +
    # `fut.result(timeout=120)` que era código muerto (as_completed sólo entrega
    # futures YA terminados) y, peor, el `with` hacía shutdown(wait=True) → esperaba
    # igual a los hilos lentos. Resultado: una llamada Gemini de 7m+ colgaba toda la
    # corrida y nunca se llegaba al writer/persist/force_flush.
    # Presupuesto GLOBAL compartido: el 1er parse fija el deadline; los siguientes
    # respetan lo que queda. El techo efectivo de ESTE documento = min(techo
    # por-documento, presupuesto global restante), con un piso de 30s.
    _now = time.monotonic()
    _deadline = tool_context.state.get("_parse_deadline")
    if not isinstance(_deadline, (int, float)):
        _deadline = _now + PARSE_GLOBAL_BUDGET_S
        try:
            tool_context.state["_parse_deadline"] = _deadline
        except Exception:
            pass
    _eff_timeout = max(30.0, min(float(PARSE_OVERALL_TIMEOUT_S), _deadline - _now))

    ex = concurrent.futures.ThreadPoolExecutor(max_workers=PARSE_MAX_WORKERS)
    futures = {
        ex.submit(_parse_single_pdf_with_gemini, b, name): i
        for i, (name, b) in enumerate(pdf_blobs)
    }
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=_eff_timeout):
            i = futures[fut]
            try:
                pdfs_procesados[i] = fut.result()
            except Exception as e:
                pdfs_procesados[i] = {"error": f"parallel exec failed: {str(e)[:120]}",
                                       "_source": pdf_blobs[i][0]}
    except concurrent.futures.TimeoutError:
        pendientes = [i for i in futures.values() if pdfs_procesados[i] is None]
        print(f"[parser] techo {_eff_timeout:.0f}s agotado (global restante {_deadline-_now:.0f}s) · "
              f"{len(pendientes)}/{len(futures)} shard(s) sin terminar → marcados timeout",
              flush=True)
        for i in pendientes:
            pdfs_procesados[i] = {"error": f"parse timeout (>{PARSE_OVERALL_TIMEOUT_S}s)",
                                   "_source": pdf_blobs[i][0]}
    finally:
        # No esperamos a los hilos lentos (no se pueden matar en Python); cancelamos
        # los encolados y seguimos el pipeline. Sus llamadas Gemini liberan el
        # semáforo de _throttle_gemini cuando terminen por su cuenta.
        ex.shutdown(wait=False, cancel_futures=True)

    items_all: list[dict] = []
    postores_all: list[dict] = []
    red_flags_all: list[str] = []
    fundamento_all: list[str] = []
    firmantes_all: list[dict] = []
    comite_all: list[dict] = []
    motivos_all: list[dict] = []
    lugar_fecha_acta = None
    cuantia_total = None
    algun_pdf_con_requerimiento = False
    estudio_mercado_best = None   # bloque tipado del Resumen Ejecutivo/Informe
    contrato_final_best = None    # bloque tipado de la Orden de Compra/Contrato

    def _mas_completo(nuevo, actual):
        """Devuelve el dict con más contenido (más campos no-nulos)."""
        def _peso(d):
            if not isinstance(d, dict):
                return 0
            return sum(1 for v in d.values() if v not in (None, "", [], {}))
        return nuevo if _peso(nuevo) > _peso(actual) else actual

    for r in pdfs_procesados:
        if "error" in r:
            continue
        if isinstance(r.get("estudio_mercado"), dict):
            estudio_mercado_best = _mas_completo(r["estudio_mercado"], estudio_mercado_best)
        if isinstance(r.get("contrato_final"), dict):
            contrato_final_best = _mas_completo(r["contrato_final"], contrato_final_best)
        # Los ÍTEMS con especificaciones viven en el documento de REQUERIMIENTO
        # (Bases Administrativas / EETT / TDR). Acta de Buena Pro, Cuadro de evaluación,
        # Invitación y Contrato solo repiten el TÍTULO del contrato como "ítem" (sin
        # specs) → ese era el RUIDO que después había que deduplicar (cabecera-objeto,
        # 9→7, 15→7...). Tomamos ítems SOLO de fuentes de requerimiento: el LLM marcó
        # contiene_requerimiento=true, O algún ítem trae requerimiento_tecnico_detallado
        # real (robusto si el LLM no marcó el flag). Misma filosofía que el gate de
        # comité/motivos por _es_doc_de_adjudicacion (abajo). Si NINGÚN doc resulta
        # fuente de requerimiento, items_consolidados queda vacío y lo cubren los ítems
        # del OCDS (SQL) + la bandera extraccion_documento_fallida — sin meter ruido.
        _es_fuente_req = bool(r.get("contiene_requerimiento")) or any(
            isinstance(it, dict) and len(str(it.get("requerimiento_tecnico_detallado") or "").strip()) > 40
            for it in (r.get("items") or []))
        if _es_fuente_req:
            items_all.extend(r.get("items") or [])
        postores_all.extend(r.get("postores") or [])
        # red_flags_observadas: campo legacy, ya no se pide al parser. El análisis
        # legal lo hace `document_legal_analyst_agent` aparte. Si algún parser
        # legacy aún lo emite, lo recolectamos pero el flujo ya no depende de eso.
        red_flags_all.extend(r.get("red_flags_observadas") or [])
        fundamento_all.extend(r.get("fundamento_legal") or [])
        firmantes_all.extend(r.get("firmantes") or [])
        # comité / motivos de adjudicación / acta SOLO existen en documentos de la
        # etapa de adjudicación/contrato. Si vienen de un Bases/TDR/EETT/Resumen
        # (pre-adjudicación), el LLM los inventó → se ignoran. Gate por tipo de doc.
        if _es_doc_de_adjudicacion(r.get("tipo_documento_detectado")):
            comite_all.extend(r.get("comite_evaluacion") or [])
            motivos_all.extend(r.get("motivos_adjudicacion") or [])
            if r.get("lugar_fecha_acta") and not lugar_fecha_acta:
                lugar_fecha_acta = r.get("lugar_fecha_acta")
        if r.get("contiene_requerimiento"):
            algun_pdf_con_requerimiento = True
        if cuantia_total is None and r.get("cuantia_total"):
            cuantia_total = r["cuantia_total"]

    # Items consolidados: dedup por clave SEMÁNTICA (descripción+cantidad), no por
    # número (fix #1). Priorizamos el `requerimiento_tecnico_detallado` más largo.
    consolidado_by_key: dict = {}
    for it in items_all:
        key = _item_key(it) or ("_unk", len(consolidado_by_key))
        actual = consolidado_by_key.get(key)
        if actual is None:
            consolidado_by_key[key] = dict(it)
            continue
        # Merge: campos no nulos del nuevo sobrescriben sólo si el actual no tiene
        for k, v in it.items():
            if v in (None, "", [], {}):
                continue
            cur = actual.get(k)
            # El requerimiento_tecnico_detallado más LARGO gana
            if k == "requerimiento_tecnico_detallado":
                if not cur or (isinstance(v, str) and len(v) > len(cur or "")):
                    actual[k] = v
            elif cur in (None, "", [], {}):
                actual[k] = v
    items_consolidados = list(consolidado_by_key.values())

    # Deduplicar firmantes por nombre+cargo
    seen_firm = set()
    firmantes_dedup = []
    for f in firmantes_all:
        if not isinstance(f, dict):
            continue
        # Usar `or ""` para tolerar valores None explícitos (que .get() con default
        # no captura — solo captura key-missing).
        key = ((f.get("nombre_completo") or "").strip().upper(),
               (f.get("cargo") or "").strip().upper())
        if key in seen_firm or not key[0]:
            continue
        seen_firm.add(key)
        firmantes_dedup.append(f)

    # Output COMPACTO para no inflar el context del orquestador. La data
    # completa va a state['parser_raw_consolidated'] (líneas abajo) y
    # build_market_input / persist_analysis_outputs la leen desde ahí.
    # Si el orquestador o el agent quieren ver detalle, leen state.
    output_dict = {
        "n_pdfs_procesados": len(pdfs_procesados),
        "n_pdfs_con_error": sum(1 for r in pdfs_procesados if "error" in r),
        "algun_pdf_con_requerimiento": algun_pdf_con_requerimiento,
        "n_items_consolidados": len(items_consolidados),
        "n_postores": len(postores_all),
        "n_firmantes": len(firmantes_dedup),
        "n_motivos_adjudicacion": len(motivos_all),
        "tiene_acta": bool(lugar_fecha_acta),
        "cuantia_total": cuantia_total,
        "_url": document_url,
        "_fetch_source": fetch_source,
        "_note": "Detalle completo en state['parser_raw_consolidated']",
    }
    # Detalle completo SOLO si hubo error en TODOS los PDFs (para debug).
    # Si todo ok, no devolvemos `pdfs_procesados` al caller.
    if output_dict["n_pdfs_con_error"] >= output_dict["n_pdfs_procesados"] and output_dict["n_pdfs_procesados"] > 0:
        output_dict["pdfs_procesados_debug"] = pdfs_procesados

    # GUARDAR el output ACUMULADO en state['parser_raw_consolidated'] para que
    # build_market_input y otros consumers puedan leer la data completa
    # SIN depender de que el agente document_parser la incluya íntegra en
    # su respuesta final (que se guarda en state['document_analysis']).
    # Cada vez que se procesa un PDF, mergeamos sus items/postores/firmantes
    # al acumulador.
    raw = tool_context.state.get("parser_raw_consolidated") or {
        "items_consolidados": [],
        "postores_consolidados": [],
        "firmantes_consolidados": [],
        "comite_evaluacion": [],
        "motivos_adjudicacion": [],
        "red_flags_observadas": [],
        "fundamento_legal": [],
        "documentos": [],
    }
    # Dedup items por clave SEMÁNTICA (fix #1) — antes era por `numero`, que dejaba
    # pasar el mismo ítem numerado distinto en dos documentos ('2' vs '02').
    existing_keys = {}
    for _it in raw["items_consolidados"]:
        _k = _item_key(_it)
        if _k is not None:
            existing_keys[_k] = _it
    for it in items_consolidados:
        k = _item_key(it)
        if k is None:
            raw["items_consolidados"].append(it)
            continue
        prev = existing_keys.get(k)
        if prev is None:
            raw["items_consolidados"].append(it)
            existing_keys[k] = it
        else:
            # Ya existe (mismo ítem desde otro doc): conservamos el requerimiento
            # técnico más largo y descartamos el duplicado.
            new_req = it.get("requerimiento_tecnico_detallado") or ""
            cur_req = prev.get("requerimiento_tecnico_detallado") or ""
            if len(new_req) > len(cur_req):
                prev["requerimiento_tecnico_detallado"] = new_req
    # Dedup postores por RUC
    seen_rucs = {p.get("ruc") for p in raw["postores_consolidados"] if p.get("ruc")}
    for p in postores_all:
        if p.get("ruc") and p["ruc"] not in seen_rucs:
            raw["postores_consolidados"].append(p)
            seen_rucs.add(p["ruc"])
        elif not p.get("ruc"):
            raw["postores_consolidados"].append(p)
    # Dedup firmantes por (nombre, cargo)
    seen_firm = {((f.get("nombre_completo") or "").upper(), (f.get("cargo") or "").upper())
                 for f in raw["firmantes_consolidados"]}
    for f in firmantes_dedup:
        key = ((f.get("nombre_completo") or "").upper(), (f.get("cargo") or "").upper())
        if key not in seen_firm:
            raw["firmantes_consolidados"].append(f)
            seen_firm.add(key)
    # Extends simples
    raw["comite_evaluacion"].extend(comite_all)
    raw["motivos_adjudicacion"].extend(motivos_all)
    raw["red_flags_observadas"] = list(dict.fromkeys(
        raw["red_flags_observadas"] + list(red_flags_all)
    ))
    raw["fundamento_legal"] = list(dict.fromkeys(
        raw["fundamento_legal"] + list(fundamento_all)
    ))
    raw["documentos"].append({
        "url": document_url,
        "n_pdfs_procesados": len(pdfs_procesados),
        "n_pdfs_con_error": sum(1 for r in pdfs_procesados if "error" in r),
        "algun_pdf_con_requerimiento": algun_pdf_con_requerimiento,
        "_fetch_source": fetch_source,
    })
    if lugar_fecha_acta and not raw.get("lugar_fecha_acta"):
        raw["lugar_fecha_acta"] = lugar_fecha_acta
    if cuantia_total and not raw.get("cuantia_total"):
        raw["cuantia_total"] = cuantia_total

    # NOTA: NO hay consolidación/dedup fuzzy de ítems. Los ítems vienen SOLO de la fuente
    # de requerimiento (la Bases — gate de `items_all` arriba) y Document AI manda esa
    # Bases a Gemini en UNA sola extracción → la lista ya sale limpia. El dedup por
    # `_item_key` (descripción+cantidad, arriba) basta para fundir un mismo renglón
    # repetido entre documentos SIN fusionar productos distintos. Se eliminó el pase LLM
    # de consolidación y las heurísticas (_merge_item_variants/_es_cabecera_objeto): con
    # una sola fuente limpia eran complejidad autoinfligida y sobre-fusionaban ítems
    # legítimamente distintos (ej. 'AMPLIFICADOR DE AUDIO' vs 'AMPLIFICADOR DE AUDIO DE 600 W').
    print(f"[parser] {len(raw.get('items_consolidados') or [])} ítems (de la fuente de requerimiento, sin dedup fuzzy)", flush=True)

    tool_context.state["parser_raw_consolidated"] = raw

    # ── Bloques tipados (ruteo incremental) ──
    # El Resumen Ejecutivo / Orden de Compra suelen venir en llamadas distintas a
    # parse_document_pdf; acumulamos quedándonos con el más completo entre corridas.
    if estudio_mercado_best:
        tool_context.state["estudio_mercado"] = _mas_completo(
            estudio_mercado_best, tool_context.state.get("estudio_mercado"))
        output_dict["tiene_estudio_mercado"] = True
    if contrato_final_best:
        tool_context.state["contrato_final"] = _mas_completo(
            contrato_final_best, tool_context.state.get("contrato_final"))
        output_dict["tiene_contrato_final"] = True

    # Cachear el output compacto por URL (fix #2) para no re-parsear el mismo doc.
    _pdoc_cache[document_url] = output_dict
    tool_context.state["_parsed_doc_cache"] = _pdoc_cache

    return output_dict


# ── Capa 2 (LLM único de sanitización) ─────────────────────────────────────
# Esta herramienta es la ÚNICA responsable de producir la lista canónica de productos
# a partir de los items crudos que dejó el parseo (que pueden tener duplicados por OCR
# ruidoso, el mismo bien numerado distinto en dos documentos ['001' vs '1'], o el
# título del contrato colándose como ítem). NO usa thresholds/regex/lookalike — el
# LLM JUZZGA el listado completo con su propio criterio. Es la capa de sanitización
# (capa 2) de la arquitectura por capas que pidió el usuario; el parseo es la capa 1.

def sanitize_items_with_llm(raw_items, objeto: str = "", tool_context=None) -> list:
    """Recibe los items CRUDOS acumulados de TODOS los documentos parseados de un
    contrato, más el objeto del OCDS. Devuelve la LISTA CANÓNICA ÚNICA de productos.

    Diseño: el LLM SOLO DECIDE (no genera). Devuelve los ÍNDICES a fundir/descartar
    (NO reconstruye items). El merge de campos lo hace el código sobre los crudos
    originales. Esto garantiza:
      - Cobertura perfecta: cada item de la salida corresponde a uno (o varios) del input.
      - Sin alucinaciones: el LLM no puede inventar items nuevos (no genera contenido).
      - Campos preservados tal cual: numero, descripcion_corta, cantidad, requerimiento,
        marca, certificaciones, padre_ocds_item — todo del input crudo.

    Acciones del LLM:
      - Normaliza `numero` ('001'→'1', '02'→'2', '1.0'→'1') → campo `num_normalizado`.
      - Grupos de índices a fundir (mismo bien físico descrito distinto).
      - Índices a descartar (cabecera del contrato repetida como ítem).
    Robusto: si el LLM falla, devuelve los items crudos sin cambios (fail-safe)."""
    items = [it for it in (raw_items or []) if isinstance(it, dict)]
    if len(items) <= 1:
        return items
    try:
        from google.genai import types as gtypes
        # Catálogo MINIMAL para no inflar el prompt. El LLM solo decide, no genera.
        catalogo = [{"i": i, "num": str(it.get("numero") or "")[:20],
                     "desc": str(it.get("descripcion_corta") or it.get("descripcion") or "")[:200],
                     "cant": it.get("cantidad"), "und": str(it.get("unidad") or "")[:20]}
                    for i, it in enumerate(items)]
        schema = gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "num_normalizado": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Para cada item de entrada, su `numero` canónico (sin ceros a la izquierda ni sub-decimal .0). Mismo orden que la entrada.",
                    items=gtypes.Schema(type=gtypes.Type.STRING),
                ),
                "grupos_fundir": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Cada sub-lista = índices que son EL MISMO bien físico y deben fundirse en uno solo. Solo grupos de >=2 elementos (los ítems únicos no van).",
                    items=gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.INTEGER)),
                ),
                "indices_descartar": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Índices a descartar (típicamente el TÍTULO/OBJETO del contrato repetido como ítem, sin specs técnicas reales).",
                    items=gtypes.Schema(type=gtypes.Type.INTEGER),
                ),
            },
            required=["num_normalizado", "grupos_fundir", "indices_descartar"],
        )
        prompt = (
            f"OBJETO del contrato (referencia, NO para filtrar): '{(objeto or '')[:300]}'\n\n"
            f"ITEMS CRUDOS extraídos de VARIOS documentos del mismo proceso (Bases, "
            f"Acta, Cuadro, Contrato, etc.). Cada item tiene un índice 0..N-1. Problemas típicos:\n"
            f"  • Mismo bien numerado distinto en dos documentos ('001' y '1', '02' y '2', '1.0' y '1')\n"
            f"  • Descripciones distintas del MISMO bien por OCR ruidoso\n"
            f"  • El TÍTULO/OBJETO del contrato repetido como ítem sin specs técnicas reales\n\n"
            f"Tu tarea: DECIDE (NO generes items, NO modifiques descripciones). Devuelve:\n"
            f"1. `num_normalizado`: array (mismo orden que la entrada) con cada `numero` canónico. "
            f"Ej: '001' → '1', '02' → '2', '1.0' → '1', '01' → '1'. Conserva string vacío si vacío.\n"
            f"2. `grupos_fundir`: array de arrays de índices que son EL MISMO bien físico (descripción "
            f"distinta por OCR pero mismo producto). Solo grupos de >=2. Conserva la cantidad canónica.\n"
            f"3. `indices_descartar`: índices a descartar (típicamente el TÍTULO/OBJETO del contrato "
            f"repetido como ítem, sin specs reales; o un ítem que sea claramente cabecera).\n\n"
            f"REGLAS:\n"
            f"• Items con `requerimiento_tecnico_detallado` largo (>40 chars) NO se descartan (son items reales).\n"
            f"• Items con descripción MUY PARECIDA al objeto del contrato Y sin specs SÍ se descartan (cabecera).\n"
            f"• Items con numero distinto (después de normalizar) son bienes DISTINTOS, NO se funden.\n"
            f"• Items con numero igual pero descripción distinta (por OCR) SÍ se funden (mismo bien).\n"
            f"• Conserva el mayor `requerimiento_tecnico_detallado` entre los del grupo a fundir.\n\n"
            f"INPUT ({len(catalogo)} items):\n{json.dumps(catalogo, ensure_ascii=False)}"
        )
        sys_inst = (
            "Sos un consolidador de ítems de contrataciones públicas peruanas (SEACE/OECE). "
            "Tu única tarea es DECIDIR (no generar items): normalizar numeros, "
            "identificar grupos a fundir (mismo bien físico), e índices a descartar "
            "(típicamente el título del contrato repetido). Devolvé SOLO JSON conforme "
            "al schema, sin markdown, sin fences, sin texto adicional."
        )
        cfg = gtypes.GenerateContentConfig(
            temperature=0.0, top_p=0.1, response_mime_type="application/json",
            response_schema=schema, max_output_tokens=8192,
            http_options=gtypes.HttpOptions(timeout=60000),
            system_instruction=sys_inst,
        )
        client = _gemini_client()
        model = os.getenv("SANITIZE_ITEMS_MODEL", DEFAULT_GEMINI_MODEL)
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(model=model, contents=[gtypes.Part.from_text(text=prompt)], config=cfg))
        data = _safe_parse_json((resp.text or "").strip()) or {}
        if not isinstance(data, dict):
            print(f"[sanitize-items] LLM no devolvió un objeto JSON válido → conservo crudos (fail-safe)", flush=True)
            return items
        # Cobertura / validación: cada índice 0..N-1 debe aparecer EXACTAMENTE una vez
        # entre los grupos de fundir + los índices a descartar + los items individuales
        # (los que no estén en ningún grupo ni descartados quedan como ítems únicos).
        nums = data.get("num_normalizado") or []
        grupos = [g for g in (data.get("grupos_fundir") or []) if isinstance(g, list)]
        descartar = set(i for i in (data.get("indices_descartar") or []) if isinstance(i, int))
        if not isinstance(nums, list) or len(nums) != len(items):
            print(f"[sanitize-items] LLM devolvió num_normalizado con tamaño {len(nums) if isinstance(nums,list) else '?'} != {len(items)} → conservo crudos (fail-safe)", flush=True)
            return items
        # Aplicar normalización del numero a los crudos
        for it, n in zip(items, nums):
            if isinstance(n, str):
                it["numero"] = n.strip()
        # Validar cobertura: cada índice aparece 1 vez entre (grupos × N) + descartar
        coverage_vistos: set = set()
        for g in grupos:
            for i in g:
                if isinstance(i, int) and 0 <= i < len(items): coverage_vistos.add(i)
        coverage_vistos.update(descartar)
        # Los demás índices (los que NO están en grupo ni descartados) son ítems únicos
        # restantes — los representamos como grupos de 1 elemento para unificar el merge
        for i in range(len(items)):
            if i not in coverage_vistos:
                grupos.append([i])
        # Validación final: cada índice exactamente una vez
        flat = [i for g in grupos for i in g if isinstance(i, int)]
        if sorted(flat) != list(range(len(items))) or len(flat) != len(set(flat)):
            print(f"[sanitize-items] LLM cobertura inválida ({len(set(flat))}/{len(items)}) → conservo crudos (fail-safe)", flush=True)
            return items
        # MERGE de los grupos (el código decide, no el LLM). El item con el
        # `requerimiento_tecnico_detallado` más largo es la base; los demás solo
        # COMPLETAN campos vacíos (no sobreescriben lo que ya está).
        out: list[dict] = []
        for g in grupos:
            grp = [items[i] for i in g if 0 <= i < len(items)]
            if not grp: continue
            if any(i in descartar for i in g): continue  # descartar explícito
            grp.sort(key=lambda x: len(str(x.get("requerimiento_tecnico_detallado") or "")), reverse=True)
            base = dict(grp[0])
            for other in grp[1:]:
                for k, v in other.items():
                    if base.get(k) in (None, "", [], {}, 0) and v not in (None, "", [], {}, 0):
                        base[k] = v
            out.append(base)
        descartados_n = len(descartar)
        fundidos_n = len(items) - len(out) - descartados_n
        print(f"[sanitize-items] {len(items)}→{len(out)} items canónicos · {descartados_n} descartados · {fundidos_n} fundidos", flush=True)
        return out
    except Exception as e:
        print(f"[sanitize-items] LLM falló ({type(e).__name__}: {str(e)[:160]}) → conservo crudos (fail-safe)", flush=True)
        return items


# ── FunctionTool wrappers ──
list_documents_tool = FunctionTool(func=list_documents)
parse_document_pdf_tool = FunctionTool(func=parse_document_pdf)
sanitize_items_with_llm_tool = FunctionTool(func=sanitize_items_with_llm)
# parse_documentos_seleccionados_tool se define junto al parser en lote (arriba).
