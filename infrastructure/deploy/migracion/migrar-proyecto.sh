#!/usr/bin/env bash
# Mudanza de la plataforma de Vigía (base + IA + agentes + PgBouncer + scrapers) a otro proyecto de GCP.
# Es la receta que se usó el 29/09/2026 (vivid-spot → formulab), escrita para repetirla cambiando dos
# variables. Paso a paso, tiempos y trampas: README.md de esta carpeta.
#
#   ORIGEN=<proyecto-actual> DESTINO=<proyecto-nuevo> bash infrastructure/deploy/migracion/migrar-proyecto.sh <fase>
#
# Fases, en orden (cada una se puede repetir; la de la base BORRA la base del destino):
#   apis         habilita las APIs en el destino
#   identidades  agentes de servicio de Vertex, cuentas vigia-agentes / vigia-jobs y sus roles
#   secretos     copia los secretos (sin imprimirlos)
#   base         instancia Cloud SQL, roles, export del origen, import, dueños/permisos, contraseñas, comparación
#   ia           Document AI, RAG Engine (bucket, catálogo, 4 corpus, import) y Vertex AI Search
#   agentes      imagen + los 4 servicios de agentes + quién los puede invocar
#   pgbouncer    VM con PgBouncer, proxy a la base nueva y túnel de Cloudflare
#   jobs         8 scrapers (con sus Schedulers) e ingesta
#   corte        imprime los comandos del corte (producción: se corren a mano, en orden)
#
# Opcionales: CUENTA_ORIGEN / CUENTA_DESTINO (si son cuentas de gcloud distintas), REGION (us-central1),
# TIER (db-f1-micro), MI_IP (IP autorizada en la base; por defecto la pública actual).
set -euo pipefail
: "${ORIGEN:?ORIGEN=<proyecto actual>}" "${DESTINO:?DESTINO=<proyecto nuevo>}"
REGION="${REGION:-us-central1}"
TIER="${TIER:-db-custom-1-3840}"   # f1-micro (0,6 GB) no aguanta varios análisis a la vez
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
PY="${PYTHON:-python}"
HERR="$PY $AQUI/herramientas.py"

co() { if [[ -n "${CUENTA_ORIGEN:-}" ]]; then gcloud --account "$CUENTA_ORIGEN" --project "$ORIGEN" "$@"; else gcloud --project "$ORIGEN" "$@"; fi; }
cd_() { if [[ -n "${CUENTA_DESTINO:-}" ]]; then gcloud --account "$CUENTA_DESTINO" --project "$DESTINO" "$@"; else gcloud --project "$DESTINO" "$@"; fi; }
cuentas() { echo ${CUENTA_ORIGEN:+--cuenta-origen "$CUENTA_ORIGEN"} ${CUENTA_DESTINO:+--cuenta-destino "$CUENTA_DESTINO"}; }
num() { cd_ projects describe "$DESTINO" --format='value(projectNumber)'; }
rol() {
  if cd_ projects add-iam-policy-binding "$DESTINO" --member "$1" --role "$2" --condition=None --quiet >/dev/null 2>&1; then
    echo "  ✓ $2 → ${1#*:}"
  else
    echo "  ✗ $2 → ${1#*:} (¿la cuenta todavía no existe?)"
  fi
}
secreto() { cd_ secrets versions access latest --secret "$1" 2>/dev/null; }

apis() {
  cd_ services enable sqladmin.googleapis.com aiplatform.googleapis.com documentai.googleapis.com \
    discoveryengine.googleapis.com vectorsearch.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com compute.googleapis.com iam.googleapis.com \
    iamcredentials.googleapis.com cloudscheduler.googleapis.com orgpolicy.googleapis.com
}

identidades() {
  local n; n="$(num)"
  # Un proyecto nuevo no trae los agentes de servicio de Vertex: sin ellos RAG Engine no crea corpus.
  for s in aiplatform.googleapis.com vectorsearch.googleapis.com discoveryengine.googleapis.com documentai.googleapis.com; do
    cd_ beta services identity create --service="$s" >/dev/null 2>&1 || true
  done
  # El de RAG Engine (gcp-sa-vertex-rag) recién existe tras el primer uso de RAG: su rol, en la fase ia.
  rol "serviceAccount:service-$n@gcp-sa-aiplatform.iam.gserviceaccount.com" roles/aiplatform.serviceAgent
  rol "serviceAccount:service-$n@gcp-sa-vectorsearch.iam.gserviceaccount.com" roles/vectorsearch.serviceAgent
  rol "serviceAccount:service-$n@gcp-sa-discoveryengine.iam.gserviceaccount.com" roles/discoveryengine.serviceAgent
  for sa in vigia-agentes vigia-jobs; do
    cd_ iam service-accounts describe "$sa@$DESTINO.iam.gserviceaccount.com" >/dev/null 2>&1 || cd_ iam service-accounts create "$sa" --quiet
  done
  local ag="serviceAccount:vigia-agentes@$DESTINO.iam.gserviceaccount.com" jb="serviceAccount:vigia-jobs@$DESTINO.iam.gserviceaccount.com"
  for r in aiplatform.user cloudsql.client documentai.apiUser discoveryengine.user secretmanager.secretAccessor \
           logging.logWriter cloudtrace.agent monitoring.metricWriter storage.objectViewer; do rol "$ag" "roles/$r"; done
  for r in cloudsql.client secretmanager.secretAccessor logging.logWriter run.invoker; do rol "$jb" "roles/$r"; done
  # Cloud Build usa la cuenta de Compute; en organizaciones nuevas no tiene roles por defecto.
  local build="serviceAccount:$n-compute@developer.gserviceaccount.com"
  for r in cloudbuild.builds.builder run.admin cloudscheduler.admin; do rol "$build" "roles/$r"; done
  cd_ iam service-accounts add-iam-policy-binding "vigia-jobs@$DESTINO.iam.gserviceaccount.com" --member "$build" \
    --role roles/iam.serviceAccountUser --quiet >/dev/null
  echo "Buckets que siguen en el origen (documentos y batch): dar lectura/escritura a las cuentas nuevas, p. ej.:"
  echo "  gcloud storage buckets add-iam-policy-binding gs://vigia-peru-documentos --member ${ag} --role roles/storage.objectViewer"
  echo "  gcloud storage buckets add-iam-policy-binding gs://vigia-peru-batch --member ${jb} --role roles/storage.objectAdmin"
}

secretos() {
  # shellcheck disable=SC2046
  $HERR secretos --origen "$ORIGEN" --destino "$DESTINO" $(cuentas) \
    cloudsql-password cloudsql-password-api cloudsql-password-api-admin cloudsql-password-mcp \
    cloudsql-password-dispatcher cloudsql-password-jobs google-api-key phoenix-api-key pinecone-api-key \
    arize-api-key decolecta-api-key local-downloader-token cloudflare-tunnel-token
}

base() {
  local ip n bucket f
  n="$(num)"; bucket="gs://vigia-migracion-$n"; f="vigia-$(date +%F-%H%M)"
  ip="${MI_IP:-$(curl -s https://ifconfig.me)}"
  if ! cd_ sql instances describe vigia-db >/dev/null 2>&1; then
    cd_ sql instances create vigia-db --database-version POSTGRES_16 --edition ENTERPRISE --tier "$TIER" \
      --region "$REGION" --storage-type SSD --storage-size 10 --storage-auto-increase \
      --root-password="$(secreto cloudsql-password)" \
      --database-flags=log_min_duration_statement=500,max_connections=100,track_io_timing=on \
      --insights-config-query-insights-enabled --backup-start-time 08:00 --authorized-networks "$ip/32" --ssl-mode ENCRYPTED_ONLY
  fi
  cd_ sql databases delete vigia --instance vigia-db --quiet >/dev/null 2>&1 || true
  cd_ sql databases create vigia --instance vigia-db
  cd_ storage buckets describe "$bucket" >/dev/null 2>&1 || \
    cd_ storage buckets create "$bucket" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  local sa_origen sa_destino ip_origen ip_destino
  sa_origen="$(co sql instances describe vigia-db --format='value(serviceAccountEmailAddress)')"
  sa_destino="$(cd_ sql instances describe vigia-db --format='value(serviceAccountEmailAddress)')"
  cd_ storage buckets add-iam-policy-binding "$bucket" --member "serviceAccount:$sa_origen" --role roles/storage.objectAdmin --quiet >/dev/null
  cd_ storage buckets add-iam-policy-binding "$bucket" --member "serviceAccount:$sa_destino" --role roles/storage.objectAdmin --quiet >/dev/null
  ip_origen="$(co sql instances describe vigia-db --format='value(ipAddresses[0].ipAddress)')"
  ip_destino="$(cd_ sql instances describe vigia-db --format='value(ipAddresses[0].ipAddress)')"

  echo "▶ globales del origen (roles, dueños, permisos)"
  PGHOST="$ip_origen" PGUSER=postgres PGDATABASE=vigia PGPASSWORD="$(co secrets versions access latest --secret cloudsql-password)" \
    $PY "$RAIZ/backend/db/snapshot/globales.py" --salida "/tmp/$f"
  echo "▶ export del origen (12 min en f1-micro) e import en el destino (51 min en f1-micro; una transacción)"
  co sql export sql vigia-db "$bucket/$f.sql.gz" --database vigia
  $PY - "/tmp/$f-pre.sql" <<PY
import os, ssl, sys, pg8000.native as pg
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
c = pg.Connection("postgres", host="$ip_destino", database="vigia", password="""$(secreto cloudsql-password)""", ssl_context=ctx)
for l in open(sys.argv[1], encoding="utf-8"):
    if l.strip() and not l.startswith("--"): c.run(l.split("  --")[0].strip().rstrip(";"))
PY
  cd_ sql import sql vigia-db "$bucket/$f.sql.gz" --database vigia --user postgres --quiet
  $PY - "/tmp/$f-post.sql" <<PY
import os, ssl, sys, pg8000.native as pg
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
c = pg.Connection("postgres", host="$ip_destino", database="vigia", password="""$(secreto cloudsql-password)""", ssl_context=ctx, timeout=3600)
for l in open(sys.argv[1], encoding="utf-8"):
    if l.strip() and not l.startswith("--"): c.run(l.strip().rstrip(";"))
PY
  for par in vigia_api:cloudsql-password-api vigia_api_admin:cloudsql-password-api-admin vigia_mcp:cloudsql-password-mcp \
             vigia_dispatcher:cloudsql-password-dispatcher vigia_jobs:cloudsql-password-jobs; do
    cd_ sql users set-password "${par%%:*}" --instance vigia-db --password="$(secreto "${par#*:}")" --quiet >/dev/null && echo "  ✓ ${par%%:*}"
  done
  PGPW_ORIGEN="$(co secrets versions access latest --secret cloudsql-password)" PGPW_DESTINO="$(secreto cloudsql-password)" \
    $HERR comparar-bases --origen "host=$ip_origen password_env=PGPW_ORIGEN" --destino "host=$ip_destino password_env=PGPW_DESTINO"
}

ia() {
  local n t proc rag viejo="${RAG_BUCKET_ORIGEN:-vigia-peru-rag}"
  n="$(num)"; rag="vigia-rag-$n"
  t="$(cd_ auth print-access-token)"
  proc="$(curl -s -H "Authorization: Bearer $t" -H "Content-Type: application/json" \
    "https://us-documentai.googleapis.com/v1/projects/$DESTINO/locations/us/processors" \
    -d '{"type":"OCR_PROCESSOR","displayName":"vigia-ocr"}' | $PY -c "import json,sys; print(json.load(sys.stdin).get('name','').split('/')[-1])")"
  echo "Document AI: DOCAI_PROCESSOR_ID=$proc (si ya existía: gcloud ... documentai processors list)"
  cd_ storage buckets describe "gs://$rag" >/dev/null 2>&1 || \
    cd_ storage buckets create "gs://$rag" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  cd_ storage buckets add-iam-policy-binding "gs://$rag" --member "serviceAccount:service-$n@gcp-sa-vertex-rag.iam.gserviceaccount.com" \
    --role roles/storage.objectAdmin --quiet >/dev/null
  co storage rsync -r "gs://$viejo" "gs://$rag" --exclude "_import/.*"
  $HERR catalogo-rag --proyecto "$DESTINO" --bucket-viejo "$viejo" --bucket-nuevo "$rag"
  (cd "$RAIZ" && export VERTEX_PROJECT="$DESTINO" GOOGLE_CLOUD_PROJECT="$DESTINO" RAG_BUCKET="$rag" RAG_LOCATION="$REGION"
   $PY -m backend.rag.corpus config --serverless \
   && rol "serviceAccount:service-$n@gcp-sa-vertex-rag.iam.gserviceaccount.com" roles/aiplatform.ragServiceAgent \
   && $PY -m backend.rag.corpus crear \
   && $PY -m backend.rag.corpus importar --rpm 60 --no-esperar)
  echo "RAG: el import corre en Google (~1 h). Estado: VERTEX_PROJECT=$DESTINO RAG_BUCKET=$rag python -m backend.rag.corpus estado"
  # shellcheck disable=SC2046
  $HERR vertex-search --origen "$ORIGEN" --destino "$DESTINO" $(cuentas)
}

agentes() {
  local n img docai; n="$(num)"
  : "${DOCAI:?DOCAI=<id del procesador de Document AI de la fase ia>}"
  cd_ artifacts repositories describe cloud-run-source-deploy --location "$REGION" >/dev/null 2>&1 || \
    cd_ artifacts repositories create cloud-run-source-deploy --repository-format=docker --location "$REGION" --quiet
  img="$REGION-docker.pkg.dev/$DESTINO/cloud-run-source-deploy/agentes:$(cd "$RAIZ" && git rev-parse --short=12 HEAD)"
  cd_ builds submit "$RAIZ/backend/agent" --tag "$img" --region "$REGION"
  $HERR agentes-yaml --proyecto "$DESTINO" --region "$REGION" --imagen "$img" --docai "$DOCAI" --rag-bucket "vigia-rag-$n" --salida /tmp/agentes-yaml
  for f in /tmp/agentes-yaml/*.yaml; do cd_ run services replace "$f" --region "$REGION" --quiet; done
  # Quién llama a los agentes: dispatcher y web de Cloudflare (sus llaves), frontend y API de la entrada.
  for m in ${INVOCADORES:-}; do
    for s in agent-orchestrator-adk agente-servicios agente-obras agente-otros; do
      cd_ run services add-iam-policy-binding "$s" --region "$REGION" --member "serviceAccount:$m" --role roles/run.invoker --quiet >/dev/null
    done
    echo "  ✓ run.invoker → $m"
  done
  echo "URLs: https://<servicio>-$n.$REGION.run.app (AGENT_HOST_SUFFIX=$n.$REGION.run.app)"
}

pgbouncer() { PROJECT_ID="$DESTINO" CUENTA="${CUENTA_DESTINO:-}" bash "$RAIZ/infrastructure/deploy/pgbouncer.sh" crear; }

jobs() {
  PROJECT_ID="$DESTINO" CUENTA="${CUENTA_DESTINO:-}" bash "$RAIZ/infrastructure/deploy/cloud-scrapers.sh"
  PROJECT_ID="$DESTINO" CUENTA="${CUENTA_DESTINO:-}" bash "$RAIZ/infrastructure/deploy/ingest-job.sh"
}

corte() {
  local n; n="$(num)"
  cat <<TXT
Corte a $DESTINO (producción: correr a mano, en orden; README.md § Corte). Ventana de escrituras en pausa.

1. Pausar escrituras en el origen:
   gcloud scheduler jobs list --project $ORIGEN --location $REGION     # pausar los scraper-* con: jobs pause <nombre>
   # base del origen en solo lectura (vuelta atrás: ALTER DATABASE vigia RESET default_transaction_read_only)
   psql host=<ip-origen> user=postgres dbname=vigia -c "ALTER DATABASE vigia SET default_transaction_read_only = on"
   psql ... -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='vigia' AND pid<>pg_backend_pid()"
2. Si hubo escrituras desde la copia: fase base de nuevo. Si no: comparar-bases debe dar 0 diferencias.
3. Entrada pública (Cloud Run web/API/MCP del proyecto de la entrada) → base y agentes nuevos:
   gcloud run services update vigia-peru-api --project <entrada> --region $REGION --clear-network \\
     --set-cloudsql-instances $DESTINO:$REGION:vigia-db --remove-env-vars PGSSLMODE \\
     --update-env-vars PGHOST=/cloudsql/$DESTINO:$REGION:vigia-db,PGPORT=5432,PG_POOLER=directo,AGENT_HOST_SUFFIX=$n.$REGION.run.app
   gcloud run services update vigia-mcp (igual, sin AGENT_HOST_SUFFIX)
   gcloud run services update vigia-peru-frontend --update-env-vars VIGIA_AGENT_URL=https://agent-orchestrator-adk-$n.$REGION.run.app
   (las cuentas vigia-api@ y vigia-mcp@ de la entrada necesitan roles/cloudsql.client en $DESTINO)
4. Túnel de Cloudflare: fase pgbouncer (la VM nueva registra el túnel) y detener la VM vieja:
   gcloud compute instances stop vigia-pgbouncer --zone ${REGION}-a --project $ORIGEN
5. Cloudflare: backend/dispatcher-worker y frontend (wrangler.jsonc) con las URLs -$n.$REGION.run.app,
   backend/api con AGENT_HOST_SUFFIX=$n.$REGION.run.app; npx wrangler deploy en cada uno.
6. Validar: curl https://vigia-api.vigiaperu.workers.dev/health ; reanalizar un contrato desde el panel y
   POST /ejecutar del dispatcher; revisar que el análisis se guarde con dictamen y costo.
7. Detener (no borrar) la base del origen: gcloud sql instances patch vigia-db --activation-policy NEVER --project $ORIGEN
TXT
}

case "${1:-}" in
  apis|identidades|secretos|base|ia|agentes|pgbouncer|jobs|corte) "$1" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
