#!/usr/bin/env bash
# Entorno DEV de Vigía (docs/DEV.md): probar cambios con datos reales sin que se vean en producción.
#
#   bash infrastructure/deploy/dev.sh api            # backend/api (copia de trabajo) → vigia-api-dev
#   bash infrastructure/deploy/dev.sh web            # frontend (copia de trabajo)    → vigia-web-dev (SIN_BUILD=1: el último build)
#   bash infrastructure/deploy/dev.sh scrapers       # backend/scrapers-worker        → vigia-scrapers-dev (sin crons)
#   bash infrastructure/deploy/dev.sh todo           # los tres
#   bash infrastructure/deploy/dev.sh migrar backend/db/migrations/84_precio_item.sql
#   bash infrastructure/deploy/dev.sh sql "SELECT count(*) FROM precio_item"
#   bash infrastructure/deploy/dev.sh correr '{"fuente":"oece_ocds","seco":true}'
#   bash infrastructure/deploy/dev.sh estado | detener | encender
#   bash infrastructure/deploy/dev.sh clonar         # rehace la base DEV desde producción (~40 min; lo de DEV se pierde)
#   bash infrastructure/deploy/dev.sh base           # roles, PgBouncer e Hyperdrive de DEV (idempotente)
#   bash infrastructure/deploy/dev.sh secretos       # secretos de los Workers DEV (desde SSM /vigia/dev/)
#
# A diferencia de los deploys de producción, DEV despliega la COPIA DE TRABAJO, con lo que no está commiteado:
# es para probar antes del commit. Producción no cambia en nada.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
export AWS_PROFILE="${AWS_PROFILE:-founder.edwin}" AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-2}"
PY="${PYTHON:-python}"
AYUDA="$REPO_ROOT/infrastructure/dev/dev.py"
export PYTHONUTF8=1
wr() { npx --yes wrangler "$@"; }

web() {
  local W; W="$(mktemp -d)"
  trap 'rm -rf "$W"' RETURN
  # 1. La copia de trabajo de frontend/ (sin dependencias, builds ni secretos locales) + .env.production.
  tar -cf "$W/web.tar" -C "$REPO_ROOT" --exclude='frontend/node_modules' --exclude='frontend/.next*' \
    --exclude='frontend/.open-next' --exclude='frontend/.env.local' --exclude='frontend/.dev.vars' --exclude='frontend/.wrangler' frontend
  gzip "$W/web.tar"
  # 2. Build en Cloud Build con la API y el Turnstile de DEV. Con SIN_BUILD=1 se despliega el último build (cuando sólo
  #    cambió worker-dev.js o wrangler.jsonc: segundos en vez de ~10 min).
  local SALIDA; SALIDA="$(salida_build web-dev)"
  if [[ -z "${SIN_BUILD:-}" ]]; then
    gcb builds submit "$W/web.tar.gz" --config "$REPO_ROOT/frontend/cloudbuild-cf-dev.yaml" --region "$REGION" \
      --substitutions "_SALIDA=${SALIDA}"
  fi
  # 3. Deploy con env.dev de wrangler.jsonc (entra por worker-dev.js: clave, noindex y franja DEV).
  mkdir "$W/deploy" && cd "$W/deploy"
  gcb storage cp "${SALIDA}/open-next.tgz" .
  tar -xzf open-next.tgz
  cp "$REPO_ROOT/frontend/wrangler.jsonc" "$REPO_ROOT/frontend/open-next.config.ts" "$REPO_ROOT/frontend/worker-dev.js" .
  "$PY" - "$REPO_ROOT/frontend/package.json" <<'PY'
import json, pathlib, sys
p = json.load(open(sys.argv[1], encoding="utf-8"))
d = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
json.dump({"name": "vigia-web-dev-deploy", "private": True,
           "devDependencies": {k: d[k] for k in ("@opennextjs/cloudflare", "wrangler")}}, open("package.json", "w"))
local = pathlib.Path(".").resolve().as_posix() + "/.open-next/"
for f in (".open-next/server-functions/default/handler.mjs", ".open-next/middleware/handler.mjs"):
    h = pathlib.Path(f)
    if h.exists():
        h.write_text(h.read_text(encoding="utf-8").replace("/workspace/frontend/.open-next/", local), encoding="utf-8")
PY
  npm install --no-audit --no-fund
  npx opennextjs-cloudflare deploy --env dev
  cd "$REPO_ROOT"
}

case "${1:-}" in
  api) (cd "$REPO_ROOT/backend/api" && wr deploy --env dev) ;;
  scrapers) (cd "$REPO_ROOT/backend/scrapers-worker" && wr deploy --env dev) ;;
  web) web ;;
  todo) "$0" api && "$0" scrapers && "$0" web ;;
  base|secretos|clonar|estado|detener|encender) "$PY" "$AYUDA" "$1" ;;
  migrar|sql|correr) accion="$1"; shift; "$PY" "$AYUDA" "$accion" "$@" ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
