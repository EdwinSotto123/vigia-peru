#!/usr/bin/env bash
# Cloud Run Jobs + Cloud Scheduler para los scrapers de backend/cloud_functions/ que responden
# desde IP de GCP (verificado con Cloud Build, ver backend/cloud_functions/README.md). Construye
# las 8 imágenes (incluye oece_ocds y onpe_claridad, que quedan listas para `docker run` en el
# VPS/laptop) pero solo agenda con Cloud Scheduler las 6 que no están bloqueadas.
#
#   bash infrastructure/deploy/cloud-scrapers.sh                    # build base + 8 imágenes + 6 jobs + 6 Cloud Scheduler
#   bash infrastructure/deploy/cloud-scrapers.sh --solo pnda_dji     # una sola fuente (build + deploy + su scheduler)
#   bash infrastructure/deploy/cloud-scrapers.sh --sin-scheduler     # build + deploy de los Jobs, sin tocar Cloud Scheduler
#   gcloud run jobs execute scraper-pnda-sancionados --region us-central1 --wait   # correr una a mano
#   gcloud scheduler jobs run scraper-pnda-sancionados --location us-central1     # disparar el cron ahora
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

AR_REPO="${AR_REPO:-us-central1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy}"
BUCKET_BATCH="${BUCKET_BATCH:-vigia-peru-batch}"
JOB_SA="${JOB_SA:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"
SHA="$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || date +%s)"

# fuente → "memoria:cpu:timeout_s:cron (America/Lima):por qué esa frecuencia" (ver backend/scrapers/README.md § Frecuencia sugerida)
declare -A CLOUD_SAFE=(
  [pnda_sancionados]="512Mi:1:600:0 8 * * 0:semanal (domingo) — el Tribunal resuelve cada semana"
  [pnda_visitas]="512Mi:1:900:0 8 1,15 * *:días 1 y 15 — la PNDA publica el mes cerrado con retraso"
  [pnda_dji]="2Gi:2:3600:0 8 5 * *:día 5 — CSV de hasta 700 MB (Contraloría)"
  [pnda_oece]="1Gi:1:1800:0 9 1 * *:mensual (día 1) — datasets pesados de la PNDA"
  [jne_infogob]="512Mi:1:600:0 8 5 * *:día 5 — el JNE republica tras cada proclamación/vacancia"
  [mef_presupuesto]="512Mi:1:900:0 8 12 * *:mensual, día 12 — devengado cerrado"
)
# Con imagen y Cloud Run Job (para correr manual / futuro), SIN Cloud Scheduler: 403 confirmado desde IP de nube.
PERU_ONLY=(oece_ocds onpe_claridad)

SOLO="" SIN_SCHEDULER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --solo) SOLO="$2"; shift 2 ;;
    --sin-scheduler) SIN_SCHEDULER=1; shift ;;
    *) echo "arg desconocido: $1 (usar --solo <fuente> | --sin-scheduler)" >&2; exit 1 ;;
  esac
done

if ! gcloud artifacts repositories describe cloud-run-source-deploy --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create cloud-run-source-deploy --repository-format=docker --location="$REGION" --quiet
fi

echo "── imagen base (código + deps, sin navegador) · ${AR_REPO}/scrapers-base:${SHA}"
CFG="$(mktemp)"; trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ['build', '-f', 'backend/cloud_functions/_base/Dockerfile', '-t', '${AR_REPO}/scrapers-base:${SHA}', '-t', '${AR_REPO}/scrapers-base:latest', '.']
images: ['${AR_REPO}/scrapers-base:${SHA}', '${AR_REPO}/scrapers-base:latest']
timeout: 600s
EOF
gcloud builds submit "$REPO_ROOT" --config "$CFG" --quiet

deploy_job() {
  local fuente="$1" image="$2" mem="$3" cpu="$4" timeout="$5"
  local job="scraper-${fuente//_/-}"
  echo "── job $job · $image"
  gcloud run jobs deploy "$job" --image "$image" --region "$REGION" \
    --service-account "$JOB_SA" --tasks 1 --max-retries 1 \
    --task-timeout "${timeout}s" --cpu "$cpu" --memory "$mem" \
    --set-cloudsql-instances "$SQL_CONNECTION" \
    --set-env-vars "PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia,SCRAPER_GCS_BUCKET=${BUCKET_BATCH}" \
    --set-secrets "PGPASSWORD=cloudsql-password:latest" --quiet
}

schedule_job() {
  local fuente="$1" cron="$2" desc="$3"
  local job="scraper-${fuente//_/-}"
  local uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${job}:run"
  echo "── Cloud Scheduler $job · \"$cron\" America/Lima · $desc"
  if gcloud scheduler jobs describe "$job" --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$job" --location "$REGION" --schedule "$cron" --time-zone "America/Lima" \
      --uri "$uri" --http-method POST --oauth-service-account-email "$JOB_SA" --quiet
  else
    gcloud scheduler jobs create http "$job" --location "$REGION" --schedule "$cron" --time-zone "America/Lima" \
      --uri "$uri" --http-method POST --oauth-service-account-email "$JOB_SA" --quiet
  fi
}

for fuente in "${!CLOUD_SAFE[@]}"; do
  [[ -n "$SOLO" && "$SOLO" != "$fuente" ]] && continue
  IFS=':' read -r MEM CPU TIMEOUT CRON DESC <<< "${CLOUD_SAFE[$fuente]}"
  IMG="${AR_REPO}/scraper-${fuente//_/-}:${SHA}"
  gcloud builds submit "backend/cloud_functions/${fuente}" --tag "$IMG" --quiet
  deploy_job "$fuente" "$IMG" "$MEM" "$CPU" "$TIMEOUT"
  [[ -z "$SIN_SCHEDULER" ]] && schedule_job "$fuente" "$CRON" "$DESC"
done

for fuente in "${PERU_ONLY[@]}"; do
  [[ -n "$SOLO" && "$SOLO" != "$fuente" ]] && continue
  IMG="${AR_REPO}/scraper-${fuente//_/-}:${SHA}"
  echo "── $fuente: 403 confirmado desde IP de nube · construyo la imagen (docker run en VPS/laptop), NO agendo Cloud Scheduler"
  if [[ "$fuente" == "onpe_claridad" ]]; then
    # Dockerfile propio (Playwright + Xvfb): necesita la raíz del repo como contexto, no solo su carpeta.
    ONPE_CFG="$(mktemp)"
    cat > "$ONPE_CFG" <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ['build', '-f', 'backend/cloud_functions/onpe_claridad/Dockerfile', '-t', '${IMG}', '.']
images: ['${IMG}']
timeout: 900s
EOF
    gcloud builds submit "$REPO_ROOT" --config "$ONPE_CFG" --quiet
    rm -f "$ONPE_CFG"
  else
    gcloud builds submit "backend/cloud_functions/${fuente}" --tag "$IMG" --quiet
  fi
  deploy_job "$fuente" "$IMG" "1Gi" "1" "1800"
done

echo "✓ listo · gcloud scheduler jobs list --location $REGION · gcloud run jobs list --region $REGION"
