"""Tools del dominio: compliance_rules.

Reglas deterministas de cumplimiento. Desde el WS V (plan 2026-09-15) TODAS las
reglas `check_*_rule` aceptan dos kwargs opcionales que el driver pasa desde el
perfil (`agents/_shared/profiles.py`):

    reglas_activas: frozenset[str] | None   # nombres de reglas habilitadas; None = todas
    topes_uit:      dict | None             # topes por tipo de proceso; None = defaults

Como los FunctionTool de ADK no pueden declarar `frozenset`, los wrappers `*_tool`
exponen solo `(ocid, tool_context)` y leen el perfil de `state['reglas_activas']` /
`state['topes_uit']` si el driver los dejó ahí (ver `_as_tool`).
"""

from tools._core import *  # noqa: F401,F403
from tools.legal import query_legal_rag  # noqa: F401
from tools import verify as _verify  # noqa: F401

# Re-exporta el contenido de cada submódulo para preservar `tools.compliance_rules` como
# superficie de import unica (equivalente al modulo monolitico previo a la reorganizacion).
from tools.compliance_rules._base import (  # noqa: F401
    _perfil_reglas,
    _perfil_topes,
    _regla_omitida,
    _INICIO_LEY_32069,
    _NORMAS,
    _to_date,
    norma_aplicable,
    _fecha_convocatoria_state,
    _norma_state,
    _procurement_method,
    _es_subasta,
    _es_comparacion_precios,
    _montos_ocds,
    _monto_adjudicado_ocds,
    _ganador_ocds,
    _f,
    _norm_razon_cr,
    _postores_parser,
    _sin_tildes,
    _as_tool,
    _ganador_ruc,)
from tools.compliance_rules._object_matching import (  # noqa: F401
    _STOP_OBJETO,
    _COMODIN_OBJETO,
    _SUFIJOS,
    _HIPERONIMOS,
    _raiz,
    _tokens_raiz,
    _misma_raiz,
    _rubro_compatible,
    _es_comodin,
    _textos_items,
    coincide_objeto_detalle,
    coincide_objeto,)
from tools.compliance_rules._rules_bidder import (  # noqa: F401
    _n_postores_ocds,
    check_unique_bidder_rule,
    check_non_competitive_process_rule,
    check_postor_unico_mayoritario_rule,
    check_unique_bidder_rule_tool,
    check_non_competitive_process_rule_tool,
    check_postor_unico_mayoritario_rule_tool,)
from tools.compliance_rules._rules_provider import (  # noqa: F401
    check_sanctioned_provider_rule,
    check_edad_ruc_ganador_rule,
    check_ciiu_vs_objeto_rule,
    _CATEGORIAS_OBJETO,
    _CATEGORIAS_CIIU,
    _CATEGORIAS_COMPATIBLES,
    _categoria_objeto,
    _categoria_ciiu,
    _categorias_compatibles,
    check_ruc_ultra_nuevo_rule,
    check_sanctioned_provider_rule_tool,
    check_edad_ruc_ganador_rule_tool,
    check_ciiu_vs_objeto_rule_tool,
    check_ruc_ultra_nuevo_rule_tool,)
from tools.compliance_rules._rules_montos import (  # noqa: F401
    _TOPES_DEFAULT,
    _TOPES_LEY_32069,
    _tope,
    check_plazo_convocatoria_rule,
    check_tipo_proceso_vs_monto_rule,
    _tokens_objeto,
    check_adicional_acumulado_rule,
    check_fraccionamiento_rule,
    check_plazo_convocatoria_rule_tool,
    check_tipo_proceso_vs_monto_rule_tool,
    check_adicional_acumulado_rule_tool,
    check_fraccionamiento_rule_tool,)
from tools.compliance_rules._rules_directa import (  # noqa: F401
    _juez_coherencia_dice_coherente,
    _identificar_causal_directa,
    _ACTO_PATTERNS,
    _FECHA_CERCANA_RE,
    _buscar_acto_resolutivo,
    check_directa_fundamento_rule,
    check_inconsistencia_doc_vs_ocds_rule,
    check_directa_fundamento_rule_tool,
    check_inconsistencia_doc_vs_ocds_rule_tool,)
from tools.compliance_rules._rules_network import (  # noqa: F401
    check_concentracion_entidad_rule,
    check_recurrencia_firmante_rule,
    check_testaferro_multi_ruc_rule,
    check_personal_clave_vinculado_rule,
    check_directa_recurrente_rule,
    check_lobby_visits_rule,
    check_concentracion_entidad_rule_tool,
    check_recurrencia_firmante_rule_tool,
    check_testaferro_multi_ruc_rule_tool,
    check_lobby_visits_rule_tool,
    check_personal_clave_vinculado_rule_tool,
    check_directa_recurrente_rule_tool,)
from tools.compliance_rules._rules_lote1 import (  # noqa: F401
    _ESTADOS_INVALIDOS,
    _oferta_invalida,
    _RE_CUANTIA_RESERVADA,
    _cuantia_reservada,
    _vr_state,
    _nombre_postor,
    _flag,
    check_oferta_igual_valor_referencial_rule,
    check_ofertas_agrupadas_rule,
    check_unica_oferta_valida_rule,
    check_ganador_no_invitado_rule,
    _CARGOS_PUBLICOS,
    _firmantes_entidad,
    check_firmante_con_empresa_rnp_rule,
    _RE_AMPL_IMPROC,
    _RE_AMPL,
    _RE_PENAL,
    check_ampliacion_denegada_penalidad_rule,
    _apellidos,
    _socios_por_postor,
    check_postores_vinculados_rnp_rule,
    check_oferta_mas_barata_no_gana_rule,
    _digits,
    check_fecha_buena_pro_incoherente_rule,
    REGLAS_LOTE1,
    run_reglas_lote1,
    check_oferta_igual_valor_referencial_rule_tool,
    check_ofertas_agrupadas_rule_tool,
    check_unica_oferta_valida_rule_tool,
    check_ganador_no_invitado_rule_tool,
    check_firmante_con_empresa_rnp_rule_tool,
    check_ampliacion_denegada_penalidad_rule_tool,
    check_postores_vinculados_rnp_rule_tool,
    check_oferta_mas_barata_no_gana_rule_tool,
    check_fecha_buena_pro_incoherente_rule_tool,
    run_reglas_lote1_tool,)
from tools.compliance_rules._analysis import (  # noqa: F401
    evaluate_normative_compliance,
    _RAG_STOP_TEMA,
    _TERMINOS_OBRA,
    _elegir_opinion_pertinente,
    detect_estado_real,
    analyze_postores_pattern,
    _detect_estado_real_persist,
    evaluate_normative_compliance_tool,
    detect_estado_real_tool,
    analyze_postores_pattern_tool,)
from tools.compliance_rules._registry import REGLAS_POR_NOMBRE  # noqa: F401
