#!/usr/bin/env bash
# Conveniencia para desplegar TODOS los scrapers de una — cada uno vive por completo en su
# propia carpeta (backend/cloud_functions/<fuente>/{Dockerfile,cloudbuild.yaml}): este script
# no tiene memoria/cpu/cron/lógica propia, solo llama al cloudbuild.yaml de cada carpeta.
# Para desplegar UNO SOLO, ni hace falta este script:
#
#   gcloud builds submit . --config backend/cloud_functions/pnda_sancionados/cloudbuild.yaml
#
#   bash infrastructure/deploy/cloud-scrapers.sh              # las 8 carpetas
#   bash infrastructure/deploy/cloud-scrapers.sh pnda_dji      # una sola
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
cd "$REPO_ROOT"

FUENTES=(pnda_sancionados pnda_visitas pnda_dji pnda_oece jne_infogob mef_presupuesto oece_ocds onpe_claridad)
[[ $# -gt 0 ]] && FUENTES=("$@")

for f in "${FUENTES[@]}"; do
  echo "── backend/cloud_functions/${f}"
  # Imagen, Job, Scheduler y cuenta (vigia-jobs@) salen de ${PROJECT_ID} en cada cloudbuild.yaml.
  gcloud builds submit . --project "$PROJECT_ID" --config "backend/cloud_functions/${f}/cloudbuild.yaml" --quiet
done

echo "✓ listo · gcloud scheduler jobs list --location us-central1 · gcloud run jobs list --region us-central1"
