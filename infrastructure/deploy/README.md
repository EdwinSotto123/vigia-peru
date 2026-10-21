# Scripts de despliegue

Separados por proveedor. Qué corre dónde lo decide `infrastructure/proveedores.env` (banderas `GCP_USE` y
`GCP_USE_<COMPONENTE>`); el detalle está en `docs/PROVEEDORES.md`.

```
deploy/
├─ desplegar.sh      ← producción: `bash infrastructure/deploy/desplegar.sh <componente>` (lee las banderas)
├─ dev.sh            ← DEV: copia de trabajo a los Workers -dev y vigia-db-dev (docs/DEV.md)
├─ _common.sh        ← proyectos de GCP, cuentas y Cloud Build (gcb), compartido
├─ cloudflare/       ← lo de hoy
│  ├─ worker.sh      ← un Worker a producción desde lo commiteado (api, mcp, scrapers, llm, precios, relay, r2-sync, dispatcher)
│  ├─ web.sh         ← vigia-web: build en Cloud Build, deploy con wrangler
│  └─ base.sh        ← túnel de Cloudflare, servicio VPC e Hyperdrive hacia PgBouncer
├─ aws/
│  └─ agentes.sh     ← Lambda de los agentes con una imagen de ECR
└─ gcp/              ← lo de GCP, listo para volver a usarse (GCP_USE=true)
   ├─ api.sh, frontend.sh, mcp.sh, agentes.sh, dispatcher.sh, cloud-scrapers.sh
   ├─ pgbouncer.sh, egreso-fijo.sh, cuentas-servicio.sh, hosting.sh, ingest-job.sh, batch-*.sh, scrapers-job.sh
   ├─ agent.sh, agente-ab.sh (históricos)
   └─ migracion/     ← mudar todo de un proyecto de GCP a otro
```

Producción despliega **lo commiteado** (`cloudflare/worker.sh` se niega si la carpeta tiene cambios; la web empaqueta
`git archive HEAD`). DEV despliega la copia de trabajo.

## Proyectos de GCP (`_common.sh`)

Todos los scripts de `gcp/` leen los proyectos de `_common.sh`; ninguno tiene un proyecto fijo.

| Variable | Qué es | Hoy |
|---|---|---|
| `PROJECT_ID` | Plataforma: agentes, IA, PgBouncer, scrapers, ingesta | `project-a974c6e5-0cdf-4b11-a86` (facturación suspendida) |
| `ENTRADA_PROJECT_ID` | Entrada pública: Firebase Hosting y Cloud Run web, API y MCP | `vivid-spot-480905-a4` |
| `BUCKETS_PROJECT_ID` | Buckets `vigia-peru-*` (siguen en uso) | `vivid-spot-480905-a4` |
| `BUILD_PROJECT_ID` | Cloud Build del build de la web | `vivid-spot-480905-a4` |
| `CUENTA`, `CUENTA_ENTRADA` | Cuentas de gcloud, si cada proyecto es de una cuenta distinta | opcionales |

```bash
CUENTA=<cuenta-plataforma> CUENTA_ENTRADA=<cuenta-entrada> bash infrastructure/deploy/gcp/api.sh
```

`_common.sh` fija el proyecto de gcloud solo para el script (`CLOUDSDK_CORE_PROJECT`), sin tocar la configuración de la
máquina.

## La base

No se despliega con estos scripts: es terraform en `cloud_sql/terraform` (estado en S3) y no es pública. Para
administrarla desde una PC: `python infrastructure/aws/tunel_rds.py prod|dev` (Session Manager por el proxy).
