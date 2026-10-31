#!/usr/bin/env python3
"""Relay de Lima (backend/relay-lima): la instancia EC2 en la Local Zone de AWS en Lima, su túnel de Cloudflare y el
servicio de Workers VPC por el que llega el Worker vigia-scrapers. Qué es y por qué: backend/relay-lima/README.md.

  python infrastructure/deploy/aws/relay_lima.py crear        # crea lo que falte (idempotente) y arranca la instancia
  python infrastructure/deploy/aws/relay_lima.py actualizar   # sube relay.py por SSM y lo reinicia (--cloudflared: también
                                                              # instala el cloudflared más nuevo)
  python infrastructure/deploy/aws/relay_lima.py estado       # instancia, IP, túnel, servicio VPC y /health
  python infrastructure/deploy/aws/relay_lima.py ejecutar 'dig +short procuraduriaanticorrupcion.minjus.gob.pe'

Requiere el perfil de AWS (AWS_PROFILE, por defecto founder.edwin) y `npx wrangler` con la sesión de Cloudflare de Vigía
(la misma de infrastructure/deploy/cloudflare/base.sh). Los dos secretos (token del relay y del túnel) van de su origen a
SSM Parameter Store por un archivo temporal que se borra al momento: nunca a la pantalla ni a la línea de comandos.

Todo vive en us-east-1 (la región madre de la zona de Lima), en la VPC por defecto: subred vigia-lima (172.31.96.0/24),
grupo de seguridad sin reglas de entrada, rol con SSM (para administrarla sin SSH) y lectura de sus dos secretos, una
interfaz de red con IP elástica de Lima (sale con la misma IP siempre) y protección contra borrado.
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
DIR_RELAY = RAIZ / "backend" / "relay-lima"
DIR_WORKER = RAIZ / "backend" / "scrapers-worker"
PERFIL = os.environ.get("AWS_PROFILE", "founder.edwin")
REGION = "us-east-1"            # la Local Zone de Lima cuelga de us-east-1
ZONA = "us-east-1-lim-1a"
GRUPO_RED = "us-east-1-lim-1"   # de aquí sale la IP elástica: una IP de Lima
REGION_SECRETOS = "us-east-2"   # donde están los demás secretos de Vigía
CIDR = "172.31.96.0/24"
NOMBRE = "vigia-relay-lima"     # instancia, grupo de seguridad, rol, IP elástica, interfaz y servicio VPC
SUBRED = "vigia-lima"
TUNEL = "vigia-lima"
SECRETO_TOKEN = "/vigia/relay-lima/token"
SECRETO_TUNEL = "/vigia/relay-lima/tunel"
TIPO = "t3.medium"              # el más chico que ofrece la zona de Lima
AMI_SSM = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
RPM_CLOUDFLARED = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm"
ETIQUETAS = [{"Key": "Name", "Value": NOMBRE}, {"Key": "proyecto", "Value": "vigia"}]


# La CLI de AWS en Windows escribe en cp1252 y se cae con «→» u otro carácter de la salida de un comando: en UTF-8.
ENTORNO_CLI = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")


def aws(*args: str, region: str = REGION, silencio: bool = False) -> dict | list | str | None:
    r = subprocess.run(["aws", *args, "--profile", PERFIL, "--region", region, "--output", "json"],
                       capture_output=True, text=True, encoding="utf-8", env=ENTORNO_CLI)
    if r.returncode != 0:
        if silencio:
            return None
        raise RuntimeError(f"aws {' '.join(args[:2])}: {r.stderr.strip()[:500]}")
    return json.loads(r.stdout) if r.stdout.strip() else None


def wrangler(*args: str, entrada: str | None = None) -> str:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    r = subprocess.run([npx, "--yes", "wrangler", *args], cwd=DIR_WORKER, input=entrada, capture_output=True, text=True,
                       encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"wrangler {' '.join(args[:3])}: {(r.stderr or r.stdout).strip()[-500:]}")
    return r.stdout


def poner_secreto(nombre: str, valor: str, descripcion: str) -> None:
    """SecureString en SSM por --cli-input-json: el valor no pasa por la línea de comandos."""
    fd, ruta = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"Name": nombre, "Value": valor, "Type": "SecureString", "Overwrite": True,
                       "Description": descripcion}, f)
        aws("ssm", "put-parameter", "--cli-input-json", f"file://{Path(ruta).as_posix()}", region=REGION_SECRETOS)
    finally:
        os.remove(ruta)


def existe_secreto(nombre: str) -> bool:
    return aws("ssm", "get-parameter", "--name", nombre, "--query", "Parameter.Name", region=REGION_SECRETOS,
               silencio=True) is not None


# ─── Cloudflare ───────────────────────────────────────────────────────────────────────────────────────────────────────

def id_tunel() -> str | None:
    for linea in wrangler("tunnel", "list").splitlines():
        if re.search(rf"\b{TUNEL}\b", linea):
            m = re.search(r"[0-9a-f]{8}-[0-9a-f-]{27}", linea)
            if m:
                return m.group(0)
    return None


def token_del_tunel(tunel: str) -> str:
    """El token del túnel, de la API de Cloudflare con la sesión de wrangler (como base.sh tunel)."""
    cuenta = re.search(r"\b[0-9a-f]{32}\b", wrangler("whoami"))  # además renueva la sesión si venció
    if not cuenta:
        raise RuntimeError("wrangler whoami no dio la cuenta")
    lugares = [Path(os.environ.get("APPDATA", "")) / "xdg.config/.wrangler/config/default.toml",
               Path.home() / ".config/.wrangler/config/default.toml", Path.home() / ".wrangler/config/default.toml"]
    cfg = next((p for p in lugares if p.is_file()), None)
    if not cfg:
        raise RuntimeError("no encuentro la sesión de wrangler (npx wrangler login)")
    tok = tomllib.loads(cfg.read_text(encoding="utf-8"))["oauth_token"]
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{cuenta.group(0)}/cfd_tunnel/{tunel}/token",
        headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]


def servicio_vpc() -> str | None:
    for linea in wrangler("vpc", "service", "list").splitlines():
        if re.search(rf"\b{NOMBRE}\b", linea):
            m = re.search(r"[0-9a-f]{8}-[0-9a-f-]{27}", linea)
            if m:
                return m.group(0)
    return None


# ─── AWS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def vpc_por_defecto() -> str:
    return aws("ec2", "describe-vpcs", "--filters", "Name=is-default,Values=true", "--query", "Vpcs[0].VpcId")


def subred(vpc: str) -> str:
    s = aws("ec2", "describe-subnets", "--filters", f"Name=vpc-id,Values={vpc}", f"Name=availability-zone,Values={ZONA}",
            "--query", "Subnets[0].SubnetId")
    if s:
        return s
    s = aws("ec2", "create-subnet", "--vpc-id", vpc, "--cidr-block", CIDR, "--availability-zone", ZONA,
            "--tag-specifications", json.dumps([{"ResourceType": "subnet", "Tags": [{"Key": "Name", "Value": SUBRED}]}]),
            "--query", "Subnet.SubnetId")
    print(f"subred {SUBRED}: {s}")
    return s


def grupo_seguridad(vpc: str) -> str:
    g = aws("ec2", "describe-security-groups", "--filters", f"Name=vpc-id,Values={vpc}", f"Name=group-name,Values={NOMBRE}",
            "--query", "SecurityGroups[0].GroupId")
    if g:
        return g
    g = aws("ec2", "create-security-group", "--vpc-id", vpc, "--group-name", NOMBRE,
            "--description", "Relay de Lima de Vigia: sin entradas, solo salida",
            "--tag-specifications", json.dumps([{"ResourceType": "security-group", "Tags": ETIQUETAS}]), "--query", "GroupId")
    print(f"grupo de seguridad {NOMBRE}: {g} (sin reglas de entrada)")
    return g


def rol() -> None:
    if aws("iam", "get-role", "--role-name", NOMBRE, silencio=True) is None:
        confianza = {"Version": "2012-10-17", "Statement": [
            {"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
        aws("iam", "create-role", "--role-name", NOMBRE, "--assume-role-policy-document", json.dumps(confianza),
            "--description", "Relay de Lima de Vigia: SSM y sus dos secretos")
        aws("iam", "attach-role-policy", "--role-name", NOMBRE,
            "--policy-arn", "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore")
        print(f"rol {NOMBRE}: creado")
    cuenta = aws("sts", "get-caller-identity", "--query", "Account")
    secretos = {"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Action": "ssm:GetParameter",
        "Resource": [f"arn:aws:ssm:{REGION_SECRETOS}:{cuenta}:parameter{SECRETO_TOKEN}",
                     f"arn:aws:ssm:{REGION_SECRETOS}:{cuenta}:parameter{SECRETO_TUNEL}"]}]}
    aws("iam", "put-role-policy", "--role-name", NOMBRE, "--policy-name", "leer-sus-secretos",
        "--policy-document", json.dumps(secretos))
    if aws("iam", "get-instance-profile", "--instance-profile-name", NOMBRE, silencio=True) is None:
        aws("iam", "create-instance-profile", "--instance-profile-name", NOMBRE)
        aws("iam", "add-role-to-instance-profile", "--instance-profile-name", NOMBRE, "--role-name", NOMBRE)
        print(f"perfil de instancia {NOMBRE}: creado (IAM tarda unos segundos en verlo)")
        time.sleep(15)


def ip_e_interfaz(sub: str, sg: str) -> tuple[str, str, str]:
    """La IP elástica (de Lima) asociada a una interfaz propia: la instancia arranca ya con ella y, si se reemplaza, la
    interfaz (y la IP) quedan."""
    filtro = f"Name=tag:Name,Values={NOMBRE}"
    ip = aws("ec2", "describe-addresses", "--filters", filtro, "--query", "Addresses[0]")
    if not ip:
        ip = aws("ec2", "allocate-address", "--domain", "vpc", "--network-border-group", GRUPO_RED,
                 "--tag-specifications", json.dumps([{"ResourceType": "elastic-ip", "Tags": ETIQUETAS}]))
        print(f"IP elástica: {ip['PublicIp']}")
    eni = aws("ec2", "describe-network-interfaces", "--filters", filtro, "--query", "NetworkInterfaces[0].NetworkInterfaceId")
    if not eni:
        eni = aws("ec2", "create-network-interface", "--subnet-id", sub, "--groups", sg, "--description", NOMBRE,
                  "--tag-specifications", json.dumps([{"ResourceType": "network-interface", "Tags": ETIQUETAS}]),
                  "--query", "NetworkInterface.NetworkInterfaceId")
        print(f"interfaz de red: {eni}")
    if ip.get("NetworkInterfaceId") != eni:
        aws("ec2", "associate-address", "--allocation-id", ip["AllocationId"], "--network-interface-id", eni)
    return ip["PublicIp"], ip["AllocationId"], eni


def instancia() -> dict | None:
    return aws("ec2", "describe-instances", "--filters", f"Name=tag:Name,Values={NOMBRE}",
               "Name=instance-state-name,Values=pending,running,stopping,stopped", "--query", "Reservations[0].Instances[0]")


def relay_comprimido() -> str:
    """relay.py en gzip + base64: así entra en los 16 KB del user-data de EC2."""
    return base64.b64encode(gzip.compress((DIR_RELAY / "relay.py").read_bytes(), mtime=0)).decode()


def datos_de_usuario() -> str:
    b64 = relay_comprimido()
    texto = (DIR_RELAY / "arranque.sh").read_text(encoding="utf-8").replace("__RELAY_PY_B64__", b64)
    if len(texto.encode()) > 16_000:
        raise RuntimeError("el user-data pasa los 16 KB de EC2")
    return texto


def lanzar(eni: str) -> str:
    ami = aws("ssm", "get-parameter", "--name", AMI_SSM, "--query", "Parameter.Value")
    fd, ruta = tempfile.mkstemp(suffix=".sh")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(datos_de_usuario())
    try:
        for intento in range(5):
            try:
                i = aws("ec2", "run-instances", "--image-id", ami, "--instance-type", TIPO,
                        "--network-interfaces", json.dumps([{"NetworkInterfaceId": eni, "DeviceIndex": 0}]),
                        "--iam-instance-profile", f"Name={NOMBRE}",
                        "--block-device-mappings", json.dumps([{"DeviceName": "/dev/xvda", "Ebs": {
                            "VolumeSize": 20, "VolumeType": "gp2", "Encrypted": True, "DeleteOnTermination": True}}]),
                        "--metadata-options", "HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1",
                        "--disable-api-termination", "--user-data", f"file://{Path(ruta).as_posix()}",
                        "--tag-specifications", json.dumps([{"ResourceType": "instance", "Tags": ETIQUETAS},
                                                            {"ResourceType": "volume", "Tags": ETIQUETAS}]),
                        "--query", "Instances[0].InstanceId")
                print(f"instancia {NOMBRE}: {i} ({TIPO}, {ZONA})")
                return i
            except RuntimeError as e:
                if "Invalid IAM Instance Profile" not in str(e) or intento == 4:
                    raise
                time.sleep(10)
    finally:
        os.remove(ruta)
    raise RuntimeError("no se pudo lanzar")


def en_la_instancia(i: str, comandos: list[str], espera_s: int = 300) -> tuple[str, str, str]:
    """Corre comandos de shell en la instancia por SSM Run Command y devuelve (estado, salida, errores)."""
    cmd = aws("ssm", "send-command", "--instance-ids", i, "--document-name", "AWS-RunShellScript",
              "--parameters", json.dumps({"commands": comandos, "executionTimeout": [str(espera_s)]}),
              "--query", "Command.CommandId")
    for _ in range(espera_s // 3 + 10):
        time.sleep(3)
        r = aws("ssm", "get-command-invocation", "--command-id", cmd, "--instance-id", i, silencio=True)
        if r and r["Status"] not in ("Pending", "InProgress", "Delayed"):
            return r["Status"], r.get("StandardOutputContent", ""), r.get("StandardErrorContent", "")
    return "sin respuesta", "", ""


def esperar_ssm(i: str, minutos: int = 10) -> bool:
    for _ in range(minutos * 6):
        estado = aws("ssm", "describe-instance-information", "--filters", f"Key=InstanceIds,Values={i}",
                     "--query", "InstanceInformationList[0].PingStatus", silencio=True)
        if estado == "Online":
            return True
        time.sleep(10)
    return False


# ─── Comandos ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def crear() -> None:
    vpc = vpc_por_defecto()
    sub = subred(vpc)
    sg = grupo_seguridad(vpc)
    rol()
    if not existe_secreto(SECRETO_TOKEN):
        poner_secreto(SECRETO_TOKEN, secrets.token_urlsafe(32), "Relay de Lima: X-Vigia-Token (= RELAY_LIMA_TOKEN de vigia-scrapers)")
        print(f"secreto {SECRETO_TOKEN}: creado")
    tunel = id_tunel()
    if not tunel:
        salida = wrangler("tunnel", "create", TUNEL)
        print("\n".join(l for l in salida.splitlines() if "token" not in l.lower()))
        tunel = id_tunel()
    if not existe_secreto(SECRETO_TUNEL):
        poner_secreto(SECRETO_TUNEL, token_del_tunel(tunel), "Relay de Lima: token del tunel de Cloudflare vigia-lima")
        print(f"secreto {SECRETO_TUNEL}: guardado")
    svc = servicio_vpc()
    if not svc:
        wrangler("vpc", "service", "create", NOMBRE, "--type", "http", "--http-port", "8080", "--ipv4", "127.0.0.1",
                 "--tunnel-id", tunel)
        svc = servicio_vpc()
    ip, _, eni = ip_e_interfaz(sub, sg)
    actual = instancia()
    i = actual["InstanceId"] if actual else lanzar(eni)
    print(f"túnel {TUNEL}: {tunel}\nservicio VPC {NOMBRE}: {svc}\nIP de salida: {ip}\ninstancia: {i}")
    print("esperando a que la instancia responda por SSM…")
    if not esperar_ssm(i):
        sys.exit("la instancia no aparece en SSM tras 10 min: revisa la consola serie (aws ec2 get-console-output)")
    for _ in range(30):  # el arranque (cloud-init) instala cloudflared y levanta los servicios
        estado, salida, _ = en_la_instancia(i, ["test -f /var/log/vigia-arranque.log && tail -3 /var/log/vigia-arranque.log"])
        if "arranque terminado" in salida:
            break
        time.sleep(10)
    estado_()
    print(f'\nEn backend/scrapers-worker/wrangler.jsonc (arriba y en env.dev):\n  "vpc_services": [{{ "binding": "RELAY_LIMA", '
          f'"service_id": "{svc}" }}]\ny el secreto: aws ssm get-parameter --name {SECRETO_TOKEN} --with-decryption … | '
          f"npx wrangler secret put RELAY_LIMA_TOKEN [--env dev]")


def actualizar(con_cloudflared: bool) -> None:
    i = instancia()["InstanceId"]
    b64 = relay_comprimido()
    comandos = [
        "set -e",
        f"echo '{b64}' | base64 -d | gunzip > /opt/vigia-relay/relay.py.nuevo",
        "python3 -c \"import ast; ast.parse(open('/opt/vigia-relay/relay.py.nuevo').read())\"",
        "chmod 644 /opt/vigia-relay/relay.py.nuevo && mv /opt/vigia-relay/relay.py.nuevo /opt/vigia-relay/relay.py",
        # El token otra vez de SSM (por si se rotó): va directo al archivo, nunca a la salida del comando.
        "umask 077",
        f"printf 'RELAY_TOKEN=%s\\n' \"$(aws ssm get-parameter --region {REGION_SECRETOS} --name {SECRETO_TOKEN} "
        "--with-decryption --query Parameter.Value --output text)\" > /etc/vigia-relay/entorno.nuevo",
        "chgrp vigia-relay /etc/vigia-relay/entorno.nuevo && chmod 640 /etc/vigia-relay/entorno.nuevo",
        "mv /etc/vigia-relay/entorno.nuevo /etc/vigia-relay/entorno",
    ]
    if con_cloudflared:
        comandos += [f"dnf install -y -q {RPM_CLOUDFLARED}", "cloudflared --version", "systemctl restart cloudflared-vigia"]
    comandos += ["systemctl restart vigia-relay", "sleep 2", "curl -s http://127.0.0.1:8080/health"]
    estado, salida, errores = en_la_instancia(i, comandos)
    print(estado, salida.strip(), errores.strip()[-500:], sep="\n")


def estado_() -> None:
    actual = instancia()
    if not actual:
        sys.exit(f"no hay instancia {NOMBRE}")
    i = actual["InstanceId"]
    print(f"instancia {i}: {actual['State']['Name']}, {actual['InstanceType']}, {actual['Placement']['AvailabilityZone']}, "
          f"IP {actual.get('PublicIpAddress')}")
    print(next((l for l in wrangler("tunnel", "list").splitlines() if TUNEL in l), f"túnel {TUNEL}: no está"))
    estado, salida, _ = en_la_instancia(i, [
        "systemctl is-active vigia-relay cloudflared-vigia | paste -sd ' '",
        "curl -s http://127.0.0.1:8080/health; echo",
        "journalctl -u vigia-relay -n 5 --no-pager -o cat"])
    print(salida.strip())


def ejecutar(comando: str) -> None:
    estado, salida, errores = en_la_instancia(instancia()["InstanceId"], [comando])
    print(estado, salida.rstrip(), errores.rstrip()[-1500:], sep="\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # la consola de Windows (cp1252) y los emojis de wrangler
    accion = sys.argv[1] if len(sys.argv) > 1 else ""
    if accion == "crear":
        crear()
    elif accion == "actualizar":
        actualizar("--cloudflared" in sys.argv)
    elif accion == "estado":
        estado_()
    elif accion == "ejecutar" and len(sys.argv) > 2:
        ejecutar(sys.argv[2])
    else:
        sys.exit(__doc__)
