#!/usr/bin/env bash
# Variables compartidas por los scripts de deploy. Sobreescribibles por entorno:
#   PROJECT_ID=otro-proyecto bash infrastructure/deploy/api.sh
set -euo pipefail

export PROJECT_ID="${PROJECT_ID:-vivid-spot-480905-a4}"
export REGION="${REGION:-us-central1}"
export SQL_INSTANCE="${SQL_INSTANCE:-vigia-db}"
export SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
export BUCKET_DOCUMENTOS="${BUCKET_DOCUMENTOS:-vigia-peru-documentos}"
export BUCKET_REPORTES="${BUCKET_REPORTES:-vigia-peru-reportes}"
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-simplia-project}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# Flags (una por línea, para `mapfile`) que montan DECOLECTA_API_KEY desde Secret Manager en los
# servicios de agentes. Antes era una variable en texto plano, visible en la config del servicio.
#   · --update-secrets, NUNCA --set-secrets: --set-secrets BORRA los demás secretos montados
#     (PGPASSWORD, GOOGLE_API_KEY, PHOENIX_API_KEY, PINECONE_API_KEY).
#   · --remove-env-vars quita la variable literal vieja en el MISMO deploy: gcloud aplica primero los
#     cambios de variables y después los de secretos, así que el cambio de tipo no choca. Si ya es un
#     secreto, no hace nada (solo poda variables literales).
#   · Si el secreto `decolecta-api-key` todavía no existe, no emite nada (el servicio queda como está)
#     y avisa. Crear el secreto: ver infrastructure/README.md (Secretos).
secretos_decolecta_flags() {
  if gcloud secrets describe decolecta-api-key --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s\n' --remove-env-vars DECOLECTA_API_KEY --update-secrets DECOLECTA_API_KEY=decolecta-api-key:latest
  else
    echo "⚠ el secreto decolecta-api-key no existe: DECOLECTA_API_KEY queda como está (ver infrastructure/README.md)" >&2
  fi
}

gcloud config set project "$PROJECT_ID" --quiet >/dev/null
