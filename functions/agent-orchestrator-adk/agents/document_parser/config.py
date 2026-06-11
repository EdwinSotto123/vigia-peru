"""Config del agente document_parser_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    list_documents_tool,
    parse_document_pdf_tool,
)

MODEL = _MODEL_DEFAULT
OUTPUT_KEY = 'document_analysis'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    list_documents_tool,
    parse_document_pdf_tool,
]
