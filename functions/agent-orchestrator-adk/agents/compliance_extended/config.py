"""Config del agente compliance_extended_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from tools import (
    check_plazo_convocatoria_rule_tool,
    check_tipo_proceso_vs_monto_rule_tool,
    check_directa_fundamento_rule_tool,
    check_edad_ruc_ganador_rule_tool,
    check_ciiu_vs_objeto_rule_tool,
    check_concentracion_entidad_rule_tool,
    check_recurrencia_firmante_rule_tool,
    check_testaferro_multi_ruc_rule_tool,
    check_ruc_ultra_nuevo_rule_tool,
    check_postor_unico_mayoritario_rule_tool,
    check_inconsistencia_doc_vs_ocds_rule_tool,
    check_lobby_visits_rule_tool,
    evaluate_normative_compliance_tool,
    persist_alert_from_flags_tool,
)

MODEL = _MODEL_FAST
OUTPUT_KEY = 'compliance_extended'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    check_plazo_convocatoria_rule_tool,
    check_tipo_proceso_vs_monto_rule_tool,
    check_directa_fundamento_rule_tool,
    check_edad_ruc_ganador_rule_tool,
    check_ciiu_vs_objeto_rule_tool,
    check_concentracion_entidad_rule_tool,
    check_recurrencia_firmante_rule_tool,
    check_testaferro_multi_ruc_rule_tool,
    check_ruc_ultra_nuevo_rule_tool,
    check_postor_unico_mayoritario_rule_tool,
    check_inconsistencia_doc_vs_ocds_rule_tool,
    check_lobby_visits_rule_tool,
    evaluate_normative_compliance_tool,
    persist_alert_from_flags_tool,
]
