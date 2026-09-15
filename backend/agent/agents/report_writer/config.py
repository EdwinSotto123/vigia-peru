"""Config del agente report_writer_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    get_dictamen_context_tool,
)

MODEL = _MODEL_SMART
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Síntesis larga en markdown: SMART;
# validación de citas en código (tools/verify.py). Thinking `medium` (antes `high`): medido
# 2026-09-15 en el mismo contrato (docs/design/PERFILES_AGENTES.md "Latencia") — la síntesis no
# necesita razonamiento largo porque el contexto ya llega verificado (banderas de BD,
# normative_compliance con fundamento). Override: THINKING_REPORT_WRITER=high.
# Overrides por env: THINKING_REPORT_WRITER, TEMPERATURE_REPORT_WRITER, MAX_OUTPUT_TOKENS_REPORT_WRITER.
THINKING = 'medium'          # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
# Tope de salida acorde al dictamen: ~15 k chars ≈ 4-5 k tokens de texto + los tokens de
# thinking (que Vertex cuenta dentro del tope). 16 k corta una degeneración (README/boilerplate
# anexado) sin truncar un dictamen normal; antes era el default del modelo (65 k).
MAX_OUTPUT_TOKENS = 16384
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
