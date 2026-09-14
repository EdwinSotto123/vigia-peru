"""Config del agente web_research_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_DEFAULT
OUTPUT_KEY = 'web_research'
USES_TODAY_HEADER = False
STATE_INJECTIONS = [('sunat_decolecta', 'PERFIL SUNAT PRE-CARGADO (decolecta) — incorporalo TAL CUAL en tu salida `empresa`, NO repitas la búsqueda SUNAT')]

TOOLS = [
    google_search,
]
