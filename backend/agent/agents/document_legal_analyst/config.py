"""Config del agente document_legal_analyst_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    query_legal_rag_tool,
    lookup_opinion_oece_tool,
    read_document_analysis_tool,
)

MODEL = _MODEL_SMART
OUTPUT_KEY = 'legal_analysis'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    query_legal_rag_tool,
    lookup_opinion_oece_tool,
    read_document_analysis_tool,
]
