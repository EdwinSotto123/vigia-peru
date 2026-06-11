"""Config del agente report_writer_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    get_dictamen_context_tool,
    get_alerta_full_context_tool,
    query_legal_rag_tool,
)

MODEL = _MODEL_SMART
OUTPUT_KEY = 'final_dictamen'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    get_dictamen_context_tool,
    get_alerta_full_context_tool,
    query_legal_rag_tool,
]
