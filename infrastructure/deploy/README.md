# Scripts de despliegue

Separados por proveedor. Qué corre dónde lo decide `infrastructure/proveedores.env` (banderas `GCP_USE` y
`GCP_USE_<COMPONENTE>`); el detalle está en `docs/PROVEEDORES.md`. La API, la web y los agentes se despliegan a
producción desde GitLab, con los jobs manuales de `.gitlab-ci.yml`; estos scripts son para lo demás y para la PC.

```
deploy/
├─ desplegar.sh      ← producción: `bash infrastructure/deploy/desplegar.sh <componente>` (lee las banderas)
├─ dev.sh            ← DEV: copia de trabajo a los Workers -dev y vigia-db-dev (docs/DEV.md)
├─ _common.sh        ← variables compartidas (los proyectos de GCP, legado)
├─ correo_resend.py  ← el correo de Gobserva por Resend
├─ cloudflare/       ← lo de hoy
│  ├─ worker.sh      ← un Worker a producción desde lo commiteado (api, mcp, scrapers, llm, precios, relay, r2-sync, dispatcher, precios-lab)
│  ├─ web.sh         ← vigia-web: build local de OpenNext y deploy con wrangler
│  ├─ base.sh        ← túnel de Cloudflare, servicio VPC e Hyperdrive hacia PgBouncer
│  └─ gobserva-redirect/ ← la portada de gobserva.cloud
├─ aws/
│  ├─ agentes.sh     ← crea o configura una Lambda de agentes con una imagen de ECR
│  ├─ gitlab_oidc.sh ← el rol que asumen los jobs de GitLab, sin llaves guardadas
│  └─ relay_lima.py  ← el relay de Lima (EC2 en la Local Zone de Lima, de respaldo)
└─ gcp/              ← legado: lo de GCP, sin facturación (sólo con GCP_USE=true)
   ├─ api.sh, frontend.sh, mcp.sh, agentes.sh, dispatcher.sh, cloud-scrapers.sh
   ├─ pgbouncer.sh, egreso-fijo.sh, cuentas-servicio.sh, hosting.sh, ingest-job.sh, batch-*.sh, scrapers-job.sh
   ├─ agent.sh, agente-ab.sh (históricos)
   └─ migracion/     ← mudar todo de un proyecto de GCP a otro
```

Producción despliega **lo commiteado**: `cloudflare/worker.sh` se niega si la carpeta tiene cambios, y los jobs de GitLab
arman lo que está en `main`. `cloudflare/web.sh` hace el build en la PC, con lo que haya en `frontend/`: no lo corras con
un `next dev` abierto (comparten `.next`). DEV despliega la copia de trabajo.

## Legado: proyectos de GCP (`_common.sh`)

GCP está sin facturación: sus buckets responden 403 desde el 2026-11-06 y Cloud Build no corre. Los scripts de `gcp/`
leen los proyectos de `_common.sh`; ninguno tiene un proyecto fijo.

| Variable | Qué era |
|---|---|
| `PROJECT_ID` | Plataforma: agentes, IA, PgBouncer, scrapers, ingesta |
| `ENTRADA_PROJECT_ID` | Entrada pública: Firebase Hosting y Cloud Run web, API y MCP |
| `BUCKETS_PROJECT_ID` | Buckets `vigia-peru-*` (hoy sus copias están en R2) |
| `BUILD_PROJECT_ID` | Cloud Build del build de la web |
| `CUENTA`, `CUENTA_ENTRADA` | Cuentas de gcloud, si cada proyecto es de una cuenta distinta |

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
