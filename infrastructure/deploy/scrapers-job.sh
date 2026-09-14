#!/usr/bin/env bash
# Corre la ingesta diaria del OECE desde una IP peruana (la API OCDS bloquea GCP con 403).
# NO es un servicio de Cloud Run: el host es el VPS de Lima o una laptop.
#
#   VPS Lima (crontab):   0 6 * * *  /opt/vigia/infrastructure/deploy/scrapers-job.sh >> /var/log/vigia-scrapers.log 2>&1
#   Windows (Task Scheduler, Git Bash):  "C:\Program Files\Git\bin\bash.exe" -lc "/c/.../infrastructure/deploy/scrapers-job.sh"
#
# Requisitos en el host: python 3.12+ con `pip install -r backend/scrapers/requirements.txt`,
# `.cloudsql-password` en la raíz del repo (o PGPASSWORD en el entorno) y la IP pública del
# host autorizada en Cloud SQL:  gcloud sql instances patch vigia-db --authorized-networks=<IP>/32
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export PGHOST="${PGHOST:-34.71.244.66}" PGSSLMODE="${PGSSLMODE:-require}"
PY="${PYTHON:-python}"

echo "── $(date -Is) · oece_ocds (ventana por defecto: últimos 7 días de fecha de convocatoria)"
# Sin --since: el pipeline cubre hoy-7 → hoy. El release de una convocatoria sale días después
# del inicio del tenderPeriod, así que "solo ayer" dejaría huecos; el upsert es idempotente.
"$PY" -m backend.scrapers.oece_ocds.pipeline "$@"

echo "── $(date -Is) · pnda_sancionados (salta si el archivo de la PNDA no cambió)"
# No bloquea la cola si falla (p. ej. duplicados en osce_sancionados): la cola ya quedó cargada arriba.
"$PY" -m backend.scrapers.run_all --only pnda_sancionados || echo "⚠ pnda_sancionados falló; la cola OCDS sí se actualizó"

echo "── $(date -Is) · listo"
