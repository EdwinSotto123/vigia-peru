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

gcloud config set project "$PROJECT_ID" --quiet >/dev/null
