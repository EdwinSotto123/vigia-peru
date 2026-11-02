#!/usr/bin/env bash
# Crea la llave con la que la API manda los correos de Gobserva por Amazon SES (alertas, recordatorios y recibos) y la
# deja como secreto de vigia-api y vigia-api-dev, con copia en SSM. Hay que correrlo con un perfil de AWS que pueda crear
# usuarios de IAM (el de operación, vigia-operador, no puede):
#
#   bash infrastructure/aws/crear_envio_ses.sh <perfil-con-permisos-de-iam>
#
# El usuario `gobserva-ses-envio` sólo puede enviar desde @gobserva.cloud (identidad SES de us-east-2, ya verificada con
# DKIM y MAIL FROM). La llave no se imprime: pasa del archivo temporal (permisos 600) a wrangler y a SSM, y se borra.
# Si el usuario ya tiene 2 llaves, AWS no deja crear otra: borra la vieja en la consola de IAM y vuelve a correrlo.
set -euo pipefail
PERFIL="${1:?uso: $0 <perfil-de-aws-con-permisos-de-iam>}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export AWS_PAGER=""
USUARIO="gobserva-ses-envio"
REGION="us-east-2"

CUENTA="$(aws sts get-caller-identity --profile "$PERFIL" --query Account --output text)"
if ! aws iam get-user --user-name "$USUARIO" --profile "$PERFIL" >/dev/null 2>&1; then
  aws iam create-user --user-name "$USUARIO" --tags Key=proyecto,Value=gobserva Key=uso,Value=enviar-correo-ses --profile "$PERFIL" >/dev/null
  echo "usuario $USUARIO creado"
fi
POLITICA="$(mktemp)"
cat > "$POLITICA" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "EnviarSoloDesdeGobserva",
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "arn:aws:ses:${REGION}:${CUENTA}:identity/gobserva.cloud",
    "Condition": { "StringLike": { "ses:FromAddress": "*@gobserva.cloud" } }
  }]
}
EOF
aws iam put-user-policy --user-name "$USUARIO" --policy-name enviar-desde-gobserva --policy-document "file://$POLITICA" --profile "$PERFIL"
rm -f "$POLITICA"

LLAVE="$(mktemp)"
chmod 600 "$LLAVE"
trap 'rm -f "$LLAVE"' EXIT
aws iam create-access-key --user-name "$USUARIO" --profile "$PERFIL" --output json > "$LLAVE"
ID="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['AccessKey']['AccessKeyId'])" "$LLAVE")"
SECRETO="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['AccessKey']['SecretAccessKey'])" "$LLAVE")"
echo "llave creada (no se muestra)"

cd "$RAIZ/backend/api"
for entorno in "" "--env dev"; do
  # shellcheck disable=SC2086
  printf '%s' "$ID" | npx --yes wrangler secret put SES_ACCESS_KEY_ID $entorno >/dev/null
  # shellcheck disable=SC2086
  printf '%s' "$SECRETO" | npx --yes wrangler secret put SES_SECRET_ACCESS_KEY $entorno >/dev/null
  echo "secretos cargados en vigia-api${entorno:+-dev}"
done
for n in access_key_id secret_access_key; do
  valor="$ID"; [[ "$n" == secret_access_key ]] && valor="$SECRETO"
  aws ssm put-parameter --name "/vigia/ses/$n" --type SecureString --overwrite --value "$valor" --region "$REGION" --profile founder.edwin >/dev/null
done
echo "copia en SSM: /vigia/ses/access_key_id y /vigia/ses/secret_access_key"
echo "Listo. Mientras SES siga en sandbox, sólo llega a direcciones @gobserva.cloud; la salida del sandbox está pedida."
