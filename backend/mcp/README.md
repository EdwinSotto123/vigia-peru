# MCP de Vigía (Cloud Run)

Servidor MCP en Python con 3 herramientas de solo lectura: `buscar_alertas`, `riesgo_convocatoria` y `empresa_sancionada`. Su réplica en Cloudflare es `backend/mcp-worker`.

- **Desplegar:** `bash infrastructure/deploy/mcp.sh`, en el proyecto de la entrada (`ENTRADA_PROJECT_ID`).
- **Rol de la base:** `vigia_mcp`, con 15 s por consulta y solo lectura.

## Cambiar de proyecto

| Variable | Valor |
|---|---|
| `PGHOST` | `/cloudsql/<proyecto de la base>:us-central1:vigia-db` (o la IP de PgBouncer si comparte VPC con la VM). Sin ella: `CLOUD_SQL_CONNECTION` o `<proyecto de las credenciales>:us-central1:vigia-db` |
| `PGUSER` y `PGPASSWORD` | `vigia_mcp` y el secreto `cloudsql-password-mcp` |

Si el servicio y la base están en proyectos distintos, la cuenta `vigia-mcp@` necesita `roles/cloudsql.client` en el proyecto de la base. Así quedó el 29/09/2026: MCP en vivid-spot y base en formulab.
