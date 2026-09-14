#!/usr/bin/env bash
# Deploy de la API de lectura (Hono/TS) a Cloud Run: vigia-peru-api.
# Requiere el secreto `cloudsql-password` en Secret Manager (ver terraform/secrets.tf).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# ALLOWED_ORIGINS lleva comas → se usa el delimitador alternativo `^|^` de gcloud.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000,https://vigia-peru-frontend-36169102688.us-central1.run.app,https://vigia-peru-frontend-oq3gq6a4ka-uc.a.run.app}"

cd "$REPO_ROOT/backend/api"
gcloud run deploy vigia-peru-api \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --update-env-vars "^|^PGHOST=/cloudsql/${SQL_CONNECTION}|PGUSER=postgres|PGDATABASE=vigia|FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}|GCS_PROJECT_ID=${PROJECT_ID}|GCS_BUCKET_DOCUMENTOS=${BUCKET_DOCUMENTOS}|GCS_BUCKET_REPORTES=${BUCKET_REPORTES}|ALLOWED_ORIGINS=${ALLOWED_ORIGINS}" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest,ADMIN_TOKEN=admin-token:latest" \
  --quiet
