#!/usr/bin/env bash
# Crea o actualiza la Lambda de un agente (por defecto `vigia-agente-bienes`, us-east-2, arm64) con una imagen ya
# construida en ECR `vigia-agente:<tag>`. La imagen se arma aparte (EC2 temporal con el perfil `vigia-builder`, o
# CodeBuild): este script sólo la despliega y le pone su configuración.
#
#   bash infrastructure/deploy/aws/agentes.sh <tag>               # rol de BD vigia_ab: SOLO LECTURA, para evaluar
#   ROL=agentes bash infrastructure/deploy/aws/agentes.sh <tag>   # vigia_agentes: escribe alertas y banderas (producción)
#   FUNCION=otra-lambda bash …                                     # otra función con la misma imagen
#   EXTRA_ENV_JSON=/ruta/local.json bash …                         # variables extra (p. ej. otro motor de agentes)
#
# EXTRA_ENV_JSON es un archivo LOCAL ({"VARIABLE": "valor", …}) que no se versiona: lo que no tiene que estar en el
# repo público va ahí. Los secretos salen de SSM a un JSON temporal que se borra al terminar (nunca a la pantalla).
# Con GCP_USE_AGENTES=true, desplegar.sh usa deploy/gcp/agentes.sh (Cloud Run) en vez de esto.
set -euo pipefail
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
P=(--profile "${AWS_PROFILE:-founder.edwin}" --region us-east-2)
FUNCION="${FUNCION:-vigia-agente-bienes}"
ROL="${ROL:-ab}"
TAG="${1:?uso: agentes.sh <tag de la imagen en ECR vigia-agente>}"
IMAGEN="416689419419.dkr.ecr.us-east-2.amazonaws.com/vigia-agente:${TAG}"
PY="${PY:-python}"

ssm() { aws "${P[@]}" ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text; }
ruta_aws() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }   # aws.exe en Windows quiere rutas de Windows

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(
  export PGUSER_V="vigia_$ROL" PGPASSWORD_V="$(ssm "/vigia/vigia-db/password-$ROL")" LLM_T="$(ssm /vigia/llm/token)" \
         R2_T="$(ssm /vigia/r2/lector-token)" AG_T="$(ssm /vigia/agente/token)" CH_K="$(ssm /vigia/chroma/api-key)" \
         TV_K="$(ssm /vigia/tavily/api-key)" DC_K="$(ssm /vigia/decolecta/api-key)" PR_T="$(ssm /vigia/precios/token)"
  "$PY" - "$TMP/env.json" "${EXTRA_ENV_JSON:-}" <<'PY'
import json, os, sys
e = {
    # La base por la VPC (RDS no es pública); TLS verificado con la CA de RDS que va en la imagen.
    "PGHOST": "vigia-db.c58yci0sglx8.us-east-2.rds.amazonaws.com", "PGDATABASE": "vigia",
    "PGUSER": os.environ["PGUSER_V"], "PGPASSWORD": os.environ["PGPASSWORD_V"],
    "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "/app/certs/rds-global-bundle.pem",
    "PIPELINE_PROFILE": "bienes", "DETERMINISTIC_PIPELINE": "1",
    # El modelo, por el Worker vigia-llm (su alias "respaldo"); GOOGLE_CLOUD_PROJECT=no-gcp: nada de Vertex.
    "USAR_WORKERS_AI": "1", "WORKERS_AI_URL": "https://vigia-llm.vigiaperu.workers.dev/v1", "WORKERS_AI_TOKEN": os.environ["LLM_T"],
    "WORKERS_AI_MODEL": os.environ.get("MODELO", "respaldo"), "WORKERS_AI_REASONING": "low", "WORKERS_AI_TIMEOUT_S": "150",
    "LLM_BACKEND": "compatible", "LLM_COMPAT_TIMEOUT_S": "150", "GOOGLE_CLOUD_PROJECT": "no-gcp",
    "BUSQUEDA_WEB": "propia", "BUSQUEDA_PROVEEDOR": "tavily", "TAVILY_API_KEY": os.environ["TV_K"],
    "LEGAL_RAG_BACKEND": "chroma", "CHROMA_API_KEY": os.environ["CH_K"], "CHROMA_DATABASE": "simplia-vect",
    "ALMACEN_DOCS": "r2", "R2_LECTOR_URL": "https://vigia-r2-sync.vigiaperu.workers.dev", "R2_LECTOR_TOKEN": os.environ["R2_T"],
    "PARSE_GLOBAL_BUDGET_S": "500", "MARKET_TIMEOUT_S": "240", "AGENTE_TOKEN": os.environ["AG_T"], "TARIFA_RESPALDO": "0.10,0.50",
    "DECOLECTA_API_KEY": os.environ["DC_K"], "PRECIOS_URL": "https://vigia-precios.vigiaperu.workers.dev",
    "PRECIOS_TOKEN": os.environ["PR_T"],
}
if len(sys.argv) > 2 and sys.argv[2]:
    e.update({k: str(v) for k, v in json.load(open(sys.argv[2], encoding="utf-8")).items()})
json.dump({"Variables": e}, open(sys.argv[1], "w", encoding="utf-8"))
PY
)
ENTORNO="file://$(ruta_aws "$TMP/env.json")"

if aws "${P[@]}" lambda get-function --function-name "$FUNCION" >/dev/null 2>&1; then
  aws "${P[@]}" lambda update-function-configuration --function-name "$FUNCION" --environment "$ENTORNO" --query LastUpdateStatus --output text
  aws "${P[@]}" lambda wait function-updated-v2 --function-name "$FUNCION"
  aws "${P[@]}" lambda update-function-code --function-name "$FUNCION" --image-uri "$IMAGEN" --query LastUpdateStatus --output text
else
  aws "${P[@]}" lambda create-function --function-name "$FUNCION" --package-type Image --code "ImageUri=$IMAGEN" --architectures arm64 \
    --role arn:aws:iam::416689419419:role/vigia-agente-lambda --memory-size 3008 --timeout 900 --ephemeral-storage Size=2048 \
    --vpc-config "SubnetIds=subnet-03a7bed34e5edc4be,subnet-00b0364e0d0d2ed6a,SecurityGroupIds=sg-0c7eb72133687612a" \
    --environment "$ENTORNO" --query State --output text
fi
aws "${P[@]}" lambda wait function-updated-v2 --function-name "$FUNCION" 2>/dev/null || aws "${P[@]}" lambda wait function-active-v2 --function-name "$FUNCION"

# URL pública con streaming; la protege el Bearer AGENTE_TOKEN que valida el propio agente.
if ! aws "${P[@]}" lambda get-function-url-config --function-name "$FUNCION" >/dev/null 2>&1; then
  aws "${P[@]}" lambda create-function-url-config --function-name "$FUNCION" --auth-type NONE --invoke-mode RESPONSE_STREAM --query FunctionUrl --output text
  aws "${P[@]}" lambda add-permission --function-name "$FUNCION" --statement-id url-publica --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE --output text >/dev/null
fi
aws "${P[@]}" lambda get-function-url-config --function-name "$FUNCION" --query FunctionUrl --output text
