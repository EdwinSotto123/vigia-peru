"""compliance_rules._registry — REGLAS_POR_NOMBRE: catálogo de reglas por slug."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._rules_bidder import check_non_competitive_process_rule, check_postor_unico_mayoritario_rule, check_unique_bidder_rule  # noqa: F401
from tools.compliance_rules._rules_directa import check_directa_fundamento_rule, check_inconsistencia_doc_vs_ocds_rule  # noqa: F401
from tools.compliance_rules._rules_lote1 import REGLAS_LOTE1  # noqa: F401
from tools.compliance_rules._rules_montos import check_adicional_acumulado_rule, check_fraccionamiento_rule, check_plazo_convocatoria_rule, check_tipo_proceso_vs_monto_rule  # noqa: F401
from tools.compliance_rules._rules_network import check_concentracion_entidad_rule, check_directa_recurrente_rule, check_lobby_visits_rule, check_personal_clave_vinculado_rule, check_recurrencia_firmante_rule, check_testaferro_multi_ruc_rule  # noqa: F401
from tools.compliance_rules._rules_provider import check_ciiu_vs_objeto_rule, check_edad_ruc_ganador_rule, check_ruc_ultra_nuevo_rule, check_sanctioned_provider_rule  # noqa: F401


# Reglas disponibles por nombre (para que el driver/perfil las itere sin importar cada una).
REGLAS_POR_NOMBRE = {
    "unico_postor_alto": check_unique_bidder_rule,
    "proveedor_sancionado_osce": check_sanctioned_provider_rule,
    "procedimiento_no_competitivo": check_non_competitive_process_rule,
    "plazo_convocatoria_minimo": check_plazo_convocatoria_rule,
    "tipo_proceso_vs_monto": check_tipo_proceso_vs_monto_rule,
    "directa_sin_fundamento": check_directa_fundamento_rule,
    "ruc_ganador_muy_nuevo": check_edad_ruc_ganador_rule,
    "ciiu_vs_objeto": check_ciiu_vs_objeto_rule,
    "concentracion_entidad": check_concentracion_entidad_rule,
    "firmante_vinculado_ganador": check_recurrencia_firmante_rule,
    "testaferro_multi_ruc": check_testaferro_multi_ruc_rule,
    "ruc_ultra_nuevo": check_ruc_ultra_nuevo_rule,
    "postor_unico_mayoritario": check_postor_unico_mayoritario_rule,
    "inconsistencia_doc_vs_ocds": check_inconsistencia_doc_vs_ocds_rule,
    "lobby_visits_pre_convocatoria": check_lobby_visits_rule,
    "adicional_acumulado": check_adicional_acumulado_rule,
    "personal_clave_vinculado": check_personal_clave_vinculado_rule,
    "fraccionamiento": check_fraccionamiento_rule,
    "directa_recurrente": check_directa_recurrente_rule,
    # Lote 1 (activas por defecto en todos los perfiles; ver run_reglas_lote1).
    **REGLAS_LOTE1,
}
