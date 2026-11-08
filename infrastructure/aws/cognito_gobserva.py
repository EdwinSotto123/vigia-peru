"""Las cuentas de cada app de Gobserva en AWS Cognito (2026-11-07): un grupo de usuarios por app, así una cuenta de
Empleo no entra a Licitaciones y el mismo correo puede tener una cuenta en cada una (Obras usa la de Licitaciones: es
una sola suscripción). Vigía y su MCP siguen con su Firebase (simplia-project).

Cada grupo: el correo es el usuario, se confirma con un código de 6 dígitos (correo en castellano con el nombre de la
app), contraseña de 8 o más, recuperación por correo, y un cliente público (la web) con USER_PASSWORD_AUTH y
refresco de 30 días, sin decir si un correo existe. Plan LITE (gratis hasta 10 mil usuarios activos al mes). Correo de
Cognito (COGNITO_DEFAULT: hasta 50 al día) mientras SES siga en sandbox.

Idempotente: crea lo que falta y actualiza los textos. Imprime los ids (públicos) que van en la web y en la API.
Uso: AWS_PROFILE=founder.edwin python infrastructure/aws/cognito_gobserva.py
"""
import json
import boto3

REGION = "us-east-2"
APPS = {
    "empleo": "Gobserva Empleo",
    "licitaciones": "Gobserva Licitaciones",
}

idp = boto3.Session(profile_name="founder.edwin", region_name=REGION).client("cognito-idp")


def mensaje(nombre: str) -> dict:
    return {
        "DefaultEmailOption": "CONFIRM_WITH_CODE",
        "EmailSubject": f"Tu código de {nombre}",
        "EmailMessage": (
            f"Hola. Tu código de {nombre} es {{####}}. Escríbelo en la página donde lo pediste: vence en 24 horas. "
            "Si no lo pediste tú, ignora este correo; nadie puede entrar sin él."
        ),
    }


def grupo(app: str, nombre: str) -> str:
    pools = idp.list_user_pools(MaxResults=60)["UserPools"]
    existente = next((p for p in pools if p["Name"] == f"gobserva-{app}"), None)
    comunes = dict(
        Policies={"PasswordPolicy": {"MinimumLength": 8, "RequireUppercase": False, "RequireLowercase": False, "RequireNumbers": False,
                                     "RequireSymbols": False, "TemporaryPasswordValidityDays": 7}},
        AutoVerifiedAttributes=["email"],
        VerificationMessageTemplate=mensaje(nombre),
        EmailConfiguration={"EmailSendingAccount": "COGNITO_DEFAULT"},
        AccountRecoverySetting={"RecoveryMechanisms": [{"Priority": 1, "Name": "verified_email"}]},
        UserAttributeUpdateSettings={"AttributesRequireVerificationBeforeUpdate": ["email"]},
        DeletionProtection="ACTIVE",
        UserPoolTags={"proyecto": "gobserva", "app": app},
    )
    if existente:
        idp.update_user_pool(UserPoolId=existente["Id"], **comunes)
        return existente["Id"]
    r = idp.create_user_pool(
        PoolName=f"gobserva-{app}",
        UsernameAttributes=["email"],
        UsernameConfiguration={"CaseSensitive": False},
        Schema=[{"Name": "email", "AttributeDataType": "String", "Required": True, "Mutable": True},
                {"Name": "name", "AttributeDataType": "String", "Required": False, "Mutable": True}],
        UserPoolTier="LITE",
        **comunes,
    )
    return r["UserPool"]["Id"]


def cliente(pool: str, app: str) -> str:
    clientes = idp.list_user_pool_clients(UserPoolId=pool, MaxResults=20)["UserPoolClients"]
    existente = next((c for c in clientes if c["ClientName"] == f"gobserva-{app}-web"), None)
    comunes = dict(
        ExplicitAuthFlows=["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
        PreventUserExistenceErrors="ENABLED",
        EnableTokenRevocation=True,
        AccessTokenValidity=60, IdTokenValidity=60, RefreshTokenValidity=30,
        TokenValidityUnits={"AccessToken": "minutes", "IdToken": "minutes", "RefreshToken": "days"},
        ReadAttributes=["email", "email_verified", "name"],
        WriteAttributes=["email", "name"],
    )
    if existente:
        idp.update_user_pool_client(UserPoolId=pool, ClientId=existente["ClientId"], ClientName=f"gobserva-{app}-web", **comunes)
        return existente["ClientId"]
    return idp.create_user_pool_client(UserPoolId=pool, ClientName=f"gobserva-{app}-web", GenerateSecret=False, **comunes)["UserPoolClient"]["ClientId"]


if __name__ == "__main__":
    salida = {}
    for app, nombre in APPS.items():
        pool = grupo(app, nombre)
        salida[app] = {"region": REGION, "pool": pool, "cliente": cliente(pool, app)}
    print(json.dumps(salida, indent=1))
    print("API (wrangler COGNITO_GOBSERVA):", ",".join(f"{a}|{v['pool']}|{v['cliente']}" for a, v in salida.items()))
