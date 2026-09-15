"""Config del agente document_parser_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    list_documents_tool,
    parse_document_pdf_tool,
)
try:  # WS D · selección + parseo en lote en UNA llamada (el prompt la exige exactamente 1 vez)
    from tools import parse_documentos_seleccionados_tool
except ImportError:
    parse_documentos_seleccionados_tool = None

MODEL = _MODEL_DEFAULT
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Elige/consolida documentos; la extracción pesada la hace la tool (schema + página).
# Overrides por env: THINKING_DOCUMENT_PARSER, TEMPERATURE_DOCUMENT_PARSER, MAX_OUTPUT_TOKENS_DOCUMENT_PARSER.
THINKING = 'low'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = None   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'document_analysis'
USES_TODAY_HEADER = False
# Cuando el driver ya corrió el lote determinista (WS D: parse_documentos_lote), la extracción
# estructurada vive en state y se inyecta para que el agente CONSOLIDE (no vuelva a parsear).
# Si la key está vacía (flujo del agente eligiendo documentos), la inyección se omite sola.
STATE_INJECTIONS = None  # el driver corre parse_documentos_lote sin LLM; el agente es solo fallback

TOOLS = [t for t in (parse_documentos_seleccionados_tool, list_documents_tool, parse_document_pdf_tool) if t is not None]
