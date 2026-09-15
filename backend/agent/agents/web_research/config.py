"""Config del agente web_research_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_DEFAULT
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Búsqueda con grounding: DEFAULT low (volumen).
# Overrides por env: THINKING_WEB_RESEARCH, TEMPERATURE_WEB_RESEARCH, MAX_OUTPUT_TOKENS_WEB_RESEARCH.
THINKING = 'low'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = 'WebResearchOutput'   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'web_research'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('sunat_decolecta', 'PERFIL SUNAT PRE-CARGADO (decolecta) — incorporalo TAL CUAL en tu salida `empresa`, NO repitas la búsqueda SUNAT')]

TOOLS = [
    google_search,
]
