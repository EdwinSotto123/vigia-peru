"""
Entorno DEV de Vigía (docs/DEV.md): la parte que habla con AWS, la base y Cloudflare. La llama
infrastructure/deploy/dev.sh; no hace falta usarla directo.

    python infrastructure/dev/dev.py base       roles dev_*, PgBouncer y Hyperdrive (idempotente)
    python infrastructure/dev/dev.py secretos   secretos de vigia-api-dev, vigia-web-dev y vigia-scrapers-dev
    python infrastructure/dev/dev.py clonar     rehace vigia-db-dev desde producción (la base DEV se pierde)
    python infrastructure/dev/dev.py migrar <archivo.sql>...
    python infrastructure/dev/dev.py sql "<consulta>"
    python infrastructure/dev/dev.py correr '{"fuente": "oece_ocds", "seco": true}'
    python infrastructure/dev/dev.py detener | encender | estado
    python infrastructure/dev/dev.py tamano db.t4g.large   (para medir tiempos como en producción; volver a db.t4g.micro)
    python infrastructure/dev/dev.py precalentar           (lee cada tabla una vez: baja de S3 el volumen recién clonado)

Los secretos viven en SSM Parameter Store bajo /vigia/dev/ (se crean al azar la primera vez) y nunca se imprimen.
Las credenciales de DEV (roles dev_*) existen sólo en vigia-db-dev: no sirven contra producción.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import secrets
import subprocess
import sys
import time

import boto3
import psycopg2
import requests

REGION = "us-east-2"
PERFIL = os.environ.get("AWS_PROFILE", "founder.edwin")
PROD = "vigia-db"
DEV = "vigia-db-dev"
PROXY = "vigia-db-proxy"                      # EC2 con PgBouncer + túnel de Cloudflare (tag Name)
ALIAS_DEV = "vigia_dev"                       # nombre de la base DEV en PgBouncer (la real se llama vigia)
SERVICIO_VPC = "vigia-pgbouncer"              # servicio de Workers VPC que llega al túnel
# rol DEV → (rol de producción del que hereda permisos, secreto, Hyperdrive)
ROLES = {
    "dev_api": ("vigia_api", "db-api", "vigia-dev-api"),
    "dev_api_admin": ("vigia_api_admin", "db-api-admin", "vigia-dev-api-admin"),
    "dev_jobs": ("vigia_jobs", "db-jobs", "vigia-dev-jobs"),
}
SCRAPERS_DEV = "https://vigia-scrapers-dev.vigiaperu.workers.dev"
RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Turnstile de prueba de Cloudflare (siempre pasa): el widget de producción no acepta el dominio DEV.
TURNSTILE_PRUEBA = "1x0000000000000000000000000000000AA"

sesion = boto3.Session(profile_name=PERFIL, region_name=REGION)
ssm, rds, ec2 = sesion.client("ssm"), sesion.client("rds"), sesion.client("ec2")
sys.stdout.reconfigure(encoding="utf-8")


def secreto(nombre: str, crear: bool = True) -> str:
    """/vigia/dev/<nombre>; si no existe, se genera al azar y se guarda (sin imprimirlo)."""
    ruta = nombre if nombre.startswith("/") else f"/vigia/dev/{nombre}"
    try:
        return ssm.get_parameter(Name=ruta, WithDecryption=True)["Parameter"]["Value"]
    except ssm.exceptions.ParameterNotFound:
        if not crear:
            raise
        valor = secrets.token_urlsafe(30).replace("-", "a").replace("_", "b")
        ssm.put_parameter(Name=ruta, Value=valor, Type="SecureString")
        print(f"  secreto nuevo en SSM: {ruta}")
        return valor


def instancia(ident: str = DEV) -> dict | None:
    try:
        return rds.describe_db_instances(DBInstanceIdentifier=ident)["DBInstances"][0]
    except rds.exceptions.DBInstanceNotFoundFault:
        return None


def esperar(ident: str, estado: str = "available") -> dict:
    while True:
        i = instancia(ident)
        actual = i["DBInstanceStatus"] if i else "no existe"
        pendiente = (i or {}).get("PendingModifiedValues") or {}
        if actual == estado and not pendiente:
            return i
        print(f"  {time.strftime('%H:%M')} {ident}: {actual}{' (con cambios pendientes)' if pendiente else ''}")
        time.sleep(30)


def host() -> str:
    i = instancia()
    if not i:
        sys.exit(f"{DEV} no existe: correr `dev.sh clonar`")
    return i["Endpoint"]["Address"]


_TUNELES = contextlib.ExitStack()
atexit.register(_TUNELES.close)
_destino: tuple[str, int] | None = None


def destino() -> tuple[str, int]:
    """La base DEV no es pública (2026-10-21): se llega por un túnel de SSM a través del proxy
    (infrastructure/aws/tunel_rds.py), uno por proceso, que se cierra al salir."""
    global _destino
    if _destino is None:
        host()   # corta con un mensaje claro si la base no existe
        sys.path.insert(0, os.path.join(RAIZ, "infrastructure", "aws"))
        from tunel_rds import tunel
        _destino = _TUNELES.enter_context(tunel(DEV))
    return _destino


def conectar(db: str = "vigia"):
    h, puerto = destino()
    c = psycopg2.connect(host=h, port=puerto, dbname=db, user="postgres", password=secreto("db-admin"), sslmode="require",
                         options="-c statement_timeout=0", keepalives=1, keepalives_idle=30, keepalives_interval=10,
                         keepalives_count=10, connect_timeout=15)
    c.autocommit = True
    return c


def wrangler(args: list[str], carpeta: str, entrada: str | None = None) -> str:
    r = subprocess.run(["npx", "--yes", "wrangler", *args], cwd=os.path.join(RAIZ, carpeta), input=entrada,
                       capture_output=True, text=True, encoding="utf-8", shell=os.name == "nt")
    if r.returncode != 0:
        raise RuntimeError(f"wrangler {' '.join(args[:3])}: {r.stderr.strip()[-400:]}")
    return r.stdout


# ─────────────────────────── base ───────────────────────────

def clave_admin():
    """La clave maestra de DEV es propia (el clon trae la de producción)."""
    nueva = False
    try:
        ssm.get_parameter(Name="/vigia/dev/db-admin")
    except ssm.exceptions.ParameterNotFound:
        nueva = True
    clave = secreto("db-admin")
    try:
        conectar().close()
        return
    except psycopg2.OperationalError:
        pass
    print(f"  {'fijando' if nueva else 'repitiendo'} la clave maestra de {DEV}")
    rds.modify_db_instance(DBInstanceIdentifier=DEV, MasterUserPassword=clave, ApplyImmediately=True)
    time.sleep(20)
    esperar(DEV)
    for _ in range(20):
        try:
            conectar().close()
            return
        except psycopg2.OperationalError:
            time.sleep(15)
    sys.exit("la clave maestra nueva no entra todavía; repetir `dev.sh base` en unos minutos")


def roles():
    with conectar() as c, c.cursor() as cur:
        for rol, (hereda, nombre, _) in ROLES.items():
            pw = secreto(nombre)
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (rol,))
            verbo = "ALTER" if cur.fetchone() else "CREATE"
            cur.execute(f'{verbo} ROLE {rol} LOGIN PASSWORD %s', (pw,))
            cur.execute(f"GRANT {hereda} TO {rol}")
            # Los mismos límites que su rol de producción (statement_timeout, lock_timeout…).
            cur.execute("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setrole = %s::regrole AND setdatabase = 0", (hereda,))
            for (par,) in cur.fetchall():
                k, v = par.split("=", 1)
                cur.execute(f"ALTER ROLE {rol} SET {k} = %s", (v,))
            print(f"  rol {rol}: {verbo.lower()} (hereda {hereda})")


def proxy():
    """Agrega los roles dev_* a la userlist de PgBouncer y la base `vigia_dev` (→ vigia-db-dev) a su configuración."""
    actual = ssm.get_parameter(Name="/vigia/proxy/userlist", WithDecryption=True)["Parameter"]["Value"]
    lineas = [l for l in actual.splitlines() if l.strip() and not any(l.startswith(f'"{r}"') for r in ROLES)]
    lineas += [f'"{r}" "{secreto(n)}"' for r, (_, n, _) in ROLES.items()]
    nuevo = "\n".join(lineas) + "\n"
    if nuevo != actual:
        ssm.put_parameter(Name="/vigia/proxy/userlist", Value=nuevo, Type="SecureString", Overwrite=True, Tier="Advanced")
        print("  userlist de PgBouncer actualizada en SSM")
    ids = [i["InstanceId"] for r in ec2.describe_instances(Filters=[{"Name": "tag:Name", "Values": [PROXY]},
                                                                     {"Name": "instance-state-name", "Values": ["running"]}])["Reservations"]
           for i in r["Instances"]]
    if not ids:
        sys.exit(f"no encuentro la instancia {PROXY}")
    h = host()
    comandos = [
        "set -euo pipefail",
        f"aws ssm get-parameter --region {REGION} --name /vigia/proxy/userlist --with-decryption --query Parameter.Value --output text > /etc/pgbouncer/userlist.txt",
        "chmod 600 /etc/pgbouncer/userlist.txt && chown 70:70 /etc/pgbouncer/userlist.txt",
        f"sed -i '/^{ALIAS_DEV} = /d' /etc/pgbouncer/pgbouncer.ini",
        f"sed -i '/^\\[databases\\]/a {ALIAS_DEV} = host={h} port=5432 dbname=vigia' /etc/pgbouncer/pgbouncer.ini",
        "docker kill -s HUP pgbouncer >/dev/null",
        "grep -c '^vigia' /etc/pgbouncer/pgbouncer.ini",
    ]
    cmd = ssm.send_command(InstanceIds=ids, DocumentName="AWS-RunShellScript", Parameters={"commands": comandos})["Command"]["CommandId"]
    for _ in range(30):
        time.sleep(3)
        r = ssm.get_command_invocation(CommandId=cmd, InstanceId=ids[0])
        if r["Status"] in ("Success", "Failed", "Cancelled", "TimedOut"):
            break
    if r["Status"] != "Success":
        sys.exit(f"PgBouncer: {r['Status']} · {r.get('StandardErrorContent', '')[-300:]}")
    print(f"  PgBouncer: base {ALIAS_DEV} → {h} (recargado)")


def hyperdrive():
    existentes = wrangler(["hyperdrive", "list"], "backend/api")
    servicios = wrangler(["vpc", "service", "list"], "backend/api")
    svc = next((l.split("│")[1].strip() for l in servicios.splitlines() if SERVICIO_VPC in l and "│" in l), None)
    if not svc:
        import re
        m = re.search(r"([0-9a-f]{8}-[0-9a-f-]{27})[^\n]*" + SERVICIO_VPC, servicios) or re.search(SERVICIO_VPC + r"[^\n]*?([0-9a-f]{8}-[0-9a-f-]{27})", servicios)
        svc = m.group(1) if m else None
    if not svc:
        sys.exit(f"no encuentro el servicio VPC {SERVICIO_VPC}")
    for rol, (_, nombre, hd) in ROLES.items():
        if f" {hd} " in existentes:
            print(f"  Hyperdrive {hd}: ya existe")
            continue
        salida = wrangler(["hyperdrive", "create", hd, "--service-id", svc, "--database", ALIAS_DEV, "--user", rol,
                           "--password", secreto(nombre), "--scheme", "postgresql", "--origin-connection-limit", "5",
                           "--caching-disabled"], "backend/api")
        print(f"  Hyperdrive {hd}: creado · " + " ".join(l.strip() for l in salida.splitlines() if '"id"' in l))
    print(wrangler(["hyperdrive", "list"], "backend/api"))


def base():
    print(f"· {DEV}")
    esperar(DEV)
    clave_admin()
    roles()
    print("· PgBouncer")
    proxy()
    print("· Hyperdrive")
    hyperdrive()


# ─────────────────────────── secretos de los Workers ───────────────────────────

def secretos():
    def poner(carpeta: str, nombre: str, valor: str):
        wrangler(["secret", "put", nombre, "--env", "dev"], carpeta, entrada=valor)
        print(f"  {carpeta}: {nombre}")
    admin = secreto("admin-token")
    poner("backend/api", "ADMIN_TOKEN", admin)
    poner("backend/api", "PRIVACIDAD_CLAVE", secreto("privacidad-clave"))
    poner("backend/api", "TURNSTILE_SECRET_KEY", TURNSTILE_PRUEBA)
    poner("frontend", "ADMIN_TOKEN", admin)
    poner("frontend", "ADMIN_SESSION_SECRET", secreto("web-sesion"))
    poner("frontend", "TURNSTILE_SECRET_KEY", TURNSTILE_PRUEBA)
    poner("frontend", "DEV_USUARIO", "vigia")
    poner("frontend", "DEV_CLAVE", secreto("web-clave"))
    # Los mismos administradores que producción (secreto de GCP), sin pasar por la pantalla.
    correos = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret=admin-emails",
                              "--project=vivid-spot-480905-a4", "--account=hello@simplia.store"],
                             capture_output=True, text=True, shell=os.name == "nt").stdout.strip()
    if correos:
        poner("frontend", "ADMIN_EMAILS", correos)
    poner("backend/scrapers-worker", "SCRAPERS_TOKEN", secreto("scrapers-token"))
    poner("backend/scrapers-worker", "RELAY_TOKEN", secreto("/vigia/relay/token", crear=False))
    print("Usuario de la web DEV: vigia · clave: SSM /vigia/dev/web-clave")


# ─────────────────────────── clonar ───────────────────────────

def clonar():
    nuevo = f"{DEV}-nuevo"
    p = instancia(PROD)
    if instancia(nuevo):
        print(f"  {nuevo} ya existe (una clonación anterior a medias): sigo desde ahí")
    else:
        print(f"· restaurando {PROD} al último minuto restaurable en {nuevo}")
        rds.restore_db_instance_to_point_in_time(
            SourceDBInstanceIdentifier=PROD, TargetDBInstanceIdentifier=nuevo, UseLatestRestorableTime=True,
            DBInstanceClass="db.t4g.micro", DBSubnetGroupName=p["DBSubnetGroup"]["DBSubnetGroupName"],
            VpcSecurityGroupIds=[g["VpcSecurityGroupId"] for g in p["VpcSecurityGroups"]],
            DBParameterGroupName=p["DBParameterGroups"][0]["DBParameterGroupName"], PubliclyAccessible=False, MultiAZ=False,
            StorageType="gp3", BackupRetentionPeriod=1, DeletionProtection=False, EnableCloudwatchLogsExports=["postgresql"],
            Tags=[{"Key": "entorno", "Value": "dev"}, {"Key": "proyecto", "Value": "vigia"}])
    esperar(nuevo)
    if instancia(DEV):
        print(f"· borrando el {DEV} anterior")
        rds.delete_db_instance(DBInstanceIdentifier=DEV, SkipFinalSnapshot=True, DeleteAutomatedBackups=True)
        while instancia(DEV):
            time.sleep(30)
    print(f"· {nuevo} → {DEV}")
    rds.modify_db_instance(DBInstanceIdentifier=nuevo, NewDBInstanceIdentifier=DEV, ApplyImmediately=True)
    while not instancia(DEV):
        time.sleep(20)
    base()


# ─────────────────────────── uso diario ───────────────────────────

def migrar(archivos: list[str]):
    with conectar() as c, c.cursor() as cur:
        for a in archivos:
            t0 = time.time()
            cur.execute(open(a, encoding="utf-8").read())
            print(f"  {os.path.basename(a)}: aplicada en {time.time() - t0:.0f} s")


def sql(consulta: str):
    with conectar() as c, c.cursor() as cur:
        t0 = time.time()
        cur.execute(consulta)
        if cur.description:
            print(" | ".join(d[0] for d in cur.description))
            for fila in cur.fetchall()[:200]:
                print(" | ".join("" if v is None else str(v) for v in fila))
        print(f"-- {time.time() - t0:.1f} s")


def correr(cuerpo: str):
    r = requests.post(f"{SCRAPERS_DEV}/correr", data=cuerpo, timeout=60,
                      headers={"Authorization": f"Bearer {secreto('scrapers-token')}", "Content-Type": "application/json"})
    print(r.status_code, r.text[:2000])


def estado():
    i = instancia()
    print(f"{DEV}: {i['DBInstanceStatus'] if i else 'no existe'}" + (f" · {i['DBInstanceClass']} · {i['AllocatedStorage']} GB" if i else ""))
    for url in ("https://vigia-api-dev.vigiaperu.workers.dev/health", "https://vigia-web-dev.vigiaperu.workers.dev/"):
        try:
            r = requests.get(url, timeout=20)
            print(f"{url} → {r.status_code} {r.text[:120] if r.status_code == 200 else ''}")
        except requests.RequestException as e:
            print(f"{url} → {e.__class__.__name__}")


def precalentar():
    """Un RDS restaurado de un snapshot baja cada bloque de S3 la primera vez que se lee (mucho más lento que el disco):
    pg_prewarm 'read' de cada tabla, índice y TOAST los baja todos una vez. Lo que más usan las páginas, primero."""
    with conectar() as c, c.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_prewarm")
        cur.execute("""SELECT c.oid::regclass::text, pg_relation_size(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname IN ('public', 'pg_toast') AND c.relkind IN ('r', 'i', 'm', 't') AND pg_relation_size(c.oid) > 0
                       ORDER BY (c.relname ~ '^(contrato_estado|casos_cruce|convocatoria_busqueda|precio_|cruces_proveedor|entidad_stats|contratos_agregado|partido_)') DESC,
                                pg_relation_size(c.oid)""")
        rels = cur.fetchall()
        t0, total = time.time(), 0
        for nombre, tam in rels:
            cur.execute("SELECT pg_prewarm(%s, 'read')", (nombre,))
            total += tam
        print(f"  {len(rels)} tablas e índices, {total / 2**30:.1f} GB en {time.time() - t0:.0f} s")


if __name__ == "__main__":
    accion, resto = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if accion == "base":
        base()
    elif accion == "secretos":
        secretos()
    elif accion == "clonar":
        clonar()
    elif accion == "migrar" and resto:
        migrar(resto)
    elif accion == "sql" and resto:
        sql(" ".join(resto))
    elif accion == "correr" and resto:
        correr(resto[0])
    elif accion == "detener":
        rds.stop_db_instance(DBInstanceIdentifier=DEV)
        print(f"{DEV}: deteniéndose (AWS la vuelve a encender sola a los 7 días)")
    elif accion == "encender":
        rds.start_db_instance(DBInstanceIdentifier=DEV)
        esperar(DEV)
        print(f"{DEV}: encendida")
    elif accion == "estado":
        estado()
    elif accion == "tamano" and resto:
        i = instancia()
        print(f"{DEV}: {i['DBInstanceClass']} → {resto[0]} (unos minutos sin base)")
        rds.modify_db_instance(DBInstanceIdentifier=DEV, DBInstanceClass=resto[0], ApplyImmediately=True)
        time.sleep(30)
        esperar(DEV)
        print(f"{DEV}: {instancia()['DBInstanceClass']}")
    elif accion == "precalentar":
        precalentar()
    else:
        print(__doc__)
        sys.exit(2)
