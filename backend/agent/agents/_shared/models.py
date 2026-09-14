"""
Modelos Gemini por TIER. Especialización por rol del agente:
  · SMART   → razonamiento crítico (Pro). Baja frecuencia, alta calidad.
  · DEFAULT → tareas balanceadas con multimodal/búsqueda (Flash). 1K RPM.
  · FAST    → tareas mecánicas / decisor de tools (Flash-Lite). 4K RPM.

Configurables vía env vars. Si Google satura un modelo, se cambia el tier
afectado con `gcloud run services update --update-env-vars`.
"""
import os

_MODEL_SMART = os.getenv("GEMINI_MODEL_SMART", "gemini-2.5-pro")
_MODEL_DEFAULT = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
_MODEL_FAST = os.getenv("GEMINI_MODEL_FAST", "gemini-2.5-flash-lite")
