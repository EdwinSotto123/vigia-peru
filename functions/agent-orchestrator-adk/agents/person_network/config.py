"""Config del agente person_network_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_SMART
OUTPUT_KEY = 'person_network'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('person_network_context', 'CONTEXTO DE RED DE PERSONAS PRE-CARGADO (rnp_proveedor, firmantes, postores, DATOS_PERU por persona)')]

TOOLS = [
    google_search,
]
