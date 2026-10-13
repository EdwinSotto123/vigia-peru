#!/usr/bin/env bash
# IP de salida FIJA para Cloud Run (Cloud NAT + Direct VPC egress), para poder cerrar RDS de AWS a esa IP.
#
# Sin esto, Cloud Run sale a internet con IPs de Google que cambian y RDS tendría que estar abierto a todo el
# mundo. Con esto, TODO el tráfico de salida de los servicios/jobs elegidos sale por UNA IP reservada y el
# grupo de seguridad de RDS solo la permite a ella (cloud_sql/terraform → cidrs_permitidos).
#
#   bash infrastructure/deploy/egreso-fijo.sh crear                    # IP + router + NAT en el proyecto
#   bash infrastructure/deploy/egreso-fijo.sh ip                       # imprime la IP
#   bash infrastructure/deploy/egreso-fijo.sh aplicar svc1 svc2 …      # servicios Cloud Run por la IP fija
#   bash infrastructure/deploy/egreso-fijo.sh aplicar-job job1 job2 …  # jobs Cloud Run por la IP fija
#
# Otro proyecto: PROYECTO=vivid-spot-480905-a4 CLOUDSDK_CORE_ACCOUNT=hello@simplia.store bash …/egreso-fijo.sh crear
# Costo: ~US$4-6/mes (IP reservada + NAT) + US$0,045/GB de salida.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
PROYECTO="${PROYECTO:-$PROJECT_ID}"
RED="${RED:-default}"
IPNAME="vigia-egreso-ip"; ROUTER="vigia-router"; NAT="vigia-nat"

crear() {
  gcloud compute addresses describe "$IPNAME" --region "$REGION" --project "$PROYECTO" >/dev/null 2>&1 || \
    gcloud compute addresses create "$IPNAME" --region "$REGION" --project "$PROYECTO" --quiet
  gcloud compute routers describe "$ROUTER" --region "$REGION" --project "$PROYECTO" >/dev/null 2>&1 || \
    gcloud compute routers create "$ROUTER" --network "$RED" --region "$REGION" --project "$PROYECTO" --quiet
  gcloud compute routers nats describe "$NAT" --router "$ROUTER" --region "$REGION" --project "$PROYECTO" >/dev/null 2>&1 || \
    gcloud compute routers nats create "$NAT" --router "$ROUTER" --region "$REGION" --project "$PROYECTO" \
      --nat-external-ip-pool "$IPNAME" --nat-all-subnet-ip-ranges --quiet
  echo "IP de salida fija ($PROYECTO): $(ip)"
}
ip() { gcloud compute addresses describe "$IPNAME" --region "$REGION" --project "$PROYECTO" --format='value(address)'; }

aplicar() {
  for s in "$@"; do
    echo "▶ servicio $s"
    gcloud run services update "$s" --region "$REGION" --project "$PROYECTO" \
      --network "$RED" --subnet "$RED" --vpc-egress all-traffic --quiet 2>&1 | grep -E "ERROR|serving" || true
  done
}
aplicar_job() {
  for j in "$@"; do
    echo "▶ job $j"
    gcloud run jobs update "$j" --region "$REGION" --project "$PROYECTO" \
      --network "$RED" --subnet "$RED" --vpc-egress all-traffic --quiet 2>&1 | grep -E "ERROR|updated" || true
  done
}

case "${1:-}" in
  crear) crear ;;
  ip) ip ;;
  aplicar) shift; aplicar "$@" ;;
  aplicar-job) shift; aplicar_job "$@" ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
