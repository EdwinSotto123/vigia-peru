#!/usr/bin/env bash
# Deploy de la API de lectura (Hono/TS) a Cloud Run: vigia-peru-api.
# Roles de la migración 37: `vigia_api` (rutas públicas) y `vigia_api_admin` (panel), cada uno con su
# secreto (`cloudsql-password-api`, `cloudsql-password-api-admin`). Volver atrás: PGUSER=postgres.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# ALLOWED_ORIGINS lleva comas → se usa el delimitador alternativo `^|^` de gcloud.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000,https://vigia-peru-frontend-36169102688.us-central1.run.app,https://vigia-peru-frontend-oq3gq6a4ka-uc.a.run.app}"

# Detrás de PgBouncer (pgbouncer.sh conectar api) la conexión es de ese script: acá no se toca.
CONEXION="PGHOST=/cloudsql/${SQL_CONNECTION}|"
en_pgbouncer vigia-peru-api && CONEXION=""

cd "$REPO_ROOT/backend/api"
gcloud run deploy vigia-peru-api \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --update-env-vars "^|^${CONEXION}PGUSER=vigia_api|PGUSER_ADMIN=vigia_api_admin|PGDATABASE=vigia|FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}|GCS_PROJECT_ID=${PROJECT_ID}|GCS_BUCKET_DOCUMENTOS=${BUCKET_DOCUMENTOS}|GCS_BUCKET_REPORTES=${BUCKET_REPORTES}|ALLOWED_ORIGINS=${ALLOWED_ORIGINS}|LOCAL_DOWNLOADER_URL=${LOCAL_DOWNLOADER_URL:-http://149.104.66.211:8080}" \
  --set-secrets "PGPASSWORD=cloudsql-password-api:latest,PGPASSWORD_ADMIN=cloudsql-password-api-admin:latest,ADMIN_TOKEN=admin-token:latest" \
  --quiet
