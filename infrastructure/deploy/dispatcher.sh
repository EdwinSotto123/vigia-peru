#!/usr/bin/env bash
# Cloud Run JOB vigia-dispatcher: procesa los contratos asignados a contribuciones pagadas
# (backend/dispatcher). Lo dispara Cloud Scheduler `vigia-dispatcher-run` cada 5 min; cada
# ejecución reclama contratos con SKIP LOCKED, así que las ejecuciones solapadas no se pisan.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

AGENT_URL="${AGENT_URL:-$(gcloud run services describe agent-orchestrator-adk --region "$REGION" --format='value(status.url)')}"
SCHEDULER_SA="${SCHEDULER_SA:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"

cd "$REPO_ROOT/backend/dispatcher"
gcloud run jobs deploy vigia-dispatcher --source . --region "$REGION" \
  --tasks 1 --max-retries 0 --task-timeout 3600 --cpu 1 --memory 512Mi \
  --set-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "AGENT_URL=${AGENT_URL},PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia,DISPATCHER_PARALLEL=2,DISPATCHER_MAX_MINUTES=55" \
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
