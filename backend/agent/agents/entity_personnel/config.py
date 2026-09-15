"""Config del agente entity_personnel_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_DEFAULT
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Directorio de funcionarios con grounding: DEFAULT low.
# Overrides por env: THINKING_ENTITY_PERSONNEL, TEMPERATURE_ENTITY_PERSONNEL, MAX_OUTPUT_TOKENS_ENTITY_PERSONNEL.
THINKING = 'low'            # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = 'EntityPersonnelOutput'   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'entity_personnel'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    google_search,
]
