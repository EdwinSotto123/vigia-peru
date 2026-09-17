"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403


# ════════════════════════════════════════════════════════════════════
# ANÁLISIS DE MERCADO POR ESTRATEGIA (perfil del pipeline)
# ════════════════════════════════════════════════════════════════════
# `analizar_mercado(state, estrategia)` es la única entrada. Cuatro estrategias
# (AUDITORIA_ORQUESTADOR §4.2 / §6.3-3):
#   · goods_retail     — bienes: precios unitarios en marketplaces peruanos vía Gemini +
#                        google_search. Las URLs salen SOLO de `grounding_metadata.
#                        grounding_chunks` (el modelo no escribe URLs); mediana / Δ % /
#                        veredicto se calculan en código.
#   · historico_seace  — servicios / consultoría: comparación contra convocatorias similares
#                        de la BD propia (CUBSO + objeto normalizado con unaccent + pg_trgm,
#                        24 meses) y tarifa mensual / por entregable implícita del bloque
#                        `servicio` del parser.
#   · presupuesto_obra — obras: partidas del expediente técnico (bloque `obra`) vs
#                        presupuesto total, GG/utilidad, adicionales acumulados, y obras
#                        similares en la BD; INFOBRAS queda como validación pendiente.
#   · cotizaciones     — directa / convenio / otros: cotizaciones del expediente (bloque
#                        `sustento_directa`) vs monto adjudicado; cotizante = ganador;
#                        cotizantes vinculados vía person_network.
# Todas escriben `state["market_analysis"]` (formato que consumen
# `persist_market_flags_as_banderas` y el frontend), publican las URLs reales en
# `state["grounding_urls"]`, registran descartes/recortes y devuelven `sin_dato` explícito
# cuando no hay base de comparación. Nunca inventan referencias.

ESTRATEGIAS = ("goods_retail", "historico_seace", "presupuesto_obra", "cotizaciones")

# Modelo de los workers de precio atado al tier por defecto (AUDITORIA §6.4-3).
MARKET_WORKER_MODEL = os.getenv("MARKET_WORKER_MODEL") or DEFAULT_GEMINI_MODEL
# Ítems por worker (chico: cada worker hace las búsquedas de verdad para sus ítems).
MARKET_CHUNK_SIZE = int(os.getenv("MARKET_CHUNK_SIZE", "3"))
MARKET_MAX_WORKERS = int(os.getenv("MARKET_MAX_WORKERS", "8"))
# Segundo pase: re-precia los ítems que quedaron sin precio con grounding en la 1ª ronda.
MARKET_RETRY = os.getenv("MARKET_RETRY", "1") == "1"
# Timeout total del fan-out: lo que no llegó se registra como recorte (no bloquea la corrida).
MARKET_TIMEOUT_S = int(os.getenv("MARKET_TIMEOUT_S", "300"))
# Precios (con URL real) necesarios para emitir un veredicto elevado/muy_elevado/barato.
MARKET_MIN_PRECIOS = int(os.getenv("MARKET_MIN_PRECIOS", "3"))
# Tipo de cambio para precios observados en USD (se declara en cada precio convertido).
MARKET_USD_PEN = float(os.getenv("MARKET_USD_PEN", "3.75"))
# Histórico SEACE: ventana, mínimo de comparables para veredicto y similitud trigram mínima.
MARKET_HIST_MESES = int(os.getenv("MARKET_HIST_MESES", "24"))
MARKET_HIST_MIN_N = int(os.getenv("MARKET_HIST_MIN_N", "5"))
MARKET_HIST_SIM = float(os.getenv("MARKET_HIST_SIM", "0.30"))
MARKET_HIST_LIMIT = int(os.getenv("MARKET_HIST_LIMIT", "60"))
# El histórico compara MONTOS TOTALES de contratos de objeto similar sin normalizar por alcance
# (n° de guardias, meses, m²…): la posición vs p25/p50/p75 es INFORMATIVA. Solo emite veredicto
# (→ bandera sobreprecio_*) si se habilita explícitamente; por defecto `sin_dato` con motivo
# `comparacion_no_normalizada` (verificado 2026-09-15: un servicio de vigilancia hospitalaria de
# S/ 1.3M daba +385 % vs la mediana de 60 "similares" — no es señal, es escala).
MARKET_HIST_VEREDICTO = os.getenv("MARKET_HIST_VEREDICTO", "0") == "1"
# Umbrales de veredicto (Δ % contra la mediana).
MARKET_UMBRAL_ELEVADO = 15.0
MARKET_UMBRAL_MUY_ELEVADO = 50.0
# Demasiados ítems para priciar TODOS con búsqueda real (cada worker = 1 llamada Gemini +
# google_search): por encima de este umbral, los ítems de MENOR valor (fuera del top N por
# `_valor_item`) se ESTIMAN con el conocimiento previo del modelo, sin buscar — más rápido/barato.
# Nunca cuenta como "respaldado": no puede mover sobreprecio_pct/veredicto_global ni cobertura
# (ver `_worker_estimacion_llm`, guarda en campos `*_estimacion_ia` separados de los de grounding).
MARKET_ESTIMACION_DESDE = int(os.getenv("MARKET_ESTIMACION_DESDE", "20"))
MARKET_CHUNK_SIZE_ESTIMACION = int(os.getenv("MARKET_CHUNK_SIZE_ESTIMACION", "10"))

OECE_PROCESO_URL = "https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"


MARKET_ANCLA_MESES = int(os.getenv("MARKET_ANCLA_MESES", "24"))
MARKET_ANCLA_MIN_REGION = int(os.getenv("MARKET_ANCLA_MIN_REGION", "2"))
MARKET_ANCLA_MIN_PAIS = int(os.getenv("MARKET_ANCLA_MIN_PAIS", "3"))
MARKET_ANCLA_MARGEN = float(os.getenv("MARKET_ANCLA_MARGEN", "0.15"))
MARKET_ANCLA_SOLAPE = float(os.getenv("MARKET_ANCLA_SOLAPE", "0.5"))
MARKET_ANCLA_LIMIT = int(os.getenv("MARKET_ANCLA_LIMIT", "80"))
# Guardarraíl: Δ implausible sin base suficiente → no_verificable (1225450: +7 162 %).
MARKET_DELTA_IMPLAUSIBLE = float(os.getenv("MARKET_DELTA_IMPLAUSIBLE", "300"))
MARKET_COBERTURA_LOTE = float(os.getenv("MARKET_COBERTURA_LOTE", "0.7"))
