"""Config del agente report_writer_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    get_dictamen_context_tool,
)

MODEL = _MODEL_SMART
OUTPUT_KEY = 'final_dictamen'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

# UNA sola tool: get_dictamen_context. El report_writer es un modelo CON thinking;
# encadenar varias llamadas a tools rompe el round-trip del thought_signature de
# Gemini (400 INVALID_ARGUMENT). Su trabajo es SINTETIZAR, no investigar: el fundamento
# legal por bandera ya viene en `normative_compliance.evaluaciones` del contexto. Por eso
# se quitaron get_alerta_full_context y query_legal_rag (research adicional innecesario).
TOOLS = [
    get_dictamen_context_tool,
]
