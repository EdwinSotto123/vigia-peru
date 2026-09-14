"""Conexión a Postgres (Cloud SQL o local) — usada por todos los scripts.

Configuración por variables de entorno (mismos nombres que usa `psql`):

  PGHOST      host (default 127.0.0.1 — p. ej. vía Cloud SQL Auth Proxy)
  PGPORT      puerto (default 5432)
  PGUSER      usuario (default postgres)
  PGDATABASE  base de datos (default vigia)
  PGPASSWORD  contraseña. Si no está seteada, se lee de `.cloudsql-password`
              en la raíz del repo (archivo gitignored, formato `password: xxx`).
  PGSSLMODE   `require` para IP pública de Cloud SQL, `disable` para local.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # raíz del repo
PW_FILE = ROOT / ".cloudsql-password"

PG_HOST = os.getenv("PGHOST", "127.0.0.1")
PG_PORT = int(os.getenv("PGPORT", "5432"))
PG_USER = os.getenv("PGUSER", "postgres")
PG_DB = os.getenv("PGDATABASE", "vigia")
PG_SSLMODE = os.getenv("PGSSLMODE", "prefer")


def read_password() -> str:
    """PGPASSWORD del entorno, o el archivo local `.cloudsql-password`."""
    env = os.getenv("PGPASSWORD")
    if env:
        return env
    if not PW_FILE.exists():
        raise SystemExit(
            f"✗ Falta PGPASSWORD y no existe {PW_FILE}. "
            "Seteá la variable o creá el archivo (ver backend/scripts/README.md)."
        )
    text = PW_FILE.read_text(encoding="utf-8").strip()
    m = re.search(r"password:\s*(\S+)", text, flags=re.IGNORECASE)
    if not m:
        raise SystemExit(f"✗ no pude parsear {PW_FILE}")
    return m.group(1)


def connect():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=read_password(),
        dbname=PG_DB, sslmode=PG_SSLMODE,
        connect_timeout=15,
    )
