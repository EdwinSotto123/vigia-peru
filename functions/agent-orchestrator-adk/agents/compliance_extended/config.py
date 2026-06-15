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
    add_contextual_flag_tool,
)

MODEL = _MODEL_FAST
OUTPUT_KEY = 'compliance_extended'
USES_TODAY_HEADER = False
# Inyectamos el contexto investigativo que necesitan las 2 banderas de JUICIO del
# viejo PASO 7.7 (capacidad_operativa_cuestionable, conflicto_interes_funcionario↔empresa).
# Las 12 reglas leen state directamente vía tool_context; estas 2 son juicio del LLM
# sobre datos que debe VER en el prompt.
STATE_INJECTIONS = [
    ('sunat_decolecta', 'PERFIL SUNAT DEL GANADOR (decolecta) — tipo de contribuyente '
     '(persona natural si el RUC empieza en 10, jurídica si empieza en 20), CIIU/actividad, '
     'antigüedad y estado del RUC'),
    ('web_research', 'INVESTIGACIÓN WEB DEL GANADOR — evidencia (o AUSENCIA de evidencia) de '
     'personal, infraestructura, oficina, web y trayectoria operativa de la empresa'),
    ('person_network', 'RED DE PERSONAS — vínculos detectados entre representantes/socios del '
     'ganador o postores y los funcionarios firmantes de la entidad contratante'),
]

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
    add_contextual_flag_tool,
    evaluate_normative_compliance_tool,
    persist_alert_from_flags_tool,
]
