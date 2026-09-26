# infrastructure/

Todo lo que no es código de aplicación: la plataforma GCP como código, los
scripts de deploy por servicio y el entorno local.

```
infrastructure/
├── terraform/            # Plataforma GCP: APIs, Cloud SQL, buckets, Secret Manager, IAM, Cloud Run
├── deploy/               # Un script por servicio: gcloud run deploy --source
├── docker/               # Imagen Postgres 16 + PostGIS + pgvector para dev local
└── docker-compose.yml    # Levanta esa base en 127.0.0.1:5432
```

## 1. Entorno local

```bash
docker compose -f infrastructure/docker-compose.yml up -d
export PGPASSWORD=vigia           # PGHOST=127.0.0.1, PGUSER=postgres, PGDATABASE=vigia son los defaults
python backend/db/apply_all.py    # extensiones + 8 migraciones
python backend/scripts/seed/seed_db.py   # opcional: datos demo
```

Frontend, API y orquestador se corren desde sus carpetas (ver README raíz);
necesitan credenciales GCP (`gcloud auth application-default login`).

## 2. Deploy a Cloud Run

Un script por servicio. Todos usan `gcloud run deploy --source` (Cloud Build +
buildpacks o el `Dockerfile` de la carpeta) y `--update-env-vars` (mergea, no
borra lo existente).

| Script | Servicio Cloud Run | Fuente |
|---|---|---|
| `deploy/frontend.sh` | `vigia-peru-frontend` | `frontend/` |
| `deploy/api.sh` | `vigia-peru-api` | `backend/api/` |
| `deploy/agent.sh` | `agent-orchestrator-adk` | `backend/agent/` |
| `deploy/mcp.sh` | `vigia-mcp` | `backend/mcp/` |
| `deploy/dispatcher.sh` | **Job** `vigia-dispatcher` + Scheduler `vigia-dispatcher-run` | `backend/dispatcher/` |

```bash
bash infrastructure/deploy/api.sh
EXTRA_ENV="PARALLEL_RESEARCH=0" bash infrastructure/deploy/agent.sh   # cambiar una variable del orquestador
PROJECT_ID=otro-proyecto bash infrastructure/deploy/mcp.sh            # otro proyecto
```

**Frontend:** las variables `NEXT_PUBLIC_*` (config web de Firebase) se leen en
`next build` desde `frontend/.env.production` — gitignored, pero permitido en
`.gcloudignore` para que llegue al build. Copiá los valores de tu proyecto
Firebase antes del primer deploy.

**Orquestador:** nunca usar `--set-env-vars`. Borra las ~40 variables
operativas, los secretos montados y la conexión Cloud SQL. `agent.sh` solo usa
`--update-env-vars`. Lo mismo con secretos: `--update-secrets`, nunca `--set-secrets`
(borra los demás secretos montados).

**SUNAT (decolecta):** `DECOLECTA_API_KEY` se monta desde el secreto `decolecta-api-key`
(`agent.sh` / `agentes.sh` lo hacen solos cuando el secreto existe; mientras no exista, dejan la
variable como está). Para crearlo con una key válida:

```bash
printf '%s' "$DECOLECTA_KEY" | gcloud secrets create decolecta-api-key --replication-policy=automatic --data-file=-
# rotarla después:  printf '%s' "$NUEVA" | gcloud secrets versions add decolecta-api-key --data-file=-
```

**Agentes IAM-only:** los 4 servicios de agentes se invocan con ID token de Google (frontend
`/api/agent/*`, API `/admin/operacion`, job `vigia-dispatcher`). Los deploys ya no agregan
`allUsers` (`AGENTES_PUBLICOS=1` en `agentes.sh` restaura el comportamiento viejo). Quitar
`allUsers` a mano solo DESPUÉS de desplegar esos tres clientes.

El relay residencial (`backend/relay/`) no se despliega en GCP: corre en un VPS
en Lima con systemd/Docker (instrucciones en su propio README).

### Variables de entorno del orquestador

| Grupo | Variables |
|---|---|
| GCP / modelos | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (`global`), `GOOGLE_GENAI_USE_VERTEXAI`, `GEMINI_MODEL`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, `VERTEX_PROJECT`, `VERTEX_LOCATION` |
| Costo de Gemini | `GEMINI_MODEL_JUDGE` (`gemini-3.5-flash-lite`), `GEMINI_FLEX` (`1` = Flex PayGo por llamada con salida a Standard), `GEMINI_FLEX_TIMEOUT_S` (600), `GEMINI_FLEX_CORTE_S` (1800), `GEMINI_FLEX_FALLAS`/`GEMINI_FLEX_VENTANA_S`/`GEMINI_FLEX_PAUSA_S` (3/600/900), `THINKING_<ETAPA>` (`minimal`\|`low`\|`medium`\|`high`\|`none`), `REGLAS_EN_CODIGO` (`1`), `TRACE_REDACTAR_PII` (`1`) |
| Base de datos | `PGHOST` (socket `/cloudsql/...`), `PGUSER`, `PGDATABASE`, `PGPASSWORD` (secreto) |
| OCR | `DOCAI_PROJECT`, `DOCAI_LOCATION`, `DOCAI_PROCESSOR_ID`, `DOCAI_LAYOUT_TEXT` |
| RAG legal | `LEGAL_RAG_BACKEND` (`vertex` \| `pgvector`), `LEGAL_RAG_ENGINE`, `LEGAL_RAG_DATASTORE`, `PINECONE_API_KEY` (legacy, secreto) |
| Egress `.gob.pe` | `LOCAL_DOWNLOADER_URL`, `LOCAL_DOWNLOADER_TOKEN`, `OECE_RELAY_URL`, `VIGIA_SCRAPER_URL` |
| Fuentes externas | `DECOLECTA_API_KEY` (secreto `decolecta-api-key`), `DECOLECTA_BASE` |
| Pipeline | `DETERMINISTIC_PIPELINE`, `PARALLEL_RESEARCH`, `PARSE_*`, `MARKET_*`, `SANITIZE_ITEMS_MODEL` |
| Observabilidad | `PHOENIX_API_KEY` (secreto), `PHOENIX_COLLECTOR_ENDPOINT`, `ARIZE_API_KEY`, `ARIZE_SPACE_ID`, `ARIZE_PROJECT` |

## 3. Cloud Build (CI/CD)

`cloudbuild.yaml` en la raíz despliega los servicios desde su carpeta. Manual:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions=_DEPLOY=api,frontend
```

Trigger en push a `main`: ver el comentario del archivo. El `.env.production` del
frontend (NEXT_PUBLIC_FIREBASE_*) vive en el secreto `frontend-env-production` y
Cloud Build lo materializa antes del build.

Secretos del panel `/admin`:
- `admin-token`: token de servicio entre el frontend (servidor) y el API, y del job de Cloud
  Scheduler. No es un login: nadie lo escribe en el navegador. Rotarlo = versión nueva,
  redesplegar API y frontend, actualizar la cabecera `x-admin-token` del job de Scheduler y
  deshabilitar la versión anterior (rotado el 2026-09-24).
- `admin-session-secret`: llave (≥ 32 caracteres) con la que el frontend firma la cookie de
  sesión. Distinta del token: quien conozca el token no puede fabricarse una sesión.
- `admin-emails`: administradores principales. Se entra en `/admin/login` con una cuenta de
  Firebase de correo verificado; el resto del equipo (perfiles admin | revisor) se gestiona en
  `/admin/equipo` (tabla `equipo`, migración 29).
- `frontend-env-production`. El job de Cloud Scheduler
`vigia-financiamiento-asignar` (cada 10 min) llama a `POST /admin/asignar`, que asigna
contratos FIFO a contribuciones pagadas y refresca `zona_estado` / `ranking_impacto`.

## 4. Dispatcher (procesamiento automático y en vivo)

`backend/dispatcher` es un **Cloud Run Job** (`vigia-dispatcher`), no un servicio. Cloud
Scheduler `vigia-dispatcher-run` lo ejecuta cada 5 min; cada ejecución reclama hasta
`DISPATCHER_PARALLEL` (2) contratos de `procesamientos` con `FOR UPDATE SKIP LOCKED`
(ejecuciones solapadas no se pisan), llama al orquestador por streaming y persiste cada
fase para que el público la vea en `/auditoria` (`GET /financiamiento/procesamientos`).
Solo procesa lo que `asignar_contribucion()` ya asignó a un aporte pagado.

```bash
bash infrastructure/deploy/dispatcher.sh                                   # deploy job + scheduler
gcloud run jobs execute vigia-dispatcher --region us-central1 --wait       # corrida manual
gcloud run jobs executions list --job vigia-dispatcher --region us-central1
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vigia-dispatcher"' --limit 30
```

Estados de `procesamientos.estado`: `encolado → procesando → procesado | error` (3 intentos;
>20 min sin latido = se re-encola solo). Re-encolar a mano:

```sql
UPDATE procesamientos SET estado='encolado', intentos=0, error=NULL, worker=NULL WHERE ocid='…';
```

o desde el panel: `POST /admin/procesamientos/:ocid/reencolar` (`x-admin-token`).
Monitor: `GET /admin/procesamientos` (incluye `worker`, `error`, `latidoAt`).

## 5. Terraform

Declara la plataforma: APIs, Cloud SQL (Postgres 16, pgvector), 3 buckets, 4
secretos + bindings por secreto, roles de la service account de runtime, la SA
del relay y los 4 servicios Cloud Run con su configuración (CPU/RAM/escala/
secretos/conexión SQL). La **imagen** de cada servicio la actualizan los scripts
de `deploy/`; Terraform la ignora (`lifecycle.ignore_changes`).

La infraestructura ya existe (se creó con `gcloud` durante el hackathon). Para
adoptarla sin recrear nada:

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars          # completar project_id / project_number
gcloud storage buckets create gs://$PROJECT_ID-tfstate --location=us-central1 --uniform-bucket-level-access
terraform init -backend-config="bucket=$PROJECT_ID-tfstate"
cp imports.tf.example imports.tf                      # bloques import de lo que ya existe
terraform plan                                        # revisar: debe ser mayormente "import", pocos "update"
terraform apply
rm imports.tf
```

Los valores de los secretos externos (`google-api-key`, `phoenix-api-key`,
`pinecone-api-key`) **no** pasan por Terraform:

```bash
printf '%s' "$VALUE" | gcloud secrets versions add google-api-key --data-file=-
```

`cloudsql-password` sí lo genera Terraform (`random_password`) porque crea el
usuario `postgres`; al importar una instancia existente, el primer `apply`
rotará esa contraseña — hacerlo en una ventana de mantenimiento o fijar el valor
actual antes.

### Siguiente nivel de hardening (no hecho)

- Una service account por servicio en vez de la SA por defecto de Compute.
- Quitar `allUsers` del orquestador y la API; poner el frontend como único
  invocador (IAM) o IAP + Cloud Armor delante.
- Cloud SQL sin IP pública (solo Private Service Connect + Auth Proxy).
- CI: GitHub Actions con `terraform plan` en PR y `deploy/*.sh` en merge a `main`.
