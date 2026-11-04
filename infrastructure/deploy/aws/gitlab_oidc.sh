#!/usr/bin/env bash
# Una sola vez, con una cuenta que pueda crear en IAM (vigia-operador y terraform-deployer no pueden):
#
#   AWS_PROFILE=<perfil admin> bash infrastructure/deploy/aws/gitlab_oidc.sh
#
# Crea el proveedor OIDC de gitlab.com y el rol `vigia-gitlab-agentes`, que sólo puede asumir un pipeline de la rama
# `main` de simplia-group/vigia-peru (sin llaves guardadas en GitLab). Permisos mínimos: subir imágenes al repositorio
# ECR `vigia-agente` y actualizar el código de las Lambdas `vigia-agente-*`. Lo usan los jobs build:agente y
# deploy:agentes:prod de .gitlab-ci.yml. Se puede correr de nuevo: no duplica nada.
set -euo pipefail
export MSYS_NO_PATHCONV=1
CUENTA=416689419419
ROL=vigia-gitlab-agentes
P=(--profile "${AWS_PROFILE:?pon AWS_PROFILE con un perfil que pueda crear en IAM}")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PROVEEDOR="arn:aws:iam::${CUENTA}:oidc-provider/gitlab.com"
if ! aws "${P[@]}" iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVEEDOR" >/dev/null 2>&1; then
  # Huella de la raíz de la cadena de gitlab.com (Sectigo Public Server Authentication Root R46).
  aws "${P[@]}" iam create-open-id-connect-provider --url https://gitlab.com --client-id-list https://gitlab.com \
    --thumbprint-list 2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f --query OpenIDConnectProviderArn --output text
fi

cat > "$TMP/confianza.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "${PROVEEDOR}"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"gitlab.com:aud": "https://gitlab.com"},
      "StringLike": {"gitlab.com:sub": "project_path:simplia-group/vigia-peru:ref_type:branch:ref:main"}
    }
  }]
}
EOF
cat > "$TMP/permisos.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "EcrLogin", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
    {"Sid": "EcrAgente", "Effect": "Allow",
     "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages"],
     "Resource": "arn:aws:ecr:us-east-2:${CUENTA}:repository/vigia-agente"},
    {"Sid": "LambdaAgentes", "Effect": "Allow",
     "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"],
     "Resource": "arn:aws:lambda:us-east-2:${CUENTA}:function:vigia-agente-*"}
  ]
}
EOF
ruta() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
if aws "${P[@]}" iam get-role --role-name "$ROL" >/dev/null 2>&1; then
  aws "${P[@]}" iam update-assume-role-policy --role-name "$ROL" --policy-document "file://$(ruta "$TMP/confianza.json")"
else
  aws "${P[@]}" iam create-role --role-name "$ROL" --assume-role-policy-document "file://$(ruta "$TMP/confianza.json")" \
    --description "GitLab CI (simplia-group/vigia-peru, main): imagen y despliegue de las Lambdas de agentes" \
    --query Role.Arn --output text
fi
aws "${P[@]}" iam put-role-policy --role-name "$ROL" --policy-name agentes --policy-document "file://$(ruta "$TMP/permisos.json")"
echo "listo: arn:aws:iam::${CUENTA}:role/${ROL}"
