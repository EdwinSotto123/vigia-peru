"""Crea en la base DESTINO los roles de la migración 37 con las mismas contraseñas y ajustes que el origen.

Las contraseñas se leen de Secret Manager de GCP (cloudsql-password-<rol>) y nunca se imprimen. Los
ajustes (conexiones, timeouts) y la pertenencia vigia_api_admin ∈ vigia_api se copian del origen.

    PGHOST=<destino> PGPASSWORD=<admin destino> PGSSLMODE=require \
      ORIGEN_HOST=<origen> ORIGEN_PASSWORD=<admin origen> python cloud_sql/archivos/crear_roles.py
"""
from __future__ import annotations

import os
import subprocess

import psycopg2
from psycopg2 import sql

PROYECTO = os.getenv("GCP_PROJECT", "project-a974c6e5-0cdf-4b11-a86")
ROLES = {  # rol → secreto con su contraseña
    "vigia_api": "cloudsql-password-api",
    "vigia_api_admin": "cloudsql-password-api-admin",
    "vigia_dispatcher": "cloudsql-password-dispatcher",
    "vigia_jobs": "cloudsql-password-jobs",
    "vigia_mcp": "cloudsql-password-mcp",
}


def secreto(nombre: str) -> str:
    """La contraseña llega por la variable PW_<secreto> (la exporta migrar.sh); si no, se pide a gcloud."""
    v = os.getenv("PW_" + nombre.replace("-", "_"))
    if v:
        return v
    r = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={nombre}", f"--project={PROYECTO}"],
                       capture_output=True, text=True, shell=os.name == "nt")
    if r.returncode:
        raise SystemExit(f"no pude leer el secreto {nombre}")
    return r.stdout.strip()


def conectar(host: str, password: str, db: str = "vigia"):
    return psycopg2.connect(host=host, user="postgres", dbname=db, password=password, sslmode="require")


def main() -> None:
    origen = conectar(os.environ["ORIGEN_HOST"], os.environ["ORIGEN_PASSWORD"])
    destino = conectar(os.environ["PGHOST"], os.environ["PGPASSWORD"])
    destino.autocommit = True
    co, cd = origen.cursor(), destino.cursor()
    co.execute("select rolname, rolconnlimit from pg_roles where rolname = any(%s)", (list(ROLES),))
    limites = dict(co.fetchall())
    co.execute("select r.rolname, unnest(r.rolconfig) from pg_roles r where r.rolname = any(%s) and r.rolconfig is not null",
               (list(ROLES),))
    ajustes = co.fetchall()
    for rol, sec in ROLES.items():
        pw = secreto(sec)
        cd.execute("select 1 from pg_roles where rolname = %s", (rol,))
        verbo = "ALTER" if cd.fetchone() else "CREATE"
        cd.execute(sql.SQL(f"{verbo} ROLE {{}} WITH LOGIN NOCREATEDB NOCREATEROLE INHERIT CONNECTION LIMIT {{}} PASSWORD {{}}")
                   .format(sql.Identifier(rol), sql.Literal(int(limites.get(rol, -1))), sql.Literal(pw)))
    for rol, cfg in ajustes:
        clave, valor = cfg.split("=", 1)
        cd.execute(sql.SQL("ALTER ROLE {} SET {} = {}").format(sql.Identifier(rol), sql.Identifier(clave), sql.Literal(valor)))
    cd.execute("select 1 from pg_auth_members am join pg_roles r on r.oid=am.roleid join pg_roles m on m.oid=am.member "
               "where r.rolname='vigia_api' and m.rolname='vigia_api_admin'")
    if not cd.fetchone():
        cd.execute("GRANT vigia_api TO vigia_api_admin WITH INHERIT TRUE, SET FALSE")
    # El admin del destino (no es superusuario en RDS) debe poder actuar como los roles dueños de objetos:
    # pg_restore ejecuta ALTER DEFAULT PRIVILEGES FOR ROLE vigia_jobs, que lo exige. En Cloud SQL ya era así.
    for rol in ROLES:
        cd.execute(sql.SQL("GRANT {} TO postgres").format(sql.Identifier(rol)))
    print(f"roles listos en destino: {', '.join(ROLES)} ({len(ajustes)} ajustes copiados)")


if __name__ == "__main__":
    main()
