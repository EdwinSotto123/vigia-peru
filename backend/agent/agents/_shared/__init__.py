"""Componentes compartidos por todos los agentes de Vigía Perú.

Importar este paquete aplica el monkey-patch de fallback de Gemini (503/429)
de forma idempotente, ANTES de que se instancie cualquier Agent.
"""
# El import dispara _apply_gemini_fallback_patch() (idempotente).
from agents._shared import model_fallback  # noqa: F401
from agents._shared.models import _MODEL_SMART, _MODEL_DEFAULT, _MODEL_FAST  # noqa: F401
from agents._shared.callbacks import CALLBACKS  # noqa: F401
from agents._shared.instructions import with_today_header, make_state_aware_instruction  # noqa: F401
