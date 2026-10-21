#!/usr/bin/env bash
# Despliega un componente de Vigía a PRODUCCIÓN donde diga infrastructure/proveedores.env (docs/PROVEEDORES.md):
# Cloudflare/AWS (lo de hoy) o GCP (Cloud Run, con los scripts de deploy/gcp/).
#
#   bash infrastructure/deploy/desplegar.sh <componente> [argumentos del script de destino]
#   GCP_USE_API=true bash infrastructure/deploy/desplegar.sh api      # a GCP sólo esta vez
#
# Componentes: api web mcp scrapers agentes dispatcher llm precios relay r2-sync base
# DEV no pasa por aquí: bash infrastructure/deploy/dev.sh (docs/DEV.md).
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
ARCHIVO="$RAIZ/infrastructure/proveedores.env"

# El valor de una bandera: la variable de entorno si existe; si no, la del archivo.
leer() {
  local del_archivo
  del_archivo="$(grep -E "^$1=" "$ARCHIVO" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d " \"'\r")"
  printf '%s' "${!1:-$del_archivo}"
}
es_si() { [[ "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" =~ ^(1|true|si|sí|yes)$ ]]; }

comp="${1:-}"
if [[ -z "$comp" ]]; then sed -n '2,10p' "$0"; exit 2; fi
shift
clave="GCP_USE_$(printf '%s' "$comp" | tr '[:lower:]-' '[:upper:]_')"
especifico="$(leer "$clave")"
general="$(leer GCP_USE)"
if es_si "${especifico:-$general}"; then destino="gcp"; else destino="actual"; fi
echo "→ $comp: $([[ $destino == gcp ]] && echo GCP || echo "Cloudflare/AWS") ($clave=${especifico:-·}, GCP_USE=${general:-false})"

# RDS no es pública (2026-10-21): lo que corra en GCP y consulte la base necesita una IP de salida fija permitida.
aviso_base() {
  echo "  ojo: RDS no acepta conexiones de internet. Un servicio de GCP que consulte la base necesita su IP de salida fija"
  echo "  (deploy/gcp/egreso-fijo.sh) en cidrs_permitidos de cloud_sql/terraform (docs/PROVEEDORES.md, «Volver a GCP»)."
}

case "$destino:$comp" in
  actual:api|actual:mcp|actual:scrapers|actual:llm|actual:precios|actual:relay|actual:r2-sync|actual:dispatcher)
    exec bash "$AQUI/cloudflare/worker.sh" "$comp" ;;
  actual:web)        exec bash "$AQUI/cloudflare/web.sh" "$@" ;;
  actual:agentes)    exec bash "$AQUI/aws/agentes.sh" "$@" ;;
  gcp:api)           aviso_base; exec bash "$AQUI/gcp/api.sh" "$@" ;;
  gcp:web)           exec bash "$AQUI/gcp/frontend.sh" "$@" ;;
  gcp:mcp)           aviso_base; exec bash "$AQUI/gcp/mcp.sh" "$@" ;;
  gcp:scrapers)      aviso_base; exec bash "$AQUI/gcp/cloud-scrapers.sh" "$@" ;;
  gcp:agentes)       aviso_base; exec bash "$AQUI/gcp/agentes.sh" "$@" ;;
  gcp:dispatcher)    aviso_base; exec bash "$AQUI/gcp/dispatcher.sh" "$@" ;;
  *:base)
    echo "  La base no se despliega con un script: es terraform (cloud_sql/terraform, variable proveedor = aws | gcp) más una"
    echo "  migración de datos (cloud_sql/README.md). No se cambia sola."
    exit 1 ;;
  gcp:llm|gcp:precios|gcp:relay|gcp:r2-sync)
    echo "✗ $comp no tiene versión en GCP: sólo corre en Cloudflare."; exit 1 ;;
  *)
    echo "✗ componente desconocido: $comp"; sed -n '2,10p' "$0"; exit 2 ;;
esac
