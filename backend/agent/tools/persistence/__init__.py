"""Tools del dominio: persistence.

Reglas de persistencia (WS V · auditoría #1, #2, §6.1-1, §6.2-5, §6.2-9):
  · Cada agente borra SOLO sus propias banderas (`agente_origen`) — nunca las de otros.
  · El `score` de la alerta se recalcula SIEMPRE con TODAS las banderas persistidas.
  · Toda bandera pasa por `verify.verificar_bandera` antes del INSERT; las que no
    superan la verificación (RUC/DNI/monto no respaldado) van a state['descartes'] y
    NO se persisten. El resultado queda en `banderas.verificacion` (JSONB).
  · `pending_doc_flags` y `pending_market_flags` (diferidas porque la alerta aún no
    existía) se consumen en `persist_analysis_outputs` y se limpian del state.
  · Un output de agente que no parsea como JSON se persiste como
    `{"estado": "sin_dato", "_parse_failed": true}` (no texto crudo) y se registra warn.

Paquete dividido por QUÉ se persiste (ver cada submódulo para el detalle):
  · shared            — helpers compartidos por 2+ de los siguientes (score, verificación,
                         insert/lectura de banderas, montos, limpieza idempotente).
  · alert_flags        — banderas contextuales del orquestador + alerta de compliance.
  · doc_flags          — banderas documentales (document_legal_analyst_agent).
  · market_flags       — banderas de sobreprecio (market_price_agent).
  · analysis_outputs   — análisis completo (`alertas.analisis_full` + dictamen).

Este __init__ re-exporta TODO (funciones públicas + helpers _privados + constantes +
los 5 _tool) para mantener equivalencia total con el monolito previo: cualquier
`from tools.persistence import X` o `tools.persistence.X` que funcionaba antes sigue
funcionando (ej. `from tools import persistence; persistence._recalcular_score(...)`,
usado por `tools/self_eval.py` y por los tests de regresión de banderas).
"""

from tools._core import *  # noqa: F401,F403

from tools.persistence.shared import (
    _PESOS, _PESOS_DEFAULT, _peso, _norma, _norma_slug, _insert_bandera,
    _leer_banderas, _recalcular_score, _verificar_o_descartar, _normalizar_red_flag,
    _advisory_lock, _montos_alerta, _limpiar_banderas_agente,
)
from tools.persistence.alert_flags import (
    add_contextual_flag, add_contextual_flag_tool,
    persist_alert_from_flags, persist_alert_from_flags_tool,
)
from tools.persistence.doc_flags import (
    persist_doc_flags_as_banderas, persist_doc_flags_as_banderas_tool,
)
from tools.persistence.market_flags import (
    _cobertura_por_valor, persist_market_flags_as_banderas,
    persist_market_flags_as_banderas_tool,
)
from tools.persistence.analysis_outputs import (
    _AGENTES_INVESTIGACION, _url_respaldada, _banderas_investigacion,
    persist_analysis_outputs, persist_analysis_outputs_tool,
)
