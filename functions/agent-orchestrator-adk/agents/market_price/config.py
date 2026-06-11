"""Config del agente market_price_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = "gemini-2.5-pro"
OUTPUT_KEY = 'market_analysis'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('market_input', 'INPUT_PRE_CARGADO — ITEMS A VALIDAR PRECIOS')]

TOOLS = [
    google_search,
]
