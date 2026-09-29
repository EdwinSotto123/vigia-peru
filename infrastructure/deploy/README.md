# Scripts de despliegue

Todos leen los proyectos de `_common.sh`. Ninguno tiene un proyecto fijo.

| Variable | Qué es | Hoy |
|---|---|---|
| `PROJECT_ID` | Plataforma: base, agentes, IA, PgBouncer + túnel, scrapers, ingesta | `project-a974c6e5-0cdf-4b11-a86` |
| `ENTRADA_PROJECT_ID` | Entrada pública: Firebase Hosting y Cloud Run web, API y MCP | `vivid-spot-480905-a4` |
| `BUCKETS_PROJECT_ID` | Buckets `vigia-peru-*` | `vivid-spot-480905-a4` |
| `CUENTA`, `CUENTA_ENTRADA` | Cuentas de gcloud, si cada proyecto es de una cuenta distinta | opcionales |

En un solo proyecto, las tres variables de proyecto tienen el mismo valor. Mudarse: `migracion/README.md`.

| Script | Qué despliega | Proyecto |
|---|---|---|
| `agentes.sh` | Los 4 servicios de agentes (actualiza código) | `PROJECT_ID` |
| `pgbouncer.sh crear\|actualizar` | VM de PgBouncer + `cloudflared` | `PROJECT_ID` |
| `cloud-scrapers.sh [fuente]` | Scrapers: Job + Scheduler (`backend/cloud_functions/*/cloudbuild.yaml`) | `PROJECT_ID` |
| `ingest-job.sh` | Job `vigia-ingest` | `PROJECT_ID` |
| `batch-nocturno.sh` | Descarga local + subida + ingesta (corre en la PC) | `PROJECT_ID` |
| `cloudflare-base.sh tunel\|hyperdrive` | Túnel y configuraciones de Hyperdrive | `PROJECT_ID` (secretos) |
| `api.sh`, `mcp.sh`, `frontend.sh` | Cloud Run de la entrada (conectan a la base y los agentes de `PROJECT_ID`) | `ENTRADA_PROJECT_ID` |
| `hosting.sh` | Firebase Hosting `vigia-peru.web.app` | `ENTRADA_PROJECT_ID` |
| `cuentas-servicio.sh` | Cuentas por componente | el que se pase en `PROJECT_ID` |
| `dispatcher.sh`, `agent.sh` | Históricos: el dispatcher de Cloud Run quedó reemplazado por el de Cloudflare | `PROJECT_ID` |

Ejemplo con cuentas distintas:

```bash
CUENTA=<cuenta-plataforma> CUENTA_ENTRADA=<cuenta-entrada> bash infrastructure/deploy/api.sh
```

`_common.sh` fija el proyecto de gcloud solo para el script (`CLOUDSDK_CORE_PROJECT`), sin tocar la configuración de la máquina.
