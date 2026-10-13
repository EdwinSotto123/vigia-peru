"""Aplica la migración 43 (rol vigia_agentes) y fija su contraseña, guardándola en SSM y en Secret Manager.

    PGHOST=<destino> PGPASSWORD=<admin> PGSSLMODE=require python cloud_sql/archivos/crear_rol_agentes.py [--rotar]

Sin --rotar solo genera contraseña si el rol aún no la tiene guardada. La contraseña nunca se imprime.
"""
from __future__ import annotations

import os
import pathlib
import secrets
import subprocess
import sys

import psycopg2
from psycopg2 import sql

RAIZ = pathlib.Path(__file__).resolve().parents[2]
PROYECTO = os.getenv("GCP_PROJECT", "project-a974c6e5-0cdf-4b11-a86")
PERFIL, REGION = os.getenv("AWS_PROFILE", "founder.edwin"), os.getenv("AWS_DEFAULT_REGION", "us-east-2")
PARAM = "/vigia/vigia-db/password-agentes"
SECRETO = "db-password-agentes"


def sh(cmd: list[str], entrada: str | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, "MSYS_NO_PATHCONV": "1"}
    return subprocess.run(cmd, input=entrada, capture_output=True, text=True, shell=os.name == "nt", env=env)


def guardada() -> str | None:
    r = sh(["aws", "ssm", "get-parameter", "--profile", PERFIL, "--region", REGION, "--name", PARAM, "--with-decryption",
            "--query", "Parameter.Value", "--output", "text"])
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def guardar(pw: str) -> None:
    r = sh(["aws", "ssm", "put-parameter", "--profile", PERFIL, "--region", REGION, "--name", PARAM, "--type", "SecureString",
            "--overwrite", "--value", pw])
    if r.returncode:
        raise SystemExit("no pude guardar la contraseña en SSM")
    existe = sh(["gcloud", "secrets", "describe", SECRETO, f"--project={PROYECTO}"]).returncode == 0
    cmd = (["gcloud", "secrets", "versions", "add", SECRETO] if existe else ["gcloud", "secrets", "create", SECRETO])
    r = sh(cmd + [f"--project={PROYECTO}", "--data-file=-"], pw)
    if r.returncode:
        raise SystemExit("no pude guardar la contraseña en Secret Manager")


def main() -> None:
    rotar = "--rotar" in sys.argv
    pw = guardada()
    if pw is None or rotar:
        pw = secrets.token_urlsafe(36)
        guardar(pw)
    c = psycopg2.connect(host=os.environ["PGHOST"], user="postgres", dbname="vigia", password=os.environ["PGPASSWORD"],
                         sslmode=os.getenv("PGSSLMODE", "require"))
    c.autocommit = True
    cu = c.cursor()
    cu.execute((RAIZ / "backend/db/migrations/43_rol_agentes.sql").read_text(encoding="utf-8"))
    cu.execute(sql.SQL("ALTER ROLE vigia_agentes PASSWORD {}").format(sql.Literal(pw)))
    print("rol vigia_agentes listo; contraseña en SSM y Secret Manager (db-password-agentes)")


if __name__ == "__main__":
    main()
