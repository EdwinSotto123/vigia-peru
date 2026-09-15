"""Config del agente person_network_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_SMART
# Tier/thinking según docs/design/AUDITORIA_ORQUESTADOR.md §3.3 — Cruces con umbral alto de evidencia: SMART.
# Thinking `medium` (antes `high`): medido 2026-09-15 (docs/design/PERFILES_AGENTES.md "Latencia");
# el contexto (RNP + DATOS_PERU + firmantes) ya viene cruzado en código. Override: THINKING_PERSON_NETWORK=high.
# Overrides por env: THINKING_PERSON_NETWORK, TEMPERATURE_PERSON_NETWORK, MAX_OUTPUT_TOKENS_PERSON_NETWORK.
THINKING = 'medium'          # minimal | low | medium | high | None (Gemini 3: thinking_level)
TEMPERATURE = None           # None = default del modelo (Gemini 3 recomienda no bajarla)
MAX_OUTPUT_TOKENS = None
OUTPUT_SCHEMA = 'PersonNetworkOutput'   # nombre en agents/_shared/schemas.py (WS M); nativo solo con OUTPUT_SCHEMA_NATIVO=1
OUTPUT_KEY = 'person_network'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('person_network_context', 'CONTEXTO DE RED DE PERSONAS PRE-CARGADO (rnp_proveedor, firmantes, postores, DATOS_PERU por persona)')]

TOOLS = [
    google_search,
]
