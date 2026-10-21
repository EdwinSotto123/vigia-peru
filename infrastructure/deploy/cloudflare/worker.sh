#!/usr/bin/env bash
# Despliega UN Worker de Cloudflare a PRODUCCIÓN. Como la web (cloudflare/web.sh, que empaqueta el último commit), sólo
# sale lo commiteado: si la carpeta del Worker tiene cambios sin commitear, se niega. DEV, en cambio, despliega la copia
# de trabajo (deploy/dev.sh).
#
#   bash infrastructure/deploy/cloudflare/worker.sh api|mcp|scrapers|llm|precios|relay|r2-sync|dispatcher
#
# La API va por versiones (sube, activa al 100 % y deja la anterior para volver con
# `npx wrangler versions deploy <id>@100% -y` en backend/api).
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

declare -A CARPETA=(
  [api]=backend/api [mcp]=backend/mcp-worker [scrapers]=backend/scrapers-worker [llm]=backend/llm-worker
  [precios]=backend/precios-worker [relay]=backend/relay-worker [r2-sync]=backend/r2-sync-worker
  [dispatcher]=backend/dispatcher-worker
)
nombre="${1:-}"
carpeta="${CARPETA[$nombre]:-}"
if [[ -z "$carpeta" ]]; then echo "uso: $0 ${!CARPETA[*]}"; exit 2; fi

if [[ -n "$(git -C "$RAIZ" status --porcelain -- "$carpeta")" ]]; then
  echo "✗ $carpeta tiene cambios sin commitear. Pruébalos en DEV (deploy/dev.sh) y commitea antes de producción."
  exit 1
fi

cd "$RAIZ/$carpeta"
echo "→ $carpeta ($(git -C "$RAIZ" log -1 --format='%h %s' -- .))"
if [[ "$nombre" == "api" ]]; then
  version="$(npx --yes wrangler versions upload | tee /dev/stderr | awk '/Worker Version ID/ {print $4}')"
  [[ -n "$version" ]] || { echo "✗ no se pudo subir la versión"; exit 1; }
  npx --yes wrangler versions deploy "${version}@100%" -y
else
  npx --yes wrangler deploy
fi
