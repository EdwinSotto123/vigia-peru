"""Config del agente market_price_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_DEFAULT
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Fallback del fan-out sharded (tools/market.py); antes hardcodeado gemini-2.5-pro.
# Overrides por env: THINKING_MARKET_PRICE, TEMPERATURE_MARKET_PRICE, MAX_OUTPUT_TOKENS_MARKET_PRICE.
THINKING = 'medium'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = 'MarketOutput'   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'market_analysis'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('market_input', 'INPUT_PRE_CARGADO — ITEMS A VALIDAR PRECIOS')]

TOOLS = [
    google_search,
]
