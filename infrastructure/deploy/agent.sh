#!/usr/bin/env bash
# Deploy del orquestador ADK (Python) a Cloud Run: agent-orchestrator-adk = servicio de BIENES.
#
# Hay CUATRO servicios de agentes con el mismo código y distinto PIPELINE_PROFILE
# (bienes/servicios/obras/otros): para desplegarlos todos (o uno) con una sola imagen
# usá `bash infrastructure/deploy/agentes.sh [all|bienes|servicios|obras|otros]`.
# Este script conserva el camino histórico `--source` (buildpack/Dockerfile) SOLO para bienes.
#
# IMPORTANTE: usa --update-env-vars (mergea). NUNCA --set-env-vars: borra las
# ~40 variables existentes, los secretos montados y la conexión a Cloud SQL.
# Para cambiar una variable:  EXTRA_ENV="PARALLEL_RESEARCH=0" bash infrastructure/deploy/agent.sh
# La lista completa de variables está en infrastructure/README.md.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.6-flash}"
GEMINI_MODEL_SMART="${GEMINI_MODEL_SMART:-gemini-3.6-flash}"
GEMINI_MODEL_FAST="${GEMINI_MODEL_FAST:-gemini-3.5-flash-lite}"
GEMINI_MODEL_JUDGE="${GEMINI_MODEL_JUDGE:-gemini-3.5-flash}"
ENV_VARS="PIPELINE_PROFILE=bienes,GEMINI_MODEL=${GEMINI_MODEL},GEMINI_MODEL_SMART=${GEMINI_MODEL_SMART},GEMINI_MODEL_FAST=${GEMINI_MODEL_FAST},GEMINI_MODEL_JUDGE=${GEMINI_MODEL_JUDGE}"
EXTRA_ENV="${EXTRA_ENV:-}"
if [[ -n "$EXTRA_ENV" ]]; then ENV_VARS="${ENV_VARS},${EXTRA_ENV}"; fi

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
  --update-env-vars "$ENV_VARS" \
  --quiet
