#!/usr/bin/env bash
# Deploy del orquestador ADK (Python) a Cloud Run: agent-orchestrator-adk.
#
# IMPORTANTE: usa --update-env-vars (mergea). NUNCA --set-env-vars: borra las
# ~40 variables existentes, los secretos montados y la conexión a Cloud SQL.
# Para cambiar una variable:  EXTRA_ENV="PARALLEL_RESEARCH=0" bash infrastructure/deploy/agent.sh
# La lista completa de variables está en infrastructure/README.md.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

EXTRA_ENV="${EXTRA_ENV:-}"
ENV_FLAG=()
if [[ -n "$EXTRA_ENV" ]]; then ENV_FLAG=(--update-env-vars "$EXTRA_ENV"); fi

cd "$REPO_ROOT/backend/agent"
gcloud run deploy agent-orchestrator-adk \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 8Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --max-instances "${MAX_INSTANCES:-5}" \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  "${ENV_FLAG[@]}" \
  --quiet
