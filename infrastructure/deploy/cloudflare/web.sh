#!/usr/bin/env bash
# Despliega vigia-web (Cloudflare).
#
#   bash infrastructure/deploy/cloudflare/web.sh          # build LOCAL en la PC (por defecto)
#   USAR_CLOUD_BUILD=1 bash .../web.sh                    # build pesado en GCP Cloud Build (sólo si GCP revive)
#
# Por defecto NO usa GCP: GCP está sin facturación desde 2026-10-12 y Cloud Build muere con
# "quota restrictions… billing". El build local corre `npm run cf:build` (OpenNext, pide ~3 GB RAM) en
# `frontend/` y despliega con `opennextjs-cloudflare deploy`. OJO: comparte `frontend/.next` con un
# `next dev`, así que NO correrlo con un dev server activo (hay una guardia que aborta si lo detecta).
# Necesita `wrangler login`. El binding VIGIA_API_URL (→ Worker vigia-api) ya está en el Worker.
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"

if [[ "${USAR_CLOUD_BUILD:-0}" != "1" ]]; then
  # ── Build LOCAL (por defecto, sin GCP) ──────────────────────────────────────────────────────────
  FRONT="$REPO_ROOT/frontend"
  # Guardia: no pisar un `next dev` activo (comparten .next). Best-effort por puertos conocidos.
  if command -v netstat >/dev/null 2>&1; then
    for p in 3000 3001 3300 3400; do
      if netstat -ano 2>/dev/null | grep -i listen | grep -qE "[:.]$p\b"; then
        echo "✗ hay algo escuchando en el puerto $p: parece un 'next dev' (comparte frontend/.next)." >&2
        echo "  Ciérralo y reintenta, o fuerza el camino viejo con USAR_CLOUD_BUILD=1." >&2
        exit 1
      fi
    done
  fi
  echo "→ build local de OpenNext en $FRONT (sin Cloud Build)"
  cd "$FRONT"
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" npm run cf:build
  npx opennextjs-cloudflare deploy
  exit 0
fi

# ── Build en GCP Cloud Build (opt-in: USAR_CLOUD_BUILD=1; sólo si GCP revive) ──────────────────────
# El build pesado en Cloud Build y el deploy liviano desde la PC. Necesita gcloud con acceso a BUILD_PROJECT_ID.
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
cd "$W"

# 1. Código del commit actual + .env.production (NEXT_PUBLIC_* de Firebase, fuera de git).
# Ruta absoluta: con `git -C`, un `-o` relativo cae en el repo y no en $W (se subía solo el .env).
git -C "$REPO_ROOT" archive -o "$W/web.tar" HEAD frontend
tar -rf web.tar -C "$REPO_ROOT" frontend/.env.production
gzip web.tar

# 2. Build en Cloud Build (~10 min en E2_HIGHCPU_8); deja open-next.tgz en el bucket de migración.
SALIDA="$(salida_build web)"
gcb builds submit web.tar.gz --config "${CONFIG_BUILD:-$REPO_ROOT/frontend/cloudbuild-cf.yaml}" --region "$REGION" \
  --substitutions "_SALIDA=${SALIDA}"

# 3. Deploy desde una carpeta mínima: solo el adaptador y wrangler (versiones de frontend/package.json).
mkdir deploy && cd deploy
gcb storage cp "${SALIDA}/open-next.tgz" .
tar -xzf open-next.tgz
cp "$REPO_ROOT/frontend/wrangler.jsonc" "$REPO_ROOT/frontend/open-next.config.ts" .
"${PYTHON:-python}" - "$REPO_ROOT/frontend/package.json" <<'PY'
import json, pathlib, sys
p = json.load(open(sys.argv[1], encoding="utf-8"))
d = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
json.dump({"name": "vigia-web-deploy", "private": True,
           "devDependencies": {k: d[k] for k in ("@opennextjs/cloudflare", "wrangler")}}, open("package.json", "w"))
# El build importa .wasm/.bin con la ruta absoluta de Cloud Build (/workspace/frontend/...):
# se reescribe a esta carpeta o wrangler no los encuentra al empaquetar.
local = pathlib.Path(".").resolve().as_posix() + "/.open-next/"
for f in (".open-next/server-functions/default/handler.mjs", ".open-next/middleware/handler.mjs"):
    h = pathlib.Path(f)
    if h.exists():
        h.write_text(h.read_text(encoding="utf-8").replace("/workspace/frontend/.open-next/", local), encoding="utf-8")
PY
npm install --no-audit --no-fund
npx opennextjs-cloudflare deploy
