"""Config del agente document_legal_analyst_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    query_legal_rag_tool,
    lookup_opinion_oece_tool,
    read_document_analysis_tool,
)

MODEL = _MODEL_SMART
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Razonamiento normativo: SMART con thinking high; salida con evidencia[] obligatoria.
# Overrides por env: THINKING_DOCUMENT_LEGAL_ANALYST, TEMPERATURE_DOCUMENT_LEGAL_ANALYST, MAX_OUTPUT_TOKENS_DOCUMENT_LEGAL_ANALYST.
THINKING = 'high'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = 'LegalOutput'   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'legal_analysis'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    query_legal_rag_tool,
    lookup_opinion_oece_tool,
    read_document_analysis_tool,
]
