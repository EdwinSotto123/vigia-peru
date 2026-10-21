# Proveedores: Cloudflare/AWS hoy, GCP cuando se quiera

Vigía corre hoy en **Cloudflare Workers + AWS** (RDS, Lambda). Lo que antes corría en **GCP** (Cloud Run, Cloud Run
Jobs, Cloud SQL) sigue en el repo, separado, para volver a usarlo componente por componente —por ejemplo, con créditos de
GCP for Startups— sin reescribir nada.

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

Un único punto de entrada para producción lee esas banderas y llama al script de cada lado:

```bash
bash infrastructure/deploy/desplegar.sh api                        # donde diga proveedores.env
GCP_USE_API=true bash infrastructure/deploy/desplegar.sh api       # a GCP sólo esta vez (el entorno manda sobre el archivo)
```

DEV no pasa por ahí: siempre es Cloudflare + `vigia-db-dev` (`bash infrastructure/deploy/dev.sh`, ver `DEV.md`).

## Cada componente, en cada lado

| Componente | Cloudflare / AWS (hoy) | Script | GCP | Script |
|---|---|---|---|---|
| `api` | Worker `vigia-api` (`backend/api`, entrada `src/worker.ts`) | `deploy/cloudflare/worker.sh api` | Cloud Run `vigia-peru-api` (mismo código, entrada `src/index.ts` en Node) | `deploy/gcp/api.sh` |
| `web` | Worker `vigia-web` (`frontend`, OpenNext) | `deploy/cloudflare/web.sh` | Cloud Run `vigia-peru-frontend` (mismo código) | `deploy/gcp/frontend.sh` |
| `mcp` | Worker `vigia-mcp` (`backend/mcp-worker`) | `deploy/cloudflare/worker.sh mcp` | Cloud Run `vigia-mcp` (`backend/mcp`, Python) | `deploy/gcp/mcp.sh` |
| `scrapers` | Worker `vigia-scrapers` con Workflows (`backend/scrapers-worker`) | `deploy/cloudflare/worker.sh scrapers` | Cloud Run Jobs + Scheduler (`backend/cloud_functions`, que vendoriza `backend/scrapers`) | `deploy/gcp/cloud-scrapers.sh [fuente]` |
| `agentes` | Lambda `vigia-agente-bienes` (`backend/agent`, `Dockerfile.lambda`) | `deploy/aws/agentes.sh <tag>` | 4 servicios Cloud Run (`backend/agent`, `Dockerfile`) | `deploy/gcp/agentes.sh` |
| `dispatcher` | Worker `vigia-dispatcher` (`backend/dispatcher-worker`, apagado) | `deploy/cloudflare/worker.sh dispatcher` | Cloud Run Job (`backend/dispatcher`) | `deploy/gcp/dispatcher.sh` |
| `llm`, `precios`, `relay`, `r2-sync` | Workers propios | `deploy/cloudflare/worker.sh <nombre>` | — (sólo Cloudflare) | — |
| base | RDS `vigia-db` (us-east-2) | `cloud_sql/terraform`, `proveedor = "aws"` | Cloud SQL | el mismo terraform con `proveedor = "gcp"` + migración de datos (`cloud_sql/README.md`) |

Otros scripts sólo de GCP (en `infrastructure/deploy/gcp/`): `pgbouncer.sh` (VM de PgBouncer), `egreso-fijo.sh` (IP de
salida fija de Cloud Run), `cuentas-servicio.sh`, `hosting.sh` (Firebase Hosting), `ingest-job.sh`, `batch-*.sh`,
`scrapers-job.sh`, `agente-ab.sh`, `agent.sh` y `migracion/` (mudar de proyecto). La infraestructura de GCP en terraform
está en `infrastructure/terraform/`.

## Lo que hoy SIGUE en GCP aunque `GCP_USE=false`

- **Buckets de GCS** `vigia-peru-documentos`, `vigia-peru-reportes`, `vigia-peru-privado` (proyecto `vivid-spot`): los
  usan la API y la web para subir y servir archivos. R2 tiene la réplica de documentos para los agentes.
- **El build de la web** corre en Cloud Build de `vivid-spot` (`deploy/cloudflare/web.sh` → `gcb`), porque el de un
  laptop no alcanza.
- **El login** es Firebase Auth (`simplia-project`).

## Volver a GCP (lista de control)

1. **Facturación** del proyecto de destino (créditos de GCP for Startups) y los proyectos en `deploy/_common.sh`
   (`PROJECT_ID`, `ENTRADA_PROJECT_ID`, `BUCKETS_PROJECT_ID`, `BUILD_PROJECT_ID`).
2. **Secretos** en Secret Manager: los scripts de `deploy/gcp/` los montan por nombre (`cloudsql-password-*`, `rds-password`,
   `admin-token`…). Los valores vigentes están en SSM (`/vigia/...`) y en los secretos de los Workers.
3. **La base no es pública** (desde el 2026-10-21): un servicio de GCP que la consulte necesita una IP de salida fija
   (`deploy/gcp/egreso-fijo.sh`) agregada a `cidrs_permitidos` en `cloud_sql/terraform/terraform.tfvars`. Con alguna IP
   ahí, terraform vuelve a poner la base como `publicly_accessible`, sólo para esas IPs.
4. **Agentes en Cloud Run**: usan Vertex (Gemini) salvo que se les pase `USAR_WORKERS_AI=1` (por agente:
   `USAR_WORKERS_AI_<AGENTE>`), que los manda al Worker `vigia-llm`. El rol de base es `vigia_agentes` (sin acceso a datos
   privados desde la migración 89).
5. Cambiar la bandera en `proveedores.env`, commitear y `bash infrastructure/deploy/desplegar.sh <componente>`.
6. Si la API pasa a GCP, la web la sigue buscando en `VIGIA_API_URL` (vars del Worker `vigia-web`): apuntarla a la URL
   nueva.
