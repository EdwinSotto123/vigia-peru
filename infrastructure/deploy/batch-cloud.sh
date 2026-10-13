#!/usr/bin/env bash
# Cloud Run JOB `vigia-batch` + Cloud Scheduler diario: baja en la nube los documentos de los contratos
# financiados (backend/batch/nube.py), sin la laptop ni el VPS de Lima (que ya no existe).
#
#   bash infrastructure/deploy/batch-cloud.sh            # imagen + job + scheduler (todos los días 02:00 Lima)
#   bash infrastructure/deploy/batch-cloud.sh --ahora    # además, una corrida ya y espera el resultado
#
# Cómo sale de GCP: la API OCDS del OECE y prod1.seace.gob.pe dan 403 a las IP de GCP, así que todo GET va
# por el Worker `vigia-relay` (backend/relay-worker, fijado en Zúrich): RELAY_URL + RELAY_TOKEN (secreto
# `local-downloader-token`, que lee la cuenta del job). Misma imagen que `vigia-ingest` (ingest-job.sh):
# solo cambia el comando.
#
# Las convocatorias NUEVAS entran por otro job diario, `scraper-oece-ocds` (backend/cloud_functions/oece_ocds).
# Este trae los documentos que alguien pidió (`pedidos_descarga`, los crea `asignar_contribucion`).
#
# Memoria 8Gi porque el disco de Cloud Run es memoria: nube.py baja en tandas de ~2 GB y las sube antes de seguir.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

BUCKET_BATCH="${BUCKET_BATCH:-vigia-peru-batch}"
JOB_SA="${JOB_SA:-vigia-jobs@${PROJECT_ID}.iam.gserviceaccount.com}"
RELAY_URL="${RELAY_URL:-https://vigia-relay.vigiaperu.workers.dev}"
HORA="${HORA:-0 2 * * *}"          # cron, America/Lima

CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/backend/scrapers"
cp -r "$REPO_ROOT/backend/batch" "$CTX/backend/batch"
cp -r "$REPO_ROOT/backend/scrapers/_core" "$CTX/backend/scrapers/_core"
cp -r "$REPO_ROOT/backend/scrapers/oece_ocds" "$CTX/backend/scrapers/oece_ocds"
cp "$REPO_ROOT/backend/scrapers/__init__.py" "$CTX/backend/scrapers/__init__.py"
[[ -d "$REPO_ROOT/backend/core" ]] && cp -r "$REPO_ROOT/backend/core" "$CTX/backend/core"
find "$CTX" -type d \( -name __pycache__ -o -name tests -o -name .pytest_cache \) -prune -exec rm -rf {} +
cp "$CTX/backend/batch/Dockerfile" "$CTX/Dockerfile"

gcloud run jobs deploy vigia-batch --source "$CTX" --region "$REGION" \
  --service-account "$JOB_SA" \
  --command python --args=-m,backend.batch.nube \
  --tasks 1 --max-retries 0 --task-timeout 10800 --cpu 2 --memory 8Gi \
  --clear-cloudsql-instances \
  --set-env-vars "PGHOST=${DB_HOST},PGSSLMODE=${DB_SSLMODE},PGUSER=vigia_jobs,PGDATABASE=vigia,BATCH_BUCKET=${BUCKET_BATCH},BATCH_PREFIJO=batch/,BATCH_DIR=/tmp/batch,RELAY_URL=${RELAY_URL},NUBE_MAX_MINUTOS=150" \
  --set-secrets "PGPASSWORD=cloudsql-password-jobs:latest,RELAY_TOKEN=local-downloader-token:latest" --quiet

# Scheduler: la cuenta del job necesita roles/run.invoker (migracion/migrar-proyecto.sh identidades).
if gcloud scheduler jobs describe vigia-batch --location "$REGION" >/dev/null 2>&1; then ACCION=update; else ACCION=create; fi
gcloud scheduler jobs "$ACCION" http vigia-batch --location "$REGION" \
  --schedule "$HORA" --time-zone "America/Lima" \
  --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/vigia-batch:run" \
  --http-method POST --oauth-service-account-email "$JOB_SA" --quiet

echo "✓ job vigia-batch + scheduler (${HORA} Lima) listos"
if [[ "${1:-}" == "--ahora" ]]; then
  gcloud run jobs execute vigia-batch --region "$REGION" --wait
fi
