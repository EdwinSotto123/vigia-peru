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
