# Proveedores: Cloudflare/AWS hoy, GCP cuando se quiera

Vigía corre hoy en **Cloudflare Workers + AWS** (RDS, Lambda), con modelos abiertos de Workers AI. Lo que antes corría
en **GCP** (Cloud Run, Cloud Run Jobs, Cloud SQL, Vertex) es legado: GCP está sin facturación. Sigue en el repo,
separado, para volver a usarlo componente por componente (por ejemplo, con créditos de GCP for Startups) sin reescribir
nada.

## Cómo se elige

`infrastructure/proveedores.env`:

```bash
GCP_USE=false          # todos
GCP_USE_API=           # vacío = lo que diga GCP_USE; true/false manda sobre él
GCP_USE_WEB=
GCP_USE_MCP=
GCP_USE_SCRAPERS=
GCP_USE_AGENTES=
GCP_USE_DISPATCHER=
```

La API, la web y los agentes se despliegan a producción desde GitLab, con jobs manuales (`deploy:api:prod`,
`deploy:web:prod`, `deploy:agentes:prod`). Para lo demás, y para desplegar desde la PC, un único punto de entrada lee esas
banderas y llama al script de cada lado:

```bash
bash infrastructure/deploy/desplegar.sh api                        # donde diga proveedores.env
GCP_USE_API=true bash infrastructure/deploy/desplegar.sh api       # a GCP sólo esta vez (el entorno manda sobre el archivo)
```

DEV no pasa por ahí: siempre es Cloudflare + `vigia-db-dev` (`bash infrastructure/deploy/dev.sh`, ver `DEV.md`).

## Cada componente, en cada lado

| Componente | Cloudflare / AWS (hoy) | Script | GCP | Script |
|---|---|---|---|---|
| `api` | Worker `vigia-api` (`backend/api`, entrada `src/worker.ts`) | GitLab `deploy:api:prod`, o `deploy/cloudflare/worker.sh api` | Cloud Run `vigia-peru-api` (mismo código, entrada `src/index.ts` en Node) | `deploy/gcp/api.sh` |
| `web` | Worker `vigia-web` (`frontend`, OpenNext), en `vigia.gobserva.cloud` | GitLab `deploy:web:prod`, o `deploy/cloudflare/web.sh` | Cloud Run `vigia-peru-frontend` (mismo código) | `deploy/gcp/frontend.sh` |
| `mcp` | Worker `vigia-mcp` (`backend/mcp-worker`) | `deploy/cloudflare/worker.sh mcp` | Cloud Run `vigia-mcp` (`backend/mcp`, Python) | `deploy/gcp/mcp.sh` |
| `scrapers` | Worker `vigia-scrapers` con Workflows (`backend/scrapers-worker`) | `deploy/cloudflare/worker.sh scrapers` | Cloud Run Jobs + Scheduler (`backend/cloud_functions`, que vendoriza `backend/scrapers`) | `deploy/gcp/cloud-scrapers.sh [fuente]` |
| `agentes` | 5 Lambdas, una por red: bienes, servicios, obras, consultoría y directas (`backend/agent`, imagen en ECR) | GitLab `build:agente` y `deploy:agentes:prod`; `deploy/aws/agentes.sh <tag>` crea o configura una | 4 servicios Cloud Run (`backend/agent`, `Dockerfile`) | `deploy/gcp/agentes.sh` |
| `dispatcher` | Worker `vigia-dispatcher` (`backend/dispatcher-worker`, cron cada 5 min hacia las Lambdas) | `deploy/cloudflare/worker.sh dispatcher` | Cloud Run Job (`backend/dispatcher`) | `deploy/gcp/dispatcher.sh` |
| `llm`, `precios`, `relay`, `r2-sync` | Workers propios (`vigia-llm` sirve los modelos abiertos de Workers AI) | `deploy/cloudflare/worker.sh <nombre>` | — (sólo Cloudflare) | — |
| `ocr` | Worker `vigia-ocr`: Docling en Cloudflare Containers (`backend/ocr-worker`) | `npm run deploy` en su carpeta | — (sólo Cloudflare) | — |
| base | RDS `vigia-db` (us-east-2) | `cloud_sql/terraform`, `proveedor = "aws"` | Cloud SQL | el mismo terraform con `proveedor = "gcp"` + migración de datos (`cloud_sql/README.md`) |

Otros scripts sólo de GCP (en `infrastructure/deploy/gcp/`): `pgbouncer.sh` (VM de PgBouncer), `egreso-fijo.sh` (IP de
salida fija de Cloud Run), `cuentas-servicio.sh`, `hosting.sh` (Firebase Hosting), `ingest-job.sh`, `batch-*.sh`,
`scrapers-job.sh`, `agente-ab.sh`, `agent.sh` y `migracion/` (mudar de proyecto). La infraestructura de GCP en terraform
está en `infrastructure/terraform/` (legado).

## Lo que queda de Google

- **El login de Vigía** es Firebase Auth. Las apps de Gobserva usan AWS Cognito (`infrastructure/aws/cognito_gobserva.py`).
- **Nada más.** Los buckets de GCS (`vigia-peru-documentos`, `vigia-peru-reportes`, `vigia-peru-privado`) responden 403
  desde el 2026-11-06: sus copias, con los mismos nombres, están en R2, y la API y la web escriben ahí. El build de la web
  ya no usa Cloud Build: corre en GitLab (`deploy:web:prod`) o en la PC (`deploy/cloudflare/web.sh`).

## Volver a GCP (lista de control)

1. **Facturación** del proyecto de destino (créditos de GCP for Startups) y los proyectos en `deploy/_common.sh`
   (`PROJECT_ID`, `ENTRADA_PROJECT_ID`, `BUCKETS_PROJECT_ID`, `BUILD_PROJECT_ID`).
2. **Secretos** en Secret Manager: los scripts de `deploy/gcp/` los montan por nombre (`cloudsql-password-*`, `rds-password`,
   `admin-token`…). Los valores vigentes están en SSM (`/vigia/...`) y en los secretos de los Workers.
3. **La base no es pública** (desde el 2026-10-21): un servicio de GCP que la consulte necesita una IP de salida fija
   (`deploy/gcp/egreso-fijo.sh`) agregada a `cidrs_permitidos` en `cloud_sql/terraform/terraform.tfvars`. Con alguna IP
   ahí, terraform vuelve a poner la base como `publicly_accessible`, sólo para esas IPs.
4. **Agentes en Cloud Run**: sin `USAR_WORKERS_AI=1` (por agente: `USAR_WORKERS_AI_<AGENTE>`) usan Vertex. Para seguir
   con los modelos abiertos de hoy, pásalo: los manda al Worker `vigia-llm`. El rol de base es `vigia_agentes` (sin acceso a datos
   privados desde la migración 89).
5. Cambiar la bandera en `proveedores.env`, commitear y `bash infrastructure/deploy/desplegar.sh <componente>`.
6. Si la API pasa a GCP, la web la sigue buscando en `VIGIA_API_URL` (vars del Worker `vigia-web`): apuntarla a la URL
   nueva.
