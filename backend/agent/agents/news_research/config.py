"""Config del agente news_research_agent: modelo, tools, output_key."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST
from google.adk.tools import google_search

MODEL = _MODEL_DEFAULT
OUTPUT_KEY = 'news_research'
USES_TODAY_HEADER = False
STATE_INJECTIONS = None

TOOLS = [
    google_search,
]
