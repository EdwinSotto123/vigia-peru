#!/usr/bin/env bash
# Réplica en Cloudflare (2026-09-26): la base sigue siendo UNA sola (Cloud SQL vigia-db). Los Workers
# llegan a ella por Hyperdrive → servicio de Workers VPC → túnel `vigia-db` (cloudflared en la VM de
# PgBouncer, conexión saliente: no se abre ningún puerto en GCP) → PgBouncer (TLS) → Cloud SQL.
# Nada de GCP se apaga ni se borra.
#
#   bash infrastructure/deploy/cloudflare-base.sh tunel        # crea el túnel y guarda su token en Secret Manager
#   bash infrastructure/deploy/pgbouncer.sh actualizar          # instala/arranca cloudflared en la VM
#   bash infrastructure/deploy/cloudflare-base.sh hyperdrive   # servicio VPC + 4 Hyperdrive (api, api-admin, mcp, dispatcher)
#   bash infrastructure/deploy/cloudflare-base.sh estado       # túnel, servicio VPC e Hyperdrive
#
# Requiere `npx wrangler login` con la cuenta de Cloudflare de Vigía. Los ids de Hyperdrive no son secretos
# y van en los wrangler.jsonc; las contraseñas de los roles se leen de Secret Manager y no se imprimen.
#
# Medido 2026-09-26: consultas con parámetros, en paralelo y transacciones con SET LOCAL funcionan a
# través de PgBouncer en modo transacción. Con el Worker en Lima cada consulta tardaba ~200 ms; con
# `"placement": { "region": "gcp:us-central1" }` en el wrangler.jsonc, ~50 ms. Usar esa ubicación en
# todo Worker que consulte la base.
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-vivid-spot-480905-a4}"
TUNEL="vigia-db"
SERVICIO_VPC="vigia-pgbouncer"
wr() { npx --yes wrangler "$@"; }

id_tunel() { wr tunnel list 2>/dev/null | grep -E "\b${TUNEL}\b" | grep -oE '[0-9a-f]{8}-[0-9a-f-]{27}' | head -1; }

tunel() {
  local id; id="$(id_tunel || true)"
  if [[ -z "$id" ]]; then wr tunnel create "$TUNEL" | grep -v -i token; id="$(id_tunel)"; fi
  echo "túnel ${TUNEL}: ${id}"
  # El token sale de la API de Cloudflare directo a Secret Manager (nunca a la pantalla ni a disco).
  local cfg tok
  cfg="$(cat "${APPDATA:-$HOME/.config}/xdg.config/.wrangler/config/default.toml" 2>/dev/null || cat "$HOME/.wrangler/config/default.toml")"
  tok="$(sed -n 's/^oauth_token = "\(.*\)"/\1/p' <<<"$cfg")"
  local cuenta; cuenta="$(wr whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)"
  local datos
  datos="$(curl -fsS -H "Authorization: Bearer ${tok}" "https://api.cloudflare.com/client/v4/accounts/${cuenta}/cfd_tunnel/${id}/token" \
    | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["result"])')"
  if gcloud secrets describe cloudflare-tunnel-token --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$datos" | gcloud secrets versions add cloudflare-tunnel-token --project "$PROJECT_ID" --data-file=- >/dev/null
  else
    printf '%s' "$datos" | gcloud secrets create cloudflare-tunnel-token --project "$PROJECT_ID" --replication-policy automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding cloudflare-tunnel-token --project "$PROJECT_ID" \
    --member "serviceAccount:vigia-pgbouncer@${PROJECT_ID}.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor --quiet >/dev/null
  echo "token en Secret Manager (cloudflare-tunnel-token). Siguiente: bash infrastructure/deploy/pgbouncer.sh actualizar"
}

hyperdrive() {
  local id; id="$(id_tunel)"
  local svc
  svc="$(wr vpc service list 2>/dev/null | grep -E "\b${SERVICIO_VPC}\b" | grep -oE '[0-9a-f]{8}-[0-9a-f-]{27}' | head -1 || true)"
  if [[ -z "$svc" ]]; then
    # 127.0.0.1:6432 visto desde cloudflared = PgBouncer en la misma VM. Certificado propio: sin verificación
    # (el tráfico ya va cifrado dentro del túnel).
    wr vpc service create "$SERVICIO_VPC" --type tcp --tcp-port 6432 --app-protocol postgresql \
      --tunnel-id "$id" --ipv4 127.0.0.1 --cert-verification-mode disabled
    svc="$(wr vpc service list | grep -E "\b${SERVICIO_VPC}\b" | grep -oE '[0-9a-f]{8}-[0-9a-f-]{27}' | head -1)"
  fi
  local existentes; existentes="$(wr hyperdrive list 2>/dev/null || true)"
  crear() {  # nombre rol secreto
    if grep -q -E "\b$1\b" <<<"$existentes"; then echo "hyperdrive $1: ya existe"; return; fi
    local pw; pw="$(gcloud secrets versions access latest --secret="$3" --project "$PROJECT_ID")"
    # 5 = el mínimo de Hyperdrive; PgBouncer igual limita la base a 4 + 2 por rol.
    wr hyperdrive create "$1" --service-id "$svc" --database vigia --user "$2" --password "$pw" \
      --scheme postgresql --origin-connection-limit 5 --caching-disabled | grep -E '"id"|Created'
  }
  crear vigia-api vigia_api cloudsql-password-api
  crear vigia-api-admin vigia_api_admin cloudsql-password-api-admin
  crear vigia-mcp vigia_mcp cloudsql-password-mcp
  crear vigia-dispatcher vigia_dispatcher cloudsql-password-dispatcher
}

estado() {
  wr tunnel info "$(id_tunel)" | grep -E "Name|Status|Last Active"
  wr vpc service list
  wr hyperdrive list
}

case "${1:-}" in
  tunel) tunel ;;
  hyperdrive) hyperdrive ;;
  estado) estado ;;
  *) echo "uso: $0 tunel | hyperdrive | estado" >&2; exit 2 ;;
esac
