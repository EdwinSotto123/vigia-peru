# infrastructure/

Todo lo que no es código de aplicación: la plataforma GCP como código, los
scripts de deploy por servicio y el entorno local.

```
infrastructure/
├── terraform/            # Plataforma GCP: APIs, Cloud SQL, buckets, Secret Manager, IAM, Cloud Run
├── deploy/               # Un script por servicio: gcloud run deploy --source
├── docker/               # Imagen Postgres 14 + PostGIS + pgvector para dev local
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
`--update-env-vars`.

El relay residencial (`backend/relay/`) no se despliega en GCP: corre en un VPS
en Lima con systemd/Docker (instrucciones en su propio README).

### Variables de entorno del orquestador

| Grupo | Variables |
|---|---|
| GCP / modelos | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (`global`), `GOOGLE_GENAI_USE_VERTEXAI`, `GEMINI_MODEL`, `GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, `VERTEX_PROJECT`, `VERTEX_LOCATION` |
| Base de datos | `PGHOST` (socket `/cloudsql/...`), `PGUSER`, `PGDATABASE`, `PGPASSWORD` (secreto) |
| OCR | `DOCAI_PROJECT`, `DOCAI_LOCATION`, `DOCAI_PROCESSOR_ID`, `DOCAI_LAYOUT_TEXT` |
| RAG legal | `LEGAL_RAG_BACKEND` (`vertex` \| `pgvector`), `LEGAL_RAG_ENGINE`, `LEGAL_RAG_DATASTORE`, `PINECONE_API_KEY` (legacy, secreto) |
| Egress `.gob.pe` | `LOCAL_DOWNLOADER_URL`, `LOCAL_DOWNLOADER_TOKEN`, `OECE_RELAY_URL`, `VIGIA_SCRAPER_URL` |
| Fuentes externas | `DECOLECTA_API_KEY`, `DECOLECTA_BASE` |
| Pipeline | `DETERMINISTIC_PIPELINE`, `PARALLEL_RESEARCH`, `PARSE_*`, `MARKET_*`, `SANITIZE_ITEMS_MODEL` |
| Observabilidad | `PHOENIX_API_KEY` (secreto), `PHOENIX_COLLECTOR_ENDPOINT`, `ARIZE_API_KEY`, `ARIZE_SPACE_ID`, `ARIZE_PROJECT` |

## 3. Terraform

Declara la plataforma: APIs, Cloud SQL (Postgres 14, pgvector), 3 buckets, 4
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
