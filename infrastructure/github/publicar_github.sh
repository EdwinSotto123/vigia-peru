#!/usr/bin/env bash
# Publica `main` en el GitHub público (EdwinSotto123/vigia-peru) SIN lo que no puede ser público:
#   · backend/scripts/ab_out$R/ y backend/scripts/dji_fixtures/golden_20.json: DNI de funcionarios, representantes y
#     familiares (entraron el 2026-10-25, salieron de main el 27).
#   · backend/scrapers-worker/dji_targets/: nombres completos de funcionarios de la DJI (el CI de GitLab los usa).
# GitLab (privado) conserva la historia entera. A GitHub va una copia reescrita desde el último commit ya publicado antes
# de esos archivos (f3ba0c5, 2026-10-24): lo anterior conserva sus SHA y el push es fast-forward. Es determinista: correrlo
# de nuevo da los mismos SHA, así que cada publicación sigue a la anterior sin forzar nada.
#
# Antes de empujar escanea lo que se publicaría (secretos y DNI) y se detiene si encuentra algo. El push directo desde el
# repo de trabajo a GitHub está desactivado a propósito (git remote set-url --push origin …): publicaría la historia sin
# filtrar. Uso: bash infrastructure/github/publicar_github.sh [--seco]
set -euo pipefail

BASE=f3ba0c5
REMOTO=https://github.com/EdwinSotto123/vigia-peru.git
RAIZ=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git clone -q --no-hardlinks --single-branch --branch main "$RAIZ" "$TMP/pub"
cat > "$TMP/filtro.sh" <<'FILTRO'
git rm -r -q --cached --ignore-unmatch -- 'backend/scripts/ab_out$R' backend/scripts/dji_fixtures/golden_20.json backend/scrapers-worker/dji_targets
FILTRO
cd "$TMP/pub"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter "sh '$TMP/filtro.sh'" --prune-empty -- "$BASE..main" >/dev/null

git merge-base --is-ancestor "$BASE" main || { echo "El commit base dejó de ser ancestro: no se publica." >&2; exit 1; }
if [ -n "$(git log --format=%h main -- 'backend/scripts/ab_out$R' backend/scripts/dji_fixtures/golden_20.json backend/scrapers-worker/dji_targets)" ]; then
  echo "Quedaron archivos excluidos en la historia: no se publica." >&2
  exit 1
fi
HALLAZGOS=$(python "$RAIZ/infrastructure/github/escanear_publicacion.py" "$TMP/pub" "$BASE" main)
if [ "$HALLAZGOS" != "sin hallazgos" ]; then
  echo "$HALLAZGOS" | grep -vE "backend/api/test/" && { echo "Hay posibles secretos o DNI: revisar antes de publicar." >&2; exit 1; } || true
fi
echo "main filtrado: $(git rev-parse --short main) ($(git rev-list --count "$BASE..main") commits sobre $BASE)"
[ "${1:-}" = "--seco" ] && { echo "En seco: no se empuja."; exit 0; }
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push "$REMOTO" main:main
