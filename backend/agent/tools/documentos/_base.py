"""Base compartida del paquete `documentos`: constantes de configuración (env vars) y
primitivas usadas por 2+ submódulos (normalización de texto, hash, resolución de perfil).
Nada de acá depende de otro submódulo de `documentos` — es la capa 0."""

from tools._core import *  # noqa: F401,F403
import hashlib as _hashlib
from tools.doc_select import PRIORIDAD_DEFAULT, MAX_DOCS_DEFAULT


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


# Versión del extractor de TEXTO (OCR + layout + marcadores). Cambiarla invalida la caché
# de `documentos_texto` (se vuelve a hacer OCR). La extracción estructurada se cachea
# aparte por (bloque, PARSER_SCHEMA_VERSION, modelo) dentro de `extraccion` JSONB.
VERSION_PARSER = os.getenv("PARSER_TEXT_VERSION", "texto-v1")
# schema-v3 (lote 1 · T7): precio/marca por etapa (referencial vs ofertado/contratado), postores
# con puntaje/estado/orden, invitados, procedimiento_seleccion, ejecucion_contractual, folio.
PARSER_SCHEMA_VERSION = os.getenv("PARSER_SCHEMA_VERSION", "schema-v3")
# Chars de texto OCR por llamada Gemini (≈ 150K tokens). Documentos más largos se parten
# por páginas en varias llamadas y se fusionan — no se omite nada.
PARSE_MAX_CHARS_POR_LLAMADA = int(os.getenv("PARSE_MAX_CHARS_POR_LLAMADA", "600000"))
# Documentos del lote procesados A LA VEZ (descarga → OCR → extracción, cada uno en su hilo):
# PARSE_CONCURRENCY (default 3; alias histórico PARSE_LOTE_WORKERS). El orden de prioridad del
# perfil se conserva en la consolidación (resultados indexados por posición, no por llegada);
# el lock por sha256 (_esperar_sha) evita OCR doble de bytes idénticos dentro del lote.
PARSE_LOTE_WORKERS = int(os.getenv("PARSE_CONCURRENCY") or os.getenv("PARSE_LOTE_WORKERS", "3"))
PARSE_REUSE_EXTRACCION = os.getenv("PARSE_REUSE_EXTRACCION", "1") != "0"
# Solo para MEDIR (benchmark): ignora el texto cacheado en documentos_texto y vuelve a hacer
# OCR (la extracción cacheada también se ignora porque cuelga del texto). Default 0.
PARSE_SKIP_TEXTO_CACHE = os.getenv("PARSE_SKIP_TEXTO_CACHE", "0") == "1"
# Unidades de un contenedor (ZIP con varios PDF) y rangos de páginas de un documento largo
# (> PARSE_MAX_CHARS_POR_LLAMADA) se OCR-ean / extraen a la vez con este pool (orden preservado).
PARSE_UNIT_WORKERS = max(1, int(os.getenv("PARSE_UNIT_WORKERS", "3") or 3))
TEXTO_LITERAL_MAX = 4000
CITA_MAX = 240

_BLOQUES_VALIDOS = ("servicio", "obra", "sustento_directa")
_IMG_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp")


def _norm_txt(s: str) -> str:
    """MAYÚSCULAS sin tildes, espacios colapsados — para comparar descripciones."""
    import unicodedata
    s = " ".join((s or "").strip().upper().split())
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


_LOOKALIKES = str.maketrans({"Μ": "M", "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Ν": "N",
                              "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Ζ": "Z", "І": "I", "О": "O", "А": "A",
                              "Е": "E", "Р": "P", "С": "C", "Т": "T", "Н": "H", "К": "K", "М": "M", "В": "B"})


def _sha256_hex(blob: bytes) -> str:
    return _hashlib.sha256(blob).hexdigest()


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


def _norm_razon(s: str | None) -> str:
    """Razón social comparable: MAYÚSCULAS sin tildes ni puntuación ('S.A.C.' == 'SAC')."""
    return " ".join(re.sub(r"[^A-Z0-9 ]", "", _norm_txt(s or "")).split())
