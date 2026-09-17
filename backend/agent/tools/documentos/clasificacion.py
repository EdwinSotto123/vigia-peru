"""Clasificación de un documento por tipo/etapa (REQUERIMIENTO vs CONTRATACIÓN,
ADJUDICACIÓN) usada tanto por el parser en lote como por el legacy."""

from tools._core import *  # noqa: F401,F403
from ._base import _norm_txt


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


# ── Etapa del documento (lote 1 · T7) ─────────────────────────────────────────────────
# Un documento es de REQUERIMIENTO (bases, integradas, TDR, EETT, expediente, resumen
# ejecutivo, informe de sustento, absolución) o de CONTRATACIÓN (propuesta, acta, cuadro,
# contrato, orden de compra/servicio, adenda, garantía, resolución de ejecución). Solo los
# primeros alimentan `items_consolidados` (precio REFERENCIAL, marca EXIGIDA); los ítems de
# los segundos van a `items_contratados` (precio CONTRATADO/OFERTADO, marca OFERTADA) y se
# cruzan por clave normalizada. Antes la OC con `contiene_requerimiento=true` entraba como
# fuente de requerimiento y su marca se fundía en el ítem de las bases ("las bases exigen la
# marca SOMOS DEL NORTE": inventado).
_TIPOS_REQUERIMIENTO_KW = ("bases", "termino", "referencia", "especificacion", "eett", "tdr", "expediente",
                           "resumen", "sustento", "ficha", "requerimiento", "absolucion", "consulta", "pliego",
                           "estudio_mercado", "estudio de mercado", "informe_tecnico", "informe tecnico")
_TIPOS_CONTRATACION_KW = ("contrato", "orden_de_compra", "orden_de_servicio", "orden de compra", "orden de servicio",
                          "acta", "buena_pro", "buena pro", "cuadro", "evaluac", "calificac", "propuesta", "oferta",
                          "adenda", "garantia", "fianza", "conformidad", "resolucion", "adjudic", "otorgamiento",
                          "ampliacion", "penalidad", "valorizacion", "presentacion")
_CATS_REQUERIMIENTO = ("bases_integradas", "bases", "tdr", "eett", "expediente_tecnico", "presupuesto",
                       "resumen_ejecutivo", "informe", "absolucion", "cotizaciones")
_CATS_CONTRATACION = ("acta", "cuadro_comparativo", "propuesta", "contrato", "orden", "adenda", "valorizaciones",
                      "resolucion")


def _es_doc_contratacion(tipo_detectado: str | None, doc: dict | None = None) -> bool:
    """True si el documento pertenece a la etapa de contratación/adjudicación (sus ítems
    NO son requerimiento). Decide por `tipo_documento_detectado`; si el LLM no lo detectó
    ('otro'/None), por título + documentType del DocRef (tools/doc_select)."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    if t and t not in ("otro", "null", "none", "desconocido"):
        if any(k.replace("_", " ") in t for k in _TIPOS_REQUERIMIENTO_KW):
            return False
        if any(k.replace("_", " ") in t for k in _TIPOS_CONTRATACION_KW):
            return True
    if doc:
        try:
            from tools.doc_select import categorias_de
            cats = categorias_de(doc.get("titulo"), doc.get("tipo"))
        except Exception:
            cats = []
        if any(c in cats for c in _CATS_REQUERIMIENTO):
            return False
        if any(c in cats for c in _CATS_CONTRATACION):
            return True
    return False


def _es_doc_resultado(tipo_detectado: str | None, doc: dict | None = None) -> bool:
    """Documento que FIJA el resultado de la selección (acta de buena pro, cuadro de evaluación,
    contrato, orden): sus montos/ganador/puntajes mandan al fusionar postores. El reporte de
    presentación de propuestas (solo quién ofertó) NO lo es."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    if "propuesta" in t or "presentacion" in t:
        return False
    if t and _es_doc_de_adjudicacion(t):
        return True
    if doc and not t:
        titulo = _norm_txt(doc.get("titulo") or "").lower()
        if "propuesta" in titulo or "presentacion" in titulo:
            return False
        return any(k in titulo for k in ("acta", "buena pro", "otorgamiento", "cuadro", "evaluac", "contrato", "orden de"))
    return False


def _origen_precio(tipo_detectado: str | None, doc: dict | None = None) -> str:
    """Etiqueta del origen de un precio contratado/ofertado: contrato > orden_de_compra >
    oferta_ganadora (acta/cuadro/propuesta) > adenda > otro."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    titulo = _norm_txt((doc or {}).get("titulo") or "").lower()
    for src in (t, titulo):
        if "orden" in src:
            return "orden_de_compra"
        if "contrato" in src or "contract" in src:
            return "contrato"
        if any(k in src for k in ("acta", "cuadro", "propuesta", "oferta", "buena pro", "otorgamiento", "evaluac")):
            return "oferta_ganadora"
        if any(k in src for k in ("adenda", "ampliacion", "adicional")):
            return "adenda"
    return "documento_contratacion"
