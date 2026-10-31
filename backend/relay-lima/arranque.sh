#!/bin/bash
# Arranque de la instancia vigia-relay-lima (user-data de EC2, corre una vez como root). Lo arma
# infrastructure/deploy/aws/relay_lima.py: este archivo con relay.py (gzip + base64) en el marcador de abajo (RELAY_PY_B64 entre dos guiones bajos dobles).
#
# Deja dos servicios:
#   vigia-relay        backend/relay-lima/relay.py en 127.0.0.1:8080, con su propio usuario sin privilegios.
#   cloudflared-vigia  el túnel `vigia-lima`: los Workers llegan al relay por Workers VPC (binding RELAY_LIMA). Sólo
#                      conexiones salientes: el grupo de seguridad no tiene ninguna regla de entrada.
# Los dos secretos (token del relay y del túnel) se leen de SSM Parameter Store (us-east-2) con el rol de la instancia y
# quedan en archivos 0600/0640; nunca en la línea de comandos ni en el registro.
set -euo pipefail
exec > >(tee -a /var/log/vigia-arranque.log) 2>&1
echo "== arranque $(date -u +%FT%TZ)"
REGION_SECRETOS=us-east-2

dnf install -y -q python3 bind-utils dnf-automatic

# cloudflared: el RPM oficial de GitHub (como en la VM de PgBouncer), sin autoactualización: lo actualiza `actualizar`.
if ! command -v cloudflared >/dev/null; then
  curl -fsSLo /tmp/cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
  dnf install -y -q /tmp/cloudflared.rpm
  rm -f /tmp/cloudflared.rpm
fi
cloudflared --version

# El relay, con su usuario.
id vigia-relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin vigia-relay
install -d -m 755 /opt/vigia-relay
echo "__RELAY_PY_B64__" | base64 -d | gunzip > /opt/vigia-relay/relay.py
chmod 644 /opt/vigia-relay/relay.py

leer() { aws ssm get-parameter --region "$REGION_SECRETOS" --name "$1" --with-decryption --query Parameter.Value --output text; }
install -d -m 750 -o root -g vigia-relay /etc/vigia-relay
umask 077
printf 'RELAY_TOKEN=%s\n' "$(leer /vigia/relay-lima/token)" > /etc/vigia-relay/entorno
chgrp vigia-relay /etc/vigia-relay/entorno && chmod 640 /etc/vigia-relay/entorno
install -d -m 700 /etc/cloudflared
printf 'TUNNEL_TOKEN=%s\n' "$(leer /vigia/relay-lima/tunel)" > /etc/cloudflared/token.env
chmod 600 /etc/cloudflared/token.env
umask 022

cat > /etc/systemd/system/vigia-relay.service <<'UNIT'
[Unit]
Description=Relay de Lima de Vigia (127.0.0.1:8080)
After=network-online.target
Wants=network-online.target
[Service]
User=vigia-relay
Group=vigia-relay
EnvironmentFile=/etc/vigia-relay/entorno
ExecStart=/usr/bin/python3 -I /opt/vigia-relay/relay.py
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/cloudflared-vigia.service <<'UNIT'
[Unit]
Description=Tunel de Cloudflare vigia-lima (Workers VPC -> relay de Lima)
After=network-online.target vigia-relay.service
Wants=network-online.target
[Service]
DynamicUser=yes
EnvironmentFile=/etc/cloudflared/token.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

# Parches de seguridad del sistema, solos (sin reiniciar: el kernel nuevo entra en el próximo arranque).
sed -i 's/^upgrade_type *=.*/upgrade_type = security/; s/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl daemon-reload
systemctl enable --now vigia-relay cloudflared-vigia dnf-automatic.timer
sleep 3
curl -s http://127.0.0.1:8080/health || true
echo
echo "== arranque terminado $(date -u +%FT%TZ)"
