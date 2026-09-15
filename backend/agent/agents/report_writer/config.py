"""Config del agente report_writer_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    get_dictamen_context_tool,
)

MODEL = _MODEL_SMART
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Síntesis larga en markdown: SMART high; validación de citas en código (tools/verify.py).
# Overrides por env: THINKING_REPORT_WRITER, TEMPERATURE_REPORT_WRITER, MAX_OUTPUT_TOKENS_REPORT_WRITER.
THINKING = 'high'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = None   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'final_dictamen'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

# UNA sola tool: get_dictamen_context. Su trabajo es SINTETIZAR, no investigar: el fundamento
# legal por bandera ya viene en `normative_compliance.evaluaciones` del contexto. Por eso
# se quitaron get_alerta_full_context y query_legal_rag (research adicional innecesario).
# Nota: la restricción histórica "una sola tool por el 400 de thought_signature" ya no aplica:
# verificado 2026-09-15 (tests/test_live_gemini36.py) que ADK 1.19 + gemini-3.6-flash con
# thinking encadena 2 tools sin error (las Part con thought_signature viajan completas).
TOOLS = [
    get_dictamen_context_tool,
]
