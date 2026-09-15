#!/usr/bin/env bash
# Cloud Run JOB vigia-ingest: ingiere en Cloud SQL los lotes que la laptop/VPS subió a
# gs://vigia-peru-batch (backend/batch/ingestar.py). Lo ejecuta batch-nocturno.sh al final de
# cada noche con `gcloud run jobs execute vigia-ingest --args=--lote,<id>`; sin args procesa
# todos los manifiestos que aún no estén `ok` en lotes_ingesta.
#
#   bash infrastructure/deploy/ingest-job.sh              # build + deploy
#   bash infrastructure/deploy/ingest-job.sh --build-only # solo `docker build` local (verificación)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

BUCKET_BATCH="${BUCKET_BATCH:-vigia-peru-batch}"
JOB_SA="${JOB_SA:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"

# ── contexto de build mínimo (ver backend/batch/Dockerfile) ─────────────────────────────
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

if [[ "${1:-}" == "--build-only" ]]; then
  docker build -t vigia-ingest:local "$CTX"
  echo "✓ imagen vigia-ingest:local construida (no se desplegó nada)"
  exit 0
fi

# ── bucket de lotes (no toca otros buckets) ─────────────────────────────────────────────
if ! gcloud storage buckets describe "gs://${BUCKET_BATCH}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET_BATCH}" --location="$REGION" --uniform-bucket-level-access
fi

# ── job ─────────────────────────────────────────────────────────────────────────────────
gcloud run jobs deploy vigia-ingest --source "$CTX" --region "$REGION" \
  --service-account "$JOB_SA" \
  --tasks 1 --max-retries 0 --task-timeout 3600 --cpu 1 --memory 1Gi \
  --set-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia,BATCH_BUCKET=${BUCKET_BATCH},BATCH_PREFIJO=batch/" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest" --quiet

echo "✓ job vigia-ingest listo · ejecutar: gcloud run jobs execute vigia-ingest --region $REGION --args=--lote,<id> --wait"
