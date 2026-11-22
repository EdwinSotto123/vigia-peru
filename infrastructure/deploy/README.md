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

## Runner propio en la PC (2026-11-22)

GitLab se quedó sin minutos de CI (`ci_quota_exceeded`). Los pipelines corren en un runner del proyecto en la PC de desarrollo:

- Contenedor `gitlab-runner` (imagen `gitlab/gitlab-runner:v17.11.0`, `--restart always`) con ejecutor Docker, imagen por defecto `node:22-bookworm` y `concurrent = 1` (un trabajo a la vez: WSL/Docker tiene 4 GB, ver `~/.wslconfig`). Su configuración vive en el volumen `gitlab-runner-config`.
- En GitLab es el runner `pc-local-docker` del proyecto, sin etiquetas. Los runners compartidos están desactivados en el proyecto para que nada caiga en la cuota.
- Necesita Docker Desktop encendido; con la PC apagada, los pipelines quedan pendientes.
- Volver a los compartidos: activar «shared runners» en Settings > CI/CD > Runners (o `PUT /projects/:id shared_runners_enabled=true`) y `docker rm -f gitlab-runner`.
- Las tareas programadas de cada 3 h (`masivo-agentes`, `reanalisis`) quedaron pausadas para no ocupar el runner horas; las diarias y la mensual siguen. Por qué: los 50 000 minutos de la prueba de Ultimate se gastaron sobre todo en ellas (50 071 al 22 de noviembre), y el plan gratis trae 400 al mes.
