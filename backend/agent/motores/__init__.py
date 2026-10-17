"""Motor de agentes: qué ejecuta cada sub-agente del pipeline determinista.

El pipeline (deterministic.py → pipeline_phases.py) nunca llama a un framework directamente: corre cada
sub-agente con tres funciones de la misma firma (`run_agent`, `run_agent_isolated`, `run_agent_delta`,
ver pipeline_runtime.py). Este paquete elige quién las implementa:

  MOTOR_AGENTES=adk   (por defecto) motor_adk: el de siempre, ADK + el modelo de agents/_shared/models.py.
                      Es la versión estable: no cambia nada respecto de antes de este paquete.
  MOTOR_AGENTES=sdk   motor_sdk: el SDK de agentes del proveedor de respaldo. Usa los MISMOS agentes (prompt,
                      herramientas, output_key, esquema de salida): solo cambia quién conversa con el modelo.

Volver al estable es quitar la variable (o ponerla en `adk`): el código de ADK no se tocó.
"""
from __future__ import annotations

import os

MOTORES = ("adk", "sdk")


def nombre() -> str:
    m = (os.getenv("MOTOR_AGENTES") or "adk").strip().lower()
    if m not in MOTORES:
        raise ValueError(f"MOTOR_AGENTES={m!r}: debe ser uno de {MOTORES}")
    return m


def funciones():
    """(run_agent, run_agent_isolated, run_agent_delta) del motor elegido."""
    if nombre() == "sdk":
        from motores import motor_sdk as m
    else:
        from motores import motor_adk as m
    return m.run_agent, m.run_agent_isolated, m.run_agent_delta
