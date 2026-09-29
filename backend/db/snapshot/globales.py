"""Lo que un export de Cloud SQL (`gcloud sql export sql`) NO trae, como SQL reproducible.

El export de Cloud SQL es un pg_dump sin dueños, sin roles, sin privilegios por defecto y sin
CREATE EXTENSION. Restaurarlo tal cual deja la base sin los roles de la migración 37, con todas las
tablas a nombre de quien importa y sin los permisos propios del dueño en algunas tablas. Este script
lee una base viva (solo lectura) y escribe dos archivos:

  <salida>-pre.sql   antes del import: extensiones, roles (con límites y tiempos), membresías y
                     permisos sobre el esquema public.
  <salida>-post.sql  después del import: dueños, permisos de cada tabla/vista/secuencia/columna/
                     función y privilegios por defecto. Idempotente: se puede correr de nuevo.

Las contraseñas NO se exportan: se ponen después con `gcloud sql users set-password` desde Secret
Manager (ver README.md de esta carpeta).

Uso (variables PG* estándar; PGSSLMODE=require para Cloud SQL por IP pública):
    PGHOST=<ip> PGUSER=postgres PGPASSWORD=... PGDATABASE=vigia \
      python backend/db/snapshot/globales.py --salida respaldo/vigia-2026-09-29
"""
from __future__ import annotations

import argparse
import os
import ssl
from datetime import datetime, timezone

import pg8000.native as pg

ROLES_APP = "rolname LIKE 'vigia%'"
TIPOS = {"r": "TABLE", "p": "TABLE", "v": "TABLE", "m": "TABLE", "f": "TABLE", "S": "SEQUENCE"}


def ident(nombre: str) -> str:
    return '"' + nombre.replace('"', '""') + '"'


def literal(valor: str) -> str:
    return "'" + valor.replace("'", "''") + "'"


def conectar() -> pg.Connection:
    ctx = None
    if os.getenv("PGSSLMODE", "require") != "disable":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    c = pg.Connection(os.getenv("PGUSER", "postgres"), host=os.environ["PGHOST"], port=int(os.getenv("PGPORT", "5432")),
                      database=os.getenv("PGDATABASE", "vigia"), password=os.environ["PGPASSWORD"], ssl_context=ctx, timeout=120)
    c.run("SET default_transaction_read_only = on")
    return c


def pre(c: pg.Connection) -> list[str]:
    out = ["-- Extensiones (versión del origen como referencia; se instala la que ofrezca la instancia)."]
    for nombre, version, esquema in c.run(
            "SELECT extname, extversion, extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1"):
        out.append(f"CREATE EXTENSION IF NOT EXISTS {ident(nombre)} WITH SCHEMA {ident(esquema)};  -- {version}")
    out += ["", "-- Roles de la aplicación: LOGIN sin contraseña (se pone con gcloud desde Secret Manager)."]
    for rol, limite, herencia, config in c.run(
            f"SELECT rolname, rolconnlimit, rolinherit, rolconfig FROM pg_roles WHERE {ROLES_APP} ORDER BY 1"):
        out.append(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = {literal(rol)}) "
                   f"THEN CREATE ROLE {ident(rol)} LOGIN; END IF; END $$;")
        out.append(f"ALTER ROLE {ident(rol)} WITH LOGIN NOCREATEDB NOCREATEROLE {'INHERIT' if herencia else 'NOINHERIT'} "
                   f"CONNECTION LIMIT {limite};")
        for par in config or []:
            clave, valor = par.split("=", 1)
            out.append(f"ALTER ROLE {ident(rol)} SET {clave} = {literal(valor)};")
    out += ["", "-- Membresías entre roles (p. ej. postgres puede asumir vigia_jobs, dueño de los datasets)."]
    for grupo, miembro, hereda, asume in c.run(
            "SELECT r.rolname, m.rolname, am.inherit_option, am.set_option FROM pg_auth_members am "
            "JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member "
            "WHERE (r.rolname LIKE 'vigia%' OR m.rolname LIKE 'vigia%') AND NOT am.admin_option ORDER BY 1, 2"):
        out.append(f"GRANT {ident(grupo)} TO {ident(miembro)} WITH INHERIT {str(hereda).upper()}, SET {str(asume).upper()};")
    out += ["", "-- Esquema public."]
    for rol, priv in c.run(
            "SELECT a.grantee::regrole::text, a.privilege_type FROM pg_namespace n, aclexplode(n.nspacl) a "
            "WHERE n.nspname = 'public' AND a.grantee <> 0 AND a.grantee::regrole::text LIKE 'vigia%' ORDER BY 1, 2"):
        out.append(f"GRANT {priv} ON SCHEMA public TO {ident(rol)};")
    return out


def post(c: pg.Connection) -> list[str]:
    out = ["-- Dueños distintos de postgres (el import deja todo a nombre de quien importa)."]
    for kind, nombre, dueno in c.run(
            "SELECT c.relkind, c.relname, pg_get_userbyid(c.relowner) FROM pg_class c "
            "WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S') "
            "AND pg_get_userbyid(c.relowner) <> 'postgres' ORDER BY (c.relkind = 'S'), 2"):
        tipo = {"S": "SEQUENCE", "v": "VIEW", "m": "MATERIALIZED VIEW"}.get(kind, "TABLE")
        out.append(f"ALTER {tipo} public.{ident(nombre)} OWNER TO {ident(dueno)};")
    out += ["", "-- Permisos por objeto, incluidos los del dueño (el import los pierde en algunas tablas)."]
    for kind, nombre, rol, privs in c.run(
            "SELECT c.relkind, c.relname, a.grantee::regrole::text, string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) "
            "FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'public'::regnamespace "
            "AND c.relkind IN ('r','p','v','m','f','S') AND a.grantee <> 0 GROUP BY 1, 2, 3 ORDER BY 2, 3"):
        out.append(f"GRANT {privs} ON {TIPOS[kind]} public.{ident(nombre)} TO {ident(rol)};")
    for tabla, columna, rol, priv in c.run(
            "SELECT c.relname, at.attname, x.grantee::regrole::text, x.privilege_type FROM pg_attribute at "
            "JOIN pg_class c ON c.oid = at.attrelid, aclexplode(at.attacl) x "
            "WHERE c.relnamespace = 'public'::regnamespace AND at.attacl IS NOT NULL AND x.grantee <> 0 ORDER BY 1, 2, 3"):
        out.append(f"GRANT {priv} ({ident(columna)}) ON TABLE public.{ident(tabla)} TO {ident(rol)};")
    out += ["", "-- Funciones: EXECUTE quitado a PUBLIC donde el origen lo quitó, y dado a cada rol."]
    for (firma,) in c.run(
            "SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace "
            "AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) ORDER BY 1"):
        out.append(f"REVOKE ALL ON FUNCTION {firma} FROM PUBLIC;")
    for firma, rol in c.run(
            "SELECT p.oid::regprocedure::text, a.grantee::regrole::text FROM pg_proc p, aclexplode(p.proacl) a "
            "WHERE p.pronamespace = 'public'::regnamespace AND a.grantee <> 0 AND a.grantee::regrole::text LIKE 'vigia%' ORDER BY 1, 2"):
        out.append(f"GRANT EXECUTE ON FUNCTION {firma} TO {ident(rol)};")
    out += ["", "-- Privilegios por defecto (lo que se cree después)."]
    tipos_def = {"r": "TABLES", "S": "SEQUENCES", "f": "FUNCTIONS", "T": "TYPES"}
    for dueno, esquema, tipo, rol, priv in c.run(
            "SELECT pg_get_userbyid(d.defaclrole), d.defaclnamespace::regnamespace::text, d.defaclobjtype::text, "
            "a.grantee::regrole::text, a.privilege_type FROM pg_default_acl d, aclexplode(d.defaclacl) a "
            "WHERE a.grantee <> 0 ORDER BY 1, 3, 4"):
        out.append(f"ALTER DEFAULT PRIVILEGES FOR ROLE {ident(dueno)} IN SCHEMA {ident(esquema)} "
                   f"GRANT {priv} ON {tipos_def.get(tipo, 'TABLES')} TO {ident(rol)};")
    out += ["", "ANALYZE;"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--salida", required=True, help="prefijo de los archivos (sin extensión)")
    args = ap.parse_args()
    c = conectar()
    origen = f"{os.environ['PGHOST']}/{os.getenv('PGDATABASE', 'vigia')}"
    cuando = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for sufijo, partes, cuando_correr in (("pre", pre(c), "ANTES"), ("post", post(c), "DESPUÉS")):
        cabecera = [f"-- Vigía Perú · globales de {origen} · {cuando}",
                    f"-- Correr como postgres {cuando_correr} de importar el export de Cloud SQL (backend/db/snapshot/README.md).", ""]
        ruta = f"{args.salida}-{sufijo}.sql"
        with open(ruta, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(cabecera + partes) + "\n")
        print(f"{ruta}: {len(partes)} líneas")


if __name__ == "__main__":
    main()
