#!/usr/bin/env bash
# Una cuenta de servicio por componente, con permisos mínimos (auditoría 2026-09-25, hallazgo A8).
#
# Hoy todo corre con la cuenta de Compute por defecto (36169102688-compute@), que tiene `editor`,
# `run.admin` y acceso a TODOS los secretos del proyecto, y la comparten ~45 servicios de otros
# productos. Este script CREA las cuentas y sus permisos (idempotente); NO cambia ningún servicio.
# El cambio de cada servicio/job va aparte, uno por uno y verificando (ver `cambiar_*` al final,
# o `bash infrastructure/deploy/cuentas-servicio.sh cambiar <componente>`).
#
#   bash infrastructure/deploy/cuentas-servicio.sh crear
#   bash infrastructure/deploy/cuentas-servicio.sh cambiar api|frontend|mcp|dispatcher|jobs|scheduler
#
# Los agentes de IA (agent-orchestrator-adk, agente-*) siguen con la cuenta por defecto: necesitan
# Vertex, Document AI y más; quedan para una etapa aparte.
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-vivid-spot-480905-a4}"
REGION="${REGION:-us-central1}"
AGENTES=(agent-orchestrator-adk agente-servicios agente-obras agente-otros)
JOBS_DATOS=(vigia-ingest scraper-jne-infogob scraper-mef-presupuesto scraper-oece-ocds scraper-onpe-claridad
            scraper-pnda-dji scraper-pnda-oece scraper-pnda-sancionados scraper-pnda-visitas)
# Secreto de la base por componente (roles de la migración 37); la API usa dos (público y panel).
SECRETO_DB_API="${SECRETO_DB_API:-cloudsql-password-api}"
SECRETO_DB_API_ADMIN="${SECRETO_DB_API_ADMIN:-cloudsql-password-api-admin}"
SECRETO_DB_MCP="${SECRETO_DB_MCP:-cloudsql-password-mcp}"
SECRETO_DB_DISPATCHER="${SECRETO_DB_DISPATCHER:-cloudsql-password-dispatcher}"
SECRETO_DB_JOBS="${SECRETO_DB_JOBS:-cloudsql-password-jobs}"

sa() { echo "vigia-$1@${PROJECT_ID}.iam.gserviceaccount.com"; }

crear_sa() {
  local nombre="$1" descripcion="$2"
  if ! gcloud iam service-accounts describe "$(sa "$nombre")" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "vigia-$nombre" --project "$PROJECT_ID" --display-name "Vigía: $descripcion" --quiet
  fi
}
proyecto() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(sa "$1")" --role "$2" --condition=None --quiet >/dev/null; }
secreto() { gcloud secrets add-iam-policy-binding "$2" --project "$PROJECT_ID" --member "serviceAccount:$(sa "$1")" --role roles/secretmanager.secretAccessor --quiet >/dev/null; }
bucket() { gcloud storage buckets add-iam-policy-binding "gs://$2" --member "serviceAccount:$(sa "$1")" --role "$3" --quiet >/dev/null; }
invocar_servicio() { gcloud run services add-iam-policy-binding "$2" --region "$REGION" --member "serviceAccount:$(sa "$1")" --role roles/run.invoker --quiet >/dev/null; }
ejecutar_job() { gcloud run jobs add-iam-policy-binding "$2" --region "$REGION" --member "serviceAccount:$(sa "$1")" --role roles/run.invoker --quiet >/dev/null; }

crear() {
  # API pública (Hono): base, sus 2 secretos, leer comprobantes (privado) y documentos para firmar URLs,
  # firmar URLs sin llave (signBlob sobre sí misma), lanzar el dispatcher desde el panel y trazas.
  crear_sa api "API pública"
  proyecto api roles/cloudsql.client
  proyecto api roles/cloudtrace.agent
  secreto api admin-token; secreto api "$SECRETO_DB_API"; secreto api "$SECRETO_DB_API_ADMIN"
  bucket api vigia-peru-privado roles/storage.objectViewer
  bucket api vigia-peru-documentos roles/storage.objectViewer
  # signReadUrl: vista previa de los documentos del SEACE guardados en el bucket de lotes.
  bucket api vigia-peru-batch roles/storage.objectViewer
  gcloud iam service-accounts add-iam-policy-binding "$(sa api)" --project "$PROJECT_ID" \
    --member "serviceAccount:$(sa api)" --role roles/iam.serviceAccountTokenCreator --quiet >/dev/null
  ejecutar_job api vigia-dispatcher
  for s in "${AGENTES[@]}"; do invocar_servicio api "$s"; done

  # Frontend (Next): sus 3 secretos del panel, subir fotos/logos (público) y comprobantes/adjuntos
  # privados, e invocar a los agentes desde /api/agent/* (solo el equipo).
  crear_sa frontend "frontend"
  proyecto frontend roles/cloudtrace.agent
  secreto frontend admin-token; secreto frontend admin-session-secret; secreto frontend admin-emails
  bucket frontend vigia-peru-reportes roles/storage.objectCreator
  bucket frontend vigia-peru-privado roles/storage.objectCreator
  # /api/agent/analyze y upload-doc (sólo el equipo): suben documentos y reescriben su caché JSON.
  bucket frontend vigia-peru-documentos roles/storage.objectUser
  for s in "${AGENTES[@]}"; do invocar_servicio frontend "$s"; done

  # MCP: solo lectura de la base.
  crear_sa mcp "servidor MCP"
  proyecto mcp roles/cloudsql.client
  secreto mcp "$SECRETO_DB_MCP"

  # Dispatcher: base e invocar a los 4 servicios de agentes.
  crear_sa dispatcher "dispatcher de la cola"
  proyecto dispatcher roles/cloudsql.client
  secreto dispatcher "$SECRETO_DB_DISPATCHER"
  for s in "${AGENTES[@]}"; do invocar_servicio dispatcher "$s"; done

  # Jobs de datos (scrapers e ingesta): base y el bucket de lotes/crudos.
  crear_sa jobs "jobs de datos"
  proyecto jobs roles/cloudsql.client
  secreto jobs "$SECRETO_DB_JOBS"
  bucket jobs vigia-peru-batch roles/storage.objectAdmin

  # Cloud Scheduler: solo ejecutar los jobs que dispara.
  crear_sa scheduler "Cloud Scheduler"
  for j in vigia-dispatcher "${JOBS_DATOS[@]}"; do ejecutar_job scheduler "$j" 2>/dev/null || true; done
  echo "✓ cuentas creadas y permisos aplicados (ningún servicio cambió todavía)"
}

cambiar() {
  case "$1" in
    api)        gcloud run services update vigia-peru-api --region "$REGION" --service-account "$(sa api)" --quiet ;;
    frontend)   gcloud run services update vigia-peru-frontend --region "$REGION" --service-account "$(sa frontend)" --quiet ;;
    mcp)        gcloud run services update vigia-mcp --region "$REGION" --service-account "$(sa mcp)" --quiet ;;
    dispatcher) gcloud run jobs update vigia-dispatcher --region "$REGION" --service-account "$(sa dispatcher)" --quiet ;;
    jobs)       for j in "${JOBS_DATOS[@]}"; do gcloud run jobs update "$j" --region "$REGION" --service-account "$(sa jobs)" --quiet || true; done ;;
    scheduler)
      # tr -d '\r': gcloud en Windows termina las líneas con CRLF.
      for j in $(gcloud scheduler jobs list --location "$REGION" --format='value(name.basename())' | tr -d '\r'); do
        uri="$(gcloud scheduler jobs describe "$j" --location "$REGION" --format='value(httpTarget.uri)' | tr -d '\r')"
        # Solo los que ejecutan jobs de Cloud Run con OAuth; el de /admin/asignar va con su propio encabezado.
        if [[ "$uri" == https://run.googleapis.com/* ]]; then
          gcloud scheduler jobs update http "$j" --location "$REGION" --oauth-service-account-email "$(sa scheduler)" --quiet
        fi
      done ;;
    *) echo "componente desconocido: $1" >&2; exit 2 ;;
  esac
}

case "${1:-}" in
  crear) crear ;;
  cambiar) cambiar "${2:?falta el componente}" ;;
  *) echo "uso: $0 crear | cambiar api|frontend|mcp|dispatcher|jobs|scheduler" >&2; exit 2 ;;
esac
