"""Túnel a RDS por Session Manager, a través del proxy `vigia-db-proxy`.

Desde el 2026-10-21 las bases (`vigia-db`, `vigia-db-dev`) no son públicas: no aceptan conexiones de internet. Para
administrarlas desde una PC se abre un puerto local que llega a RDS por el proxy (SSM, sin puertos abiertos ni llaves
SSH). Los Workers no cambian: siguen por Hyperdrive → túnel de Cloudflare → PgBouncer.

Requiere el plugin de Session Manager (`session-manager-plugin` en el PATH; en Windows basta copiar el .exe del zip
oficial a una carpeta del PATH) y el perfil de AWS (`founder.edwin`, o AWS_PROFILE).

  python infrastructure/aws/tunel_rds.py prod                # 127.0.0.1:15432 → vigia-db, hasta Ctrl+C
  python infrastructure/aws/tunel_rds.py dev --puerto 15433  # → vigia-db-dev

Desde Python:

  from tunel_rds import tunel
  with tunel("vigia-db") as (host, puerto):
      psycopg2.connect(host=host, port=puerto, sslmode="require", ...)

Con sslmode=verify-full el nombre del certificado no coincide con 127.0.0.1: usar `require` (el tráfico ya va cifrado
dentro de la sesión de SSM y además por TLS hasta RDS).

Los scripts de carga del operador (backend/scripts/cargar_*.py) entran como `postgres` con la clave maestra de SSM:

  with conexion("dev") as c:     # o "prod"
      ...
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import socket
import subprocess
import sys
import time

REGION = "us-east-2"
PERFIL = os.environ.get("AWS_PROFILE", "founder.edwin")
PROXY = "vigia-db-proxy"
BASES = {"prod": "vigia-db", "dev": "vigia-db-dev"}
# Clave maestra (usuario postgres) de cada base en SSM Parameter Store.
CLAVES = {"vigia-db": "/vigia/vigia-db/password", "vigia-db-dev": "/vigia/dev/db-admin"}
ENTORNO = {**os.environ, "MSYS_NO_PATHCONV": "1"}


def _aws(*args: str) -> dict:
    r = subprocess.run(["aws", *args, "--profile", PERFIL, "--region", REGION, "--output", "json"],
                       capture_output=True, text=True, env=ENTORNO)
    if r.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:2])}: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout or "{}")


def proxy_id() -> str:
    r = _aws("ec2", "describe-instances", "--filters", f"Name=tag:Name,Values={PROXY}",
             "Name=instance-state-name,Values=running", "--query", "Reservations[].Instances[].InstanceId")
    if not r:
        raise RuntimeError(f"no hay una instancia {PROXY} encendida")
    return r[0]


def endpoint(base: str) -> str:
    r = _aws("rds", "describe-db-instances", "--db-instance-identifier", base, "--query", "DBInstances[0].Endpoint.Address")
    if not r:
        raise RuntimeError(f"{base} no existe o no tiene endpoint")
    return r


def _puerto_libre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _escucha(puerto: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", puerto), timeout=1):
            return True
    except OSError:
        return False


def _cerrar(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":   # el plugin es un proceso hijo de aws: se cierra el árbol entero
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()
    with contextlib.suppress(subprocess.TimeoutExpired):
        proc.wait(timeout=10)


@contextlib.contextmanager
def tunel(base: str = "vigia-db", puerto: int | None = None, espera_s: int = 40):
    """Abre 127.0.0.1:<puerto> → <base>:5432 mientras dura el `with`. Devuelve (host, puerto)."""
    puerto = puerto or _puerto_libre()
    parametros = json.dumps({"host": [endpoint(base)], "portNumber": ["5432"], "localPortNumber": [str(puerto)]})
    proc = subprocess.Popen(
        ["aws", "ssm", "start-session", "--target", proxy_id(), "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
         "--parameters", parametros, "--profile", PERFIL, "--region", REGION],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=ENTORNO)
    try:
        limite = time.time() + espera_s
        while not _escucha(puerto):
            if proc.poll() is not None:
                raise RuntimeError(f"no se pudo abrir el túnel: {(proc.stderr.read() or b'').decode(errors='replace')[-300:]}")
            if time.time() > limite:
                raise RuntimeError(f"el túnel no abrió en {espera_s} s (¿está session-manager-plugin en el PATH?)")
            time.sleep(0.5)
        yield "127.0.0.1", puerto
    finally:
        _cerrar(proc)


@contextlib.contextmanager
def conexion(entorno: str):
    """psycopg2 como `postgres` a la base del entorno ('prod' o 'dev') por el túnel, con la clave maestra de SSM."""
    import psycopg2
    base = BASES[entorno]
    clave = _aws("ssm", "get-parameter", "--name", CLAVES[base], "--with-decryption", "--query", "Parameter.Value")
    with tunel(base) as (host, puerto):
        c = psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave, sslmode="require",
                             connect_timeout=15, keepalives=1, keepalives_idle=30)
        try:
            yield c
        finally:
            c.close()


def main() -> None:
    p = argparse.ArgumentParser(description="Túnel local a RDS por Session Manager.")
    p.add_argument("entorno", choices=sorted(BASES), help="prod = vigia-db, dev = vigia-db-dev")
    p.add_argument("--puerto", type=int, default=None, help="puerto local (por defecto 15432 prod, 15433 dev)")
    a = p.parse_args()
    puerto = a.puerto or (15432 if a.entorno == "prod" else 15433)
    with tunel(BASES[a.entorno], puerto) as (host, puerto):
        print(f"{BASES[a.entorno]} en {host}:{puerto} (PGHOST={host} PGPORT={puerto} PGSSLMODE=require). Ctrl+C para cerrar.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    sys.exit(main())
