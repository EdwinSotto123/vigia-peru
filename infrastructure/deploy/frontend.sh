#!/usr/bin/env bash
# Deploy del frontend (Next.js 14) a Cloud Run: vigia-peru-frontend.
# Las variables NEXT_PUBLIC_* se leen en build desde frontend/.env.production
# (gitignored; copiá los valores de tu proyecto Firebase). Las de servidor van acá.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

API_URL="${VIGIA_API_URL:-$(gcloud run services describe vigia-peru-api --region "$REGION" --format='value(status.url)')}"
AGENT_URL="${VIGIA_AGENT_URL:-$(gcloud run services describe agent-orchestrator-adk --region "$REGION" --format='value(status.url)')}"

cd "$REPO_ROOT/frontend"
gcloud run deploy vigia-peru-frontend \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi \
  --update-env-vars "VIGIA_API_URL=${API_URL},VIGIA_AGENT_URL=${AGENT_URL},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},DOCS_BUCKET=${BUCKET_DOCUMENTOS},REPORTES_BUCKET=${BUCKET_REPORTES}" \
  --quiet
