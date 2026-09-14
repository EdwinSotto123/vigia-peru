#!/usr/bin/env bash
# Deploy del servidor MCP (read-only sobre Cloud SQL) a Cloud Run: vigia-mcp.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$REPO_ROOT/backend/mcp"
gcloud run deploy vigia-mcp \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --update-env-vars "PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest" \
  --quiet
