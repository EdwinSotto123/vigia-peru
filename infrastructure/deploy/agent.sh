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

# DECOLECTA_API_KEY (SUNAT) sale de Secret Manager — antes era una variable en texto plano, visible
# en la configuración del servicio. Ver secretos_decolecta_flags en _common.sh.
mapfile -t SECRET_FLAGS < <(secretos_decolecta_flags)

# Sin --allow-unauthenticated: en un servicio existente, `gcloud run deploy` sin ese flag NO toca la
# política IAM. Así un deploy no vuelve a abrir el orquestador a allUsers después de pasarlo a
# IAM-only (lo invocan con ID token: frontend /api/agent/*, API /admin/operacion y el dispatcher).
cd "$REPO_ROOT/backend/agent"
gcloud run deploy agent-orchestrator-adk \
  --source . \
  --region "$REGION" \
  --memory 8Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --max-instances "${MAX_INSTANCES:-5}" \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --update-env-vars "$ENV_VARS" \
  "${SECRET_FLAGS[@]}" \
  --quiet
