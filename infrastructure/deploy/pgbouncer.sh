#!/usr/bin/env bash
# PgBouncer delante de Cloud SQL para la API y el MCP (auditoría 2026-09-25, hallazgo A3).
#
# VM e2-micro `vigia-pgbouncer` (red default, us-central1-a) con dos servicios systemd:
#   · cloud-sql-proxy  → 127.0.0.1:5432 (conexión cifrada y autenticada a vigia-db con la cuenta de la VM)
#   · pgbouncer        → 0.0.0.0:6432, pool_mode=transaction
# Los usuarios de PgBouncer son los roles de la migración 37 (vigia_api, vigia_api_admin, vigia_mcp);
# sus contraseñas se leen de Secret Manager AL ARRANCAR (nunca quedan en este repo ni en los metadatos).
# Solo la subred de Cloud Run (Direct VPC egress, 10.128.0.0/20) llega al 6432; SSH solo por IAP.
#
#   bash infrastructure/deploy/pgbouncer.sh crear                 # cuenta, firewall y VM
#   bash infrastructure/deploy/pgbouncer.sh actualizar            # re-aplica el arranque en la VM viva (sin cortar conexiones)
#   bash infrastructure/deploy/pgbouncer.sh conectar api|mcp       # el servicio pasa a usar PgBouncer
#   bash infrastructure/deploy/pgbouncer.sh volver api|mcp         # REVERSIÓN: vuelve al socket de Cloud SQL
#
# Réplica en Cloudflare (2026-09-26): si existe el secreto `cloudflare-tunnel-token`, la VM corre
# también `cloudflared` (túnel saliente `vigia-db`, sin abrir puertos) y Hyperdrive llega a PgBouncer
# por un servicio de Workers VPC hacia 127.0.0.1:6432. Hyperdrive exige TLS: PgBouncer ofrece TLS
# (certificado propio) sin obligarlo (`client_tls_sslmode = allow`), así Cloud Run sigue igual.
#
# Riesgo conocido: es un punto único de falla. La VM se reinicia sola (política de mantenimiento) y
# systemd reinicia los procesos; la alerta de uptime de la API avisa si cae. `volver` deshace en 1 min.
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-vivid-spot-480905-a4}"
REGION="${REGION:-us-central1}"
ZONA="${ZONA:-us-central1-a}"
VM="vigia-pgbouncer"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:vigia-db"
SA="vigia-pgbouncer@${PROJECT_ID}.iam.gserviceaccount.com"
SUBRED_RUN="10.128.0.0/20"

script_arranque() {  # startup-script de la VM (lo usan crear y actualizar)
  cat <<SCRIPT
#!/bin/bash
set -euo pipefail
apt-get update -y && apt-get install -y pgbouncer curl
# A un temporal y con mv: al re-correr el script el binario está en uso ("text file busy").
curl -sSLo /usr/local/bin/cloud-sql-proxy.nuevo https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64
chmod +x /usr/local/bin/cloud-sql-proxy.nuevo
mv -f /usr/local/bin/cloud-sql-proxy.nuevo /usr/local/bin/cloud-sql-proxy
cat > /etc/systemd/system/cloud-sql-proxy.service <<'UNIT'
[Unit]
Description=Cloud SQL Auth Proxy
After=network-online.target
[Service]
ExecStart=/usr/local/bin/cloud-sql-proxy ${SQL_CONNECTION} --address 127.0.0.1 --port 5432
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
# Contraseñas de los roles desde Secret Manager (token de la cuenta de la VM, sin llaves en disco).
leer() { python3 - "\$1" <<'PY'
import base64, json, sys, urllib.request
md = urllib.request.Request('http://metadata/computeMetadata/v1/instance/service-accounts/default/token', headers={'Metadata-Flavor': 'Google'})
tok = json.load(urllib.request.urlopen(md))['access_token']
url = 'https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/' + sys.argv[1] + '/versions/latest:access'
r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok})))
sys.stdout.write(base64.b64decode(r['payload']['data']).decode())
PY
}
umask 077
{
  printf '"vigia_api" "%s"\n' "\$(leer cloudsql-password-api)"
  printf '"vigia_api_admin" "%s"\n' "\$(leer cloudsql-password-api-admin)"
  printf '"vigia_mcp" "%s"\n' "\$(leer cloudsql-password-mcp)"
  # vigia_dispatcher: solo para el dispatcher replicado en Cloudflare (el de Cloud Run va por socket).
  if d="\$(leer cloudsql-password-dispatcher 2>/dev/null)"; then printf '"vigia_dispatcher" "%s"\n' "\$d"; fi
} > /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt
# Certificado propio para TLS de clientes (Hyperdrive lo exige; Cloud Run sigue sin TLS).
if [ ! -s /etc/pgbouncer/tls.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=vigia-pgbouncer" \
    -keyout /etc/pgbouncer/tls.key -out /etc/pgbouncer/tls.crt 2>/dev/null
  chown postgres:postgres /etc/pgbouncer/tls.key /etc/pgbouncer/tls.crt
  chmod 600 /etc/pgbouncer/tls.key
fi
cat > /etc/pgbouncer/pgbouncer.ini <<'INI'
[databases]
vigia = host=127.0.0.1 port=5432 dbname=vigia
[pgbouncer]
; vigia-db es db-f1-micro (max_connections=40): 4 roles × (4 + 2 de reserva) = 24 conexiones como máximo.
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 400
default_pool_size = 4
reserve_pool_size = 2
reserve_pool_timeout = 3
server_idle_timeout = 120
query_wait_timeout = 15
ignore_startup_parameters = extra_float_digits,options
admin_users =
stats_users =
log_connections = 0
log_disconnections = 0
client_tls_sslmode = allow
client_tls_key_file = /etc/pgbouncer/tls.key
client_tls_cert_file = /etc/pgbouncer/tls.crt
INI
# Túnel a Cloudflare (réplica): solo si el secreto existe. El token va en un archivo 0600, no en la línea de comandos.
if tunel="\$(leer cloudflare-tunnel-token 2>/dev/null)" && [ -n "\$tunel" ]; then
  # Paquete .deb oficial (el repositorio apt de Cloudflare cambió de llave y rompía apt-get update).
  rm -f /etc/apt/sources.list.d/cloudflared.list
  if ! command -v cloudflared >/dev/null; then
    curl -fsSLo /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb && rm -f /tmp/cloudflared.deb
  fi
  install -d -m 700 /etc/cloudflared
  echo "TUNNEL_TOKEN=\$tunel" > /etc/cloudflared/token.env
  chmod 600 /etc/cloudflared/token.env
  cat > /etc/systemd/system/cloudflared-vigia.service <<'UNIT'
[Unit]
Description=Cloudflare Tunnel vigia-db (Hyperdrive via Workers VPC)
After=network-online.target pgbouncer.service
[Service]
EnvironmentFile=/etc/cloudflared/token.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
fi
systemctl daemon-reload
systemctl enable --now cloud-sql-proxy
# reload: re-lee la configuración (TLS incluido) sin cortar las conexiones de la API y el MCP.
if systemctl is-active --quiet pgbouncer; then systemctl reload pgbouncer; else systemctl restart pgbouncer; fi
systemctl enable pgbouncer
if [ -f /etc/systemd/system/cloudflared-vigia.service ]; then systemctl enable cloudflared-vigia; systemctl restart cloudflared-vigia; fi
SCRIPT
}

crear() {
  gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud iam service-accounts create vigia-pgbouncer --project "$PROJECT_ID" --display-name "Vigía: PgBouncer" --quiet
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role roles/cloudsql.client --condition=None --quiet >/dev/null
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role roles/logging.logWriter --condition=None --quiet >/dev/null
  for s in cloudsql-password-api cloudsql-password-api-admin cloudsql-password-mcp cloudsql-password-dispatcher cloudflare-tunnel-token; do
    gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" --member "serviceAccount:$SA" \
      --role roles/secretmanager.secretAccessor --quiet >/dev/null
  done

  gcloud compute firewall-rules describe vigia-pgbouncer-desde-run --project "$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud compute firewall-rules create vigia-pgbouncer-desde-run --project "$PROJECT_ID" --network default \
      --direction INGRESS --action ALLOW --rules tcp:6432 --source-ranges "$SUBRED_RUN" --target-tags vigia-pgbouncer --quiet
  # La red default abre SSH y RDP a 0.0.0.0/0 para todas las VMs: para ésta se niegan (prioridad 900)
  # y SSH queda sólo por IAP (prioridad 800).
  gcloud compute firewall-rules describe vigia-pgbouncer-sin-internet --project "$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud compute firewall-rules create vigia-pgbouncer-sin-internet --project "$PROJECT_ID" --network default \
      --direction INGRESS --action DENY --rules tcp:22,tcp:3389 --source-ranges 0.0.0.0/0 --priority 900 \
      --target-tags vigia-pgbouncer --quiet
  gcloud compute firewall-rules describe vigia-pgbouncer-ssh-iap --project "$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud compute firewall-rules create vigia-pgbouncer-ssh-iap --project "$PROJECT_ID" --network default \
      --direction INGRESS --action ALLOW --rules tcp:22 --source-ranges 35.235.240.0/20 --priority 800 --target-tags vigia-pgbouncer --quiet

  local arranque; arranque="$(mktemp)"
  script_arranque > "$arranque"
  if ! gcloud compute instances describe "$VM" --zone "$ZONA" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud compute instances create "$VM" --project "$PROJECT_ID" --zone "$ZONA" --machine-type e2-micro \
      --image-family debian-12 --image-project debian-cloud --network default --subnet default \
      --tags vigia-pgbouncer --service-account "$SA" --scopes cloud-platform \
      --maintenance-policy MIGRATE --restart-on-failure --shielded-secure-boot \
      --metadata-from-file startup-script="$arranque" --quiet
  fi
  rm -f "$arranque"
  echo "IP interna: $(gcloud compute instances describe "$VM" --zone "$ZONA" --project "$PROJECT_ID" --format='value(networkInterfaces[0].networkIP)')"
}

actualizar() {  # nuevo startup-script en la VM viva y se ejecuta ya (SSH por IAP)
  local arranque; arranque="$(mktemp)"
  script_arranque > "$arranque"
  gcloud compute instances add-metadata "$VM" --zone "$ZONA" --project "$PROJECT_ID" --metadata-from-file startup-script="$arranque" --quiet
  rm -f "$arranque"
  gcloud compute ssh "$VM" --zone "$ZONA" --project "$PROJECT_ID" --tunnel-through-iap --quiet     --command "sudo google_metadata_script_runner startup && systemctl is-active pgbouncer cloud-sql-proxy cloudflared-vigia"
}

ip_interna() { gcloud compute instances describe "$VM" --zone "$ZONA" --project "$PROJECT_ID" --format='value(networkInterfaces[0].networkIP)'; }

servicio_de() { case "$1" in api) echo vigia-peru-api ;; mcp) echo vigia-mcp ;; *) echo "componente: api|mcp" >&2; exit 2 ;; esac; }

conectar() {
  local svc; svc="$(servicio_de "$1")"
  gcloud run services update "$svc" --region "$REGION" --network default --subnet default --vpc-egress private-ranges-only \
    --update-env-vars "PGHOST=$(ip_interna),PGPORT=6432,PGSSLMODE=disable,PG_POOLER=pgbouncer" --quiet
}

volver() {
  local svc; svc="$(servicio_de "$1")"
  gcloud run services update "$svc" --region "$REGION" --clear-network \
    --update-env-vars "PGHOST=/cloudsql/${SQL_CONNECTION},PGPORT=5432,PG_POOLER=directo" --remove-env-vars PGSSLMODE --quiet
}

case "${1:-}" in
  crear) crear ;;
  actualizar) actualizar ;;
  conectar) conectar "${2:?api|mcp}" ;;
  volver) volver "${2:?api|mcp}" ;;
  *) echo "uso: $0 crear | actualizar | conectar api|mcp | volver api|mcp" >&2; exit 2 ;;
esac
