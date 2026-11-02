"""Despliega (o actualiza) la Lambda vigia-gobserva-correo que manda los correos de Gobserva por SES, con el perfil del
operador (founder.edwin = vigia-operador: puede crear roles vigia*, no usuarios IAM ni llaves).

    python infrastructure/aws/correo_gobserva/desplegar.py            # crea o actualiza; el token se crea una sola vez
    python infrastructure/aws/correo_gobserva/desplegar.py --rotar    # token nuevo (y lo carga en los Workers)

El token y la URL quedan en SSM (/vigia/gobserva/correo-token, /vigia/gobserva/correo-url) y en los secretos del Worker
de la API (CORREO_TOKEN y CORREO_URL, en producción y en dev). Nunca se imprimen.
"""
import io
import json
import secrets
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-2"
NOMBRE = "vigia-gobserva-correo"
RAIZ = Path(__file__).resolve().parents[3]
API = RAIZ / "backend" / "api"
ses_ssm = boto3.Session(profile_name="founder.edwin", region_name=REGION)
iam, lam, ssm, sts = ses_ssm.client("iam"), ses_ssm.client("lambda"), ses_ssm.client("ssm"), ses_ssm.client("sts")
cuenta = sts.get_caller_identity()["Account"]

CONFIANZA = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
PERMISOS = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "EnviarSoloDesdeGobserva",
            "Effect": "Allow",
            "Action": ["ses:SendEmail", "ses:SendRawEmail"],
            "Resource": f"arn:aws:ses:{REGION}:{cuenta}:identity/*",
            "Condition": {"StringLike": {"ses:FromAddress": "*@gobserva.cloud"}},
        },
        {"Sid": "EstadoDeLaCuenta", "Effect": "Allow", "Action": ["ses:GetAccount"], "Resource": "*"},
    ],
}


def rol() -> str:
    nombre = NOMBRE
    try:
        arn = iam.get_role(RoleName=nombre)["Role"]["Arn"]
    except ClientError as e:
        if e.response["Error"]["Code"] != "NoSuchEntity":
            raise
        arn = iam.create_role(RoleName=nombre, AssumeRolePolicyDocument=json.dumps(CONFIANZA),
                              Description="Gobserva: manda correos desde @gobserva.cloud por SES (Lambda vigia-gobserva-correo)")["Role"]["Arn"]
        print("rol creado")
        time.sleep(10)  # IAM tarda en propagar un rol nuevo
    iam.put_role_policy(RoleName=nombre, PolicyName="vigia-gobserva-correo-ses", PolicyDocument=json.dumps(PERMISOS))
    iam.attach_role_policy(RoleName=nombre, PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")
    return arn


def parametro(nombre: str) -> str | None:
    try:
        return ssm.get_parameter(Name=nombre, WithDecryption=True)["Parameter"]["Value"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "ParameterNotFound":
            return None
        raise


def paquete() -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(Path(__file__).with_name("index.mjs"), "index.mjs")
    return b.getvalue()


def esperar():
    for _ in range(60):
        f = lam.get_function_configuration(FunctionName=NOMBRE)
        if f.get("State") == "Active" and f.get("LastUpdateStatus") in (None, "Successful"):
            return
        time.sleep(2)


def funcion(arn_rol: str, token: str) -> str:
    entorno = {"Variables": {"TOKEN": token, "REMITENTE": "Gobserva <alertas@gobserva.cloud>", "RESPONDER_A": "hello@gobserva.cloud"}}
    try:
        lam.get_function(FunctionName=NOMBRE)
        lam.update_function_code(FunctionName=NOMBRE, ZipFile=paquete())
        esperar()
        lam.update_function_configuration(FunctionName=NOMBRE, Environment=entorno, Timeout=15, MemorySize=256)
        print("función actualizada")
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
        for intento in range(6):  # el rol recién creado puede no estar listo para Lambda
            try:
                lam.create_function(FunctionName=NOMBRE, Runtime="nodejs22.x", Architectures=["arm64"], Role=arn_rol, Handler="index.handler",
                                    Code={"ZipFile": paquete()}, Timeout=15, MemorySize=256, Environment=entorno,
                                    Description="Gobserva: correos por SES para la API (Cloudflare)")
                break
            except ClientError as e2:
                if "role" in str(e2).lower() and intento < 5:
                    time.sleep(8)
                    continue
                raise
        print("función creada")
    esperar()
    try:
        url = lam.get_function_url_config(FunctionName=NOMBRE)["FunctionUrl"]
    except ClientError:
        url = lam.create_function_url_config(FunctionName=NOMBRE, AuthType="NONE")["FunctionUrl"]
        print("URL creada")
    for sid, accion, extra in (
        ("url-publica", "lambda:InvokeFunctionUrl", {"FunctionUrlAuthType": "NONE"}),
        ("url-invocar", "lambda:InvokeFunction", {}),
    ):
        try:
            lam.add_permission(FunctionName=NOMBRE, StatementId=sid, Action=accion, Principal="*", **extra)
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceConflictException":
                raise
    return url


def secreto_worker(nombre: str, valor: str):
    for extra in ([], ["--env", "dev"]):
        r = subprocess.run(["npx", "--yes", "wrangler", "secret", "put", nombre, *extra], cwd=API, input=valor, text=True, encoding="utf-8", errors="replace",
                           capture_output=True, shell=sys.platform == "win32")
        estado = "ok" if r.returncode == 0 else f"falló ({r.stderr.strip().splitlines()[-1][:120] if r.stderr.strip() else r.returncode})"
        print(f"secreto {nombre} {'dev' if extra else 'prod'}: {estado}")


if __name__ == "__main__":
    rotar = "--rotar" in sys.argv
    token = parametro("/vigia/gobserva/correo-token")
    nuevo = rotar or not token
    if nuevo:
        token = secrets.token_hex(32)
        ssm.put_parameter(Name="/vigia/gobserva/correo-token", Value=token, Type="SecureString", Overwrite=True,
                          Description="Gobserva: token de la Lambda de correo (CORREO_TOKEN del Worker de la API)")
    url = funcion(rol(), token)
    ssm.put_parameter(Name="/vigia/gobserva/correo-url", Value=url, Type="SecureString", Overwrite=True,
                      Description="Gobserva: URL de la Lambda de correo (CORREO_URL del Worker de la API)")
    if nuevo or "--secretos" in sys.argv:
        secreto_worker("CORREO_TOKEN", token)
        secreto_worker("CORREO_URL", url)
    print("listo")
