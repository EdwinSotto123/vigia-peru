#!/usr/bin/env bash
# Cloud Run JOB vigia-dispatcher: procesa los contratos asignados a contribuciones pagadas
# (backend/dispatcher). Lo dispara Cloud Scheduler `vigia-dispatcher-run` cada 5 min; cada
# ejecución reclama contratos con SKIP LOCKED, así que las ejecuciones solapadas no se pisan.
#
# Enruta por tipo de contratación a los 4 servicios de agentes (infrastructure/deploy/agentes.sh):
#   AGENT_URL_BIENES=agent-orchestrator-adk · AGENT_URL_SERVICIOS=agente-servicios
#   AGENT_URL_OBRAS=agente-obras · AGENT_URL_OTROS=agente-otros
# Las URLs se leen de los servicios desplegados; se pueden forzar por env (AGENT_URL_OBRAS=…).
# Un servicio no desplegado deja su URL vacía → los contratos de ese tipo quedan pendientes.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

url_de() { gcloud run services describe "$1" --region "$REGION" --format='value(status.url)' 2>/dev/null || true; }

AGENT_URL_BIENES="${AGENT_URL_BIENES:-$(url_de agent-orchestrator-adk)}"
AGENT_URL_SERVICIOS="${AGENT_URL_SERVICIOS:-$(url_de agente-servicios)}"
AGENT_URL_OBRAS="${AGENT_URL_OBRAS:-$(url_de agente-obras)}"
AGENT_URL_OTROS="${AGENT_URL_OTROS:-$(url_de agente-otros)}"
AGENT_URL="${AGENT_URL:-$AGENT_URL_BIENES}"   # fallback histórico (solo bienes / sin clasificación)
SCHEDULER_SA="${SCHEDULER_SA:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"

echo "bienes=${AGENT_URL_BIENES:-<vacío>} servicios=${AGENT_URL_SERVICIOS:-<vacío>} obras=${AGENT_URL_OBRAS:-<vacío>} otros=${AGENT_URL_OTROS:-<vacío>}"

cd "$REPO_ROOT/backend/dispatcher"
gcloud run jobs deploy vigia-dispatcher --source . --region "$REGION" \
  --tasks 1 --max-retries 0 --task-timeout 3600 --cpu 1 --memory 512Mi \
  --set-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "AGENT_URL=${AGENT_URL},AGENT_URL_BIENES=${AGENT_URL_BIENES},AGENT_URL_SERVICIOS=${AGENT_URL_SERVICIOS},AGENT_URL_OBRAS=${AGENT_URL_OBRAS},AGENT_URL_OTROS=${AGENT_URL_OTROS},PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia,DISPATCHER_PARALLEL=${DISPATCHER_PARALLEL:-1},DISPATCHER_MAX_MINUTES=55" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest" --quiet

# Scheduler → ejecuta el job vía la API de Cloud Run (la SA necesita run.jobs.run; la de Compute ya es editor).
RUN_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/vigia-dispatcher:run"
if gcloud scheduler jobs describe vigia-dispatcher-run --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http vigia-dispatcher-run --location "$REGION" --schedule '*/5 * * * *' \
    --uri "$RUN_URI" --http-method POST --oauth-service-account-email "$SCHEDULER_SA" --quiet
else
  gcloud scheduler jobs create http vigia-dispatcher-run --location "$REGION" --schedule '*/5 * * * *' \
    --uri "$RUN_URI" --http-method POST --oauth-service-account-email "$SCHEDULER_SA" --quiet
fi
echo "✓ job vigia-dispatcher + scheduler vigia-dispatcher-run (*/5) listos"
