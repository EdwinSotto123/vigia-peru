# vigia-r2-sync

El Worker `vigia-r2-sync`, en Cloudflare Workers. Hace dos cosas:

1. **Sirve archivos de R2** a quien no es un Worker (`GET /objeto`). Es lo que usan hoy los agentes y los lectores para
   leer los documentos de los expedientes.
2. **Copia los buckets de GCS a R2** cada hora (cron `17 * * * *`) y verifica cada archivo por tamaño y MD5. Viene de
   cuando convivían las dos nubes: GCS era la fuente y la réplica no borra nada. Desde el 2026-11-06 GCP está sin
   facturación; lo nuevo ya se escribe directo en R2 (por ejemplo, la fuente `documentos` de `vigia-scrapers`).

## Rutas

| Ruta | Token | Qué hace |
|---|---|---|
| `GET /objeto?bucket=<nombre>&key=<ruta>` | `LECTOR_TOKEN` (sólo lectura) | devuelve el archivo tal cual desde R2 |
| `POST /sincronizar?bucket=<nombre>&max=<n>` | `SYNC_TOKEN` | copia de GCS lo nuevo o cambiado de ese bucket |
| `GET /verificar?bucket=<nombre>` | `SYNC_TOKEN` | compara GCS y R2 objeto por objeto |

Los tokens van en `Authorization: Bearer`.

**Quién usa `/objeto`:** los agentes con `ALMACEN_DOCS=r2` (`R2_LECTOR_URL` y `R2_LECTOR_TOKEN`, que pone
`infrastructure/deploy/aws/agentes.sh`; código en `backend/agent/tools/documentos/fetch.py`) y la lectura de documentos
(`backend/lector/base.py`).

## Buckets (bindings de R2)

| Binding | Bucket |
|---|---|
| `B_DOCUMENTOS` | `vigia-peru-documentos` |
| `B_PRIVADO` | `vigia-peru-privado` |
| `B_REPORTES` | `vigia-peru-reportes` |
| `B_RAG` | `vigia-peru-rag` |
| `B_BATCH` | `vigia-peru-batch` (los documentos de los expedientes) |

## Secretos

`npx wrangler secret put <NOMBRE>`:

- `LECTOR_TOKEN`: la lectura de `/objeto` (copia en SSM `/vigia/r2/lector-token`).
- `SYNC_TOKEN`: `/sincronizar` y `/verificar` (copia en SSM `/vigia/r2/sync-token`).
- `GCP_SA_KEY`: una cuenta de Google con lectura en los buckets de GCS (sólo para la copia).

## Desplegar

`bash infrastructure/deploy/cloudflare/worker.sh r2-sync`, desde la raíz del repo. Se niega si la carpeta tiene cambios
sin commitear. Para revisar tipos: `npm ci && npm run typecheck`. No hay pruebas automáticas.
