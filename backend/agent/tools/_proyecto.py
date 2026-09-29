"""Proyecto de GCP y conexión de Cloud SQL, sin ningún proyecto fijo en el código.

Mudarse a otro proyecto es cambiar variables, no código (infrastructure/deploy/migracion/README.md):
  · VERTEX_PROJECT o GOOGLE_CLOUD_PROJECT: los despliegues (agentes.sh, servicio.yaml.tmpl) las fijan.
  · Sin ellas (p. ej. corriendo local), el proyecto de las credenciales por defecto (ADC).
  · CLOUD_SQL_CONNECTION (<proyecto>:<región>:<instancia>) o, sin ella, <proyecto>:us-central1:vigia-db.
"""
from __future__ import annotations

import functools
import os


@functools.lru_cache(maxsize=1)
def _proyecto_adc() -> str:
    try:
        import google.auth
        return google.auth.default()[1] or ""
    except Exception:
        return ""


def proyecto_gcp() -> str:
    return os.getenv("VERTEX_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or _proyecto_adc()


def conexion_cloud_sql() -> str:
    return os.getenv("CLOUD_SQL_CONNECTION") or f"{proyecto_gcp()}:us-central1:vigia-db"
