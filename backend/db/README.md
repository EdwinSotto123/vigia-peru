# Base de datos (Cloud SQL, Postgres 16)

- **Migraciones:** `migrations/` (`01_extensions.sql` a `37_roles.sql`). Se aplican en orden con `python backend/db/apply_all.py`.
- **Roles (migración 37):**

| Rol | Uso |
|---|---|
| `vigia_api` | API pública |
| `vigia_api_admin` | panel |
| `vigia_mcp` | MCP, solo lectura |
| `vigia_dispatcher` | dispatcher |
| `vigia_jobs` | scrapers e ingesta; dueño de las tablas de datasets |

`postgres` queda para agentes y migraciones. Las contraseñas están en los secretos `cloudsql-password*`.

- **Snapshot y restauración:** `snapshot/README.md`. El export de Cloud SQL no trae roles, dueños ni privilegios por defecto; `snapshot/globales.py` los guarda aparte.

## Cambiar de proyecto

La instancia es `vigia-db`, en `PROJECT_ID` (`infrastructure/deploy/_common.sh`). Hoy es `project-a974c6e5-0cdf-4b11-a86` (IP pública: `ip_cloud_sql` en `_common.sh`).

- **Crearla:** `terraform apply` (`infrastructure/terraform/cloud_sql.tf`) o la fase `base` de `infrastructure/deploy/migracion/migrar-proyecto.sh`. Esa fase también copia los datos, compara las dos bases y pone las contraseñas.
- **Quién se conecta y cómo:**

| Quién | Cómo |
|---|---|
| Agentes y jobs | socket `/cloudsql/<proyecto>:us-central1:vigia-db` |
| API y MCP de Cloud Run | el mismo socket; en otro proyecto, `roles/cloudsql.client` en este |
| Workers de Cloudflare | Hyperdrive → túnel `vigia-db` → VM de PgBouncer → este mismo conector |
| PC del batch | IP pública con la IP en `authorized-networks` (`ip_cloud_sql` en `_common.sh`) |
