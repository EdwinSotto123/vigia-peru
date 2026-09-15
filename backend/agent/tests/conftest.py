"""Fixtures compartidas de los tests del orquestador.

· `backend/agent` entra al sys.path para que `import agents` / `import tools` resuelvan
  igual que en Cloud Run (el código no es un paquete instalable).
· Marker `live`: tests que llaman a Gemini/Vertex de verdad. Se saltan salvo `RUN_LIVE=1`;
  con ADC de gcloud y GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_LOCATION=global
  GOOGLE_CLOUD_PROJECT=vivid-spot-480905-a4 (se fijan por defecto si faltan).
"""
from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path

import pytest

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

RUN_LIVE = os.getenv("RUN_LIVE", "0") == "1"


def pytest_configure(config):
    config.addinivalue_line("markers", "live: llama a Gemini en Vertex AI (requiere RUN_LIVE=1 y ADC)")
    if RUN_LIVE:
        os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "vivid-spot-480905-a4")
    # google-genai avisa por valores de enum aún no tipados (p. ej. thinking_level=medium).
    warnings.filterwarnings("ignore", message=".*is not a valid.*")


def pytest_collection_modifyitems(config, items):
    if RUN_LIVE:
        return
    skip = pytest.mark.skip(reason="test live: exportá RUN_LIVE=1 (ADC de gcloud + Vertex AI global)")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def perfil_env(monkeypatch):
    """Devuelve una función que fija PIPELINE_PROFILE y recarga `profiles`."""
    import importlib

    def _set(nombre: str):
        monkeypatch.setenv("PIPELINE_PROFILE", nombre)
        from agents._shared import profiles
        importlib.reload(profiles)
        return profiles
    return _set
