# vigia-r2-sync (Cloudflare)

Copia cada hora (cron `17 * * * *`) los buckets de GCS a R2 y verifica cada archivo por tamaño y MD5. GCS sigue siendo la fuente y la réplica no borra nada.

| Endpoint | Qué hace |
|---|---|
| `POST /sincronizar?bucket=<nombre>&max=<n>` | copia lo nuevo o cambiado de ese bucket |
| `GET /verificar?bucket=<nombre>` | compara GCS y R2 |

Los dos piden `Authorization: Bearer SYNC_TOKEN` (en AWS SSM `/vigia/r2/sync-token`).

`GET /objeto?bucket=<nombre>&key=<ruta>` devuelve un archivo de la réplica, con su propio token de sólo lectura
(`LECTOR_TOKEN`, en SSM `/vigia/r2/lector-token`). Lo usan los agentes con `ALMACEN_DOCS=r2`
(`backend/agent/tools/documentos/fetch.py`) para leer los `gs://` sin pasar por GCS. `vigia-peru-batch` (los
documentos de los expedientes) se replica desde el 2026-10-15.

## Cambiar de proyecto

Los buckets se identifican por nombre (`src/`, `BUCKETS`), no por proyecto.

- **Si los buckets se mudan de proyecto** (`BUCKETS_PROJECT_ID`): cambiar `GCP_SA_KEY` por la llave de una cuenta con lectura en los buckets nuevos (`wrangler secret put GCP_SA_KEY`). Si también cambian de nombre, actualizar los nombres en `src/`.
- **Si los buckets no se mudan** (hoy siguen en `vivid-spot-480905-a4`), no hay que tocar nada.
- **Despliegue:** `npx wrangler deploy`.
