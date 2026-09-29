#!/usr/bin/env bash
# Variables compartidas por los scripts de deploy. Sobreescribibles por entorno:
#   PROJECT_ID=otro-proyecto bash infrastructure/deploy/agentes.sh
#
# MUDARSE A OTRO PROYECTO = cambiar PROJECT_ID acá (o exportarlo) y correr
# infrastructure/deploy/migracion/migrar-proyecto.sh (paso a paso en migracion/README.md).
# Ningún script ni el código tienen otro proyecto fijo.
set -euo pipefail

# ── Proyectos ─────────────────────────────────────────────────────────────────────────────────
# PROJECT_ID: la plataforma. Cloud SQL, agentes (Vertex AI, Document AI, RAG Engine, Vertex AI Search),
# PgBouncer + túnel de Cloudflare, scrapers, ingesta, Secret Manager. Desde el 29/09/2026: formulab.
export PROJECT_ID="${PROJECT_ID:-project-a974c6e5-0cdf-4b11-a86}"
# ENTRADA_PROJECT_ID: la entrada pública de hoy (Firebase Hosting vigia-peru.web.app → Cloud Run
# web, API y MCP), que se queda en vivid-spot hasta que el dominio propio apunte a Cloudflare.
# Con todo en un solo proyecto: ENTRADA_PROJECT_ID=$PROJECT_ID.
export ENTRADA_PROJECT_ID="${ENTRADA_PROJECT_ID:-vivid-spot-480905-a4}"
# BUCKETS_PROJECT_ID: dueño de los buckets vigia-peru-* (documentos, batch, reportes, privado). La base
# guarda sus URLs gs://, así que moverlos es copiar y reescribir esas URLs (migracion/README.md).
export BUCKETS_PROJECT_ID="${BUCKETS_PROJECT_ID:-vivid-spot-480905-a4}"
# Cuentas de gcloud (opcionales) si cada proyecto es de una cuenta distinta:
#   CUENTA=<cuenta de PROJECT_ID>  CUENTA_ENTRADA=<cuenta de ENTRADA_PROJECT_ID>
if [[ -n "${CUENTA:-}" ]]; then export CLOUDSDK_CORE_ACCOUNT="$CUENTA"; fi
export REGION="${REGION:-us-central1}"
export SQL_INSTANCE="${SQL_INSTANCE:-vigia-db}"
export SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
export BUCKET_DOCUMENTOS="${BUCKET_DOCUMENTOS:-vigia-peru-documentos}"
export BUCKET_REPORTES="${BUCKET_REPORTES:-vigia-peru-reportes}"
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-simplia-project}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# Flags (una por línea, para `mapfile`) que montan DECOLECTA_API_KEY desde Secret Manager en los
# servicios de agentes. Antes era una variable en texto plano, visible en la config del servicio.
#   · --update-secrets, NUNCA --set-secrets: --set-secrets BORRA los demás secretos montados
#     (PGPASSWORD, GOOGLE_API_KEY, PHOENIX_API_KEY, PINECONE_API_KEY).
#   · --remove-env-vars quita la variable literal vieja en el MISMO deploy: gcloud aplica primero los
#     cambios de variables y después los de secretos, así que el cambio de tipo no choca. Si ya es un
#     secreto, no hace nada (solo poda variables literales).
#   · Si el secreto `decolecta-api-key` todavía no existe, no emite nada (el servicio queda como está)
#     y avisa. Crear el secreto: ver infrastructure/README.md (Secretos).
secretos_decolecta_flags() {
  if gcloud secrets describe decolecta-api-key --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s\n' --remove-env-vars DECOLECTA_API_KEY --update-secrets DECOLECTA_API_KEY=decolecta-api-key:latest
  else
    echo "⚠ el secreto decolecta-api-key no existe: DECOLECTA_API_KEY queda como está (ver infrastructure/README.md)" >&2
  fi
}

# ¿El servicio ya pasa por PgBouncer (pgbouncer.sh conectar)? Entonces api.sh/mcp.sh no le pisan PGHOST.
en_pgbouncer() {
  gcloud_entrada run services describe "$1" --region "$REGION" --format=yaml 2>/dev/null | tr -d '\r' \
    | grep -A1 -- '- name: PG_POOLER' | grep -q 'value: pgbouncer'
}

# Proyecto por defecto de gcloud SOLO para este proceso (antes: `gcloud config set project`, que cambiaba
# el de toda la máquina). Lo de la entrada va con gcloud_entrada.
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"

# gcloud contra el proyecto de la entrada pública (y su cuenta, si es otra).
gcloud_entrada() {
  local cuenta="${CUENTA_ENTRADA:-${CLOUDSDK_CORE_ACCOUNT:-}}"
  if [[ -n "$cuenta" ]]; then
    CLOUDSDK_CORE_PROJECT="$ENTRADA_PROJECT_ID" CLOUDSDK_CORE_ACCOUNT="$cuenta" gcloud "$@"
  else
    CLOUDSDK_CORE_PROJECT="$ENTRADA_PROJECT_ID" gcloud "$@"
  fi
}

# Sufijo de las URLs de Cloud Run de PROJECT_ID: <servicio>-<número>.<región>.run.app
numero_proyecto() { gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'; }
sufijo_run() { echo "$(numero_proyecto).${REGION}.run.app"; }

# IP pública de la instancia (scripts que corren desde la PC: batch, scrapers locales).
ip_cloud_sql() { gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID" --format='value(ipAddresses[0].ipAddress)'; }
