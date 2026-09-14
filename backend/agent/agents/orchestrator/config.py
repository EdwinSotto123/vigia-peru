"""Config del vigia_orchestrator: modelo + flags."""

from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST

# OPTIMIZACIÓN: orchestrator usa Flash (no Pro). Decide qué tool llamar, no
# necesita razonamiento profundo; Pro saturaba con 503. El razonamiento crítico
# (legal, dictamen, mercado) vive en los sub-agentes Pro.
MODEL = _MODEL_DEFAULT
USES_TODAY_HEADER = True
OUTPUT_KEY = None
