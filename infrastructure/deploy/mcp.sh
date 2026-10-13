#!/usr/bin/env bash
# Deploy del servidor MCP (read-only sobre Cloud SQL) a Cloud Run: vigia-mcp.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Detrás de PgBouncer (pgbouncer.sh conectar mcp) la conexión es de ese script: acá no se toca.
CONEXION="PGHOST=${DB_HOST},PGSSLMODE=no-verify,"
en_pgbouncer vigia-mcp && CONEXION=""

cd "$REPO_ROOT/backend/mcp"
gcloud_entrada run deploy vigia-mcp \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --clear-cloudsql-instances \
  --update-env-vars "${CONEXION}PGUSER=vigia_mcp,PGDATABASE=vigia" \
  --set-secrets "PGPASSWORD=cloudsql-password-mcp:latest" \
  --quiet
