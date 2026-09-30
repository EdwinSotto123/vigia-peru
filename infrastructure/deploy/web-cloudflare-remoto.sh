#!/usr/bin/env bash
# Despliega vigia-web (Cloudflare) con el build pesado en Cloud Build y el deploy liviano desde la PC.
# Para cuando `npm run cf:deploy` no entra en memoria (next build pide ~3 GB) o para no tocar el
# `.next` del `next dev` de frontend/ (nunca buildear OpenNext ahí).
#
#   bash infrastructure/deploy/web-cloudflare-remoto.sh
#
# Necesita `wrangler login` (cuenta de Cloudflare) y gcloud con acceso a PROJECT_ID. Usado el 29/09/2026.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
cd "$W"

# 1. Código del commit actual + .env.production (NEXT_PUBLIC_* de Firebase, fuera de git).
# Ruta absoluta: con `git -C`, un `-o` relativo cae en el repo y no en $W (se subía solo el .env).
git -C "$REPO_ROOT" archive -o "$W/web.tar" HEAD frontend
tar -rf web.tar -C "$REPO_ROOT" frontend/.env.production
gzip web.tar

# 2. Build en Cloud Build (~10 min en E2_HIGHCPU_8); deja open-next.tgz en el bucket de migración.
SALIDA="gs://vigia-migracion-$(numero_proyecto)/web"
gcloud builds submit web.tar.gz --config "$REPO_ROOT/frontend/cloudbuild-cf.yaml" --region "$REGION" \
  --substitutions "_SALIDA=${SALIDA}"

# 3. Deploy desde una carpeta mínima: solo el adaptador y wrangler (versiones de frontend/package.json).
mkdir deploy && cd deploy
gcloud storage cp "${SALIDA}/open-next.tgz" .
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
