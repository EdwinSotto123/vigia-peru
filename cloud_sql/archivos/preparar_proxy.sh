#!/usr/bin/env bash
# Carga en SSM Parameter Store (AWS) los secretos que necesita el proxy de base de datos:
#   /vigia/proxy/userlist       userlist.txt de PgBouncer (roles vigia_api, vigia_api_admin, vigia_mcp, vigia_dispatcher,
#                               vigia_jobs: los scrapers en Cloudflare, backend/scrapers-worker)
#   /vigia/proxy/tunnel-token   token del túnel Cloudflare `vigia-db`
# Las contraseñas salen de Secret Manager de GCP y NUNCA se imprimen. Correr ANTES de `terraform apply` del proxy.
set -euo pipefail
PROYECTO="${GCP_PROJECT:-project-a974c6e5-0cdf-4b11-a86}"
export AWS_PROFILE="${AWS_PROFILE:-founder.edwin}" AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-2}"

sec() { gcloud secrets versions access latest --secret="$1" --project="$PROYECTO"; }
put() { MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "$1" --type SecureString --overwrite --tier Advanced --value "$2" >/dev/null && echo "✓ $1"; }

USERLIST=""
for par in "vigia_api:cloudsql-password-api" "vigia_api_admin:cloudsql-password-api-admin" \
           "vigia_mcp:cloudsql-password-mcp" "vigia_dispatcher:cloudsql-password-dispatcher" \
           "vigia_jobs:cloudsql-password-jobs"; do
  USERLIST+="\"${par%%:*}\" \"$(sec "${par##*:}")\""$'\n'
done
put /vigia/proxy/userlist "$USERLIST"
put /vigia/proxy/tunnel-token "$(sec cloudflare-tunnel-token)"
