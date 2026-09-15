"""Config del agente compliance_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    check_unique_bidder_rule_tool,
    check_sanctioned_provider_rule_tool,
    check_non_competitive_process_rule_tool,
    detect_estado_real_tool,
    analyze_postores_pattern_tool,
    query_legal_rag_tool,
    persist_alert_from_flags_tool,
)

MODEL = _MODEL_DEFAULT
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Loop de 7 tools sin juicio profundo: DEFAULT con thinking low.
# Overrides por env: THINKING_COMPLIANCE, TEMPERATURE_COMPLIANCE, MAX_OUTPUT_TOKENS_COMPLIANCE.
THINKING = 'low'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = None   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'compliance_result'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    check_unique_bidder_rule_tool,
    check_sanctioned_provider_rule_tool,
    check_non_competitive_process_rule_tool,
    detect_estado_real_tool,
    analyze_postores_pattern_tool,
    query_legal_rag_tool,
    persist_alert_from_flags_tool,
]
