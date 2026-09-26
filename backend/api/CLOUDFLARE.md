# vigia-peru-api en Cloudflare Workers (réplica)

El mismo código corre en dos lados; Cloud Run sigue igual que siempre.

| | Cloud Run (Node) | Workers (`vigia-api`) |
|---|---|---|
| Entrada | `src/index.ts` (@hono/node-server, SIGTERM) | `src/worker.ts` (`export default { fetch }`) |
| App | `src/app.ts` | `src/app.ts` |
| Postgres | 2 pools por proceso (`lib/db.ts`) | pools **por pedido** sobre Hyperdrive (`workers/ambito.ts`) |
| ID tokens de Firebase | firebase-admin | jose + llaves de securetoken, mismos chequeos (`workers/firebase.ts`) |
| GCS | @google-cloud/storage | API JSON + firma v4 local (`workers/gcs.ts`) |
| Credenciales de Google | servidor de metadatos | cuenta de servicio de `GCP_SA_KEY` (`workers/google.ts`) |
| gzip | `hono/compress` | lo hace Cloudflare en el borde |

Lo que cambia entre los dos se registra en `lib/plataforma.ts` desde cada entrada
(`node/plataforma.ts`, `workers/plataforma.ts`): firebase-admin y el SDK de GCS nunca entran en el
bundle del Worker. Las rutas no cambian: `pool`/`poolAdmin` son, en Workers, delegados al pool del
pedido en curso (AsyncLocalStorage), que se abre al primer uso y se cierra con `ctx.waitUntil` al
terminar (esperando antes los refrescos de caché y sondeos en segundo plano).

## Recursos (los crea quien despliega)

Dos configuraciones de Hyperdrive sobre la **misma** base de Cloud SQL, una por rol (migración 37):

| Binding | Rol | Límite en el rol | Id en `wrangler.jsonc` |
|---|---|---|---|
| `HYPERDRIVE` | `vigia_api` | 10 s | `PENDIENTE_HYPERDRIVE_API` |
| `HYPERDRIVE_ADMIN` | `vigia_api_admin` | 120 s | `PENDIENTE_HYPERDRIVE_ADMIN` |

```bash
npx wrangler hyperdrive create vigia-api       --caching-disabled --connection-string "postgres://vigia_api:<clave>@<host>:5432/vigia"
npx wrangler hyperdrive create vigia-api-admin --caching-disabled --connection-string "postgres://vigia_api_admin:<clave>@<host>:5432/vigia"
```

- **Caché de consultas apagado** (`--caching-disabled`): Hyperdrive guarda los SELECT 60 s por
  defecto; la API ya tiene sus cachés y ETags, y el panel lee lo que acaba de escribir.
- Hyperdrive reparte en modo transacción, como PgBouncer: el código ya no manda `options` ni usa
  estado de sesión. El `statement_timeout` sale del rol; `query_timeout` corta del lado del cliente.
- `<host>` tiene que ser alcanzable desde Cloudflare (IP pública de Cloud SQL con SSL o Cloudflare Tunnel).

## Variables (`vars` en `wrangler.jsonc`)

Las de `infrastructure/deploy/api.sh`, sin las de conexión (`PGHOST`, `PGUSER`, `PGUSER_ADMIN`,
`PGDATABASE`, `PG_POOLER`), que reemplaza Hyperdrive:

| Variable | Valor |
|---|---|
| `FIREBASE_PROJECT_ID` | `simplia-project` |
| `GCS_PROJECT_ID` | `vivid-spot-480905-a4` (también es el proyecto del dispatcher) |
| `GCS_BUCKET_DOCUMENTOS` | `vigia-peru-documentos` |
| `GCS_BUCKET_REPORTES` | `vigia-peru-reportes` |
| `ALLOWED_ORIGINS` | los orígenes de api.sh (sumar el del frontend que llame a esta réplica) |
| `LOCAL_DOWNLOADER_URL` | `http://149.104.66.211:8080` (ver "Diferencias") |

Opcionales con el mismo valor por defecto que en Cloud Run: `GCS_BUCKET_PRIVADO`,
`DISPATCHER_REGION`, `DISPATCHER_JOB`, `AGENT_HOST_SUFFIX`, `AGENT_URL_BIENES|SERVICIOS|OBRAS|OTROS`,
`GOOGLE_CLOUD_PROJECT`. Llegan a `process.env` (nodejs_compat, compatibility_date ≥ 2025-04-01),
que es lo que lee el código compartido, también en el nivel superior de los módulos.

## Secretos (`npx wrangler secret put <NOMBRE>`, nunca en el repo)

| Secreto | Qué es |
|---|---|
| `ADMIN_TOKEN` | el mismo valor que `admin-token` de Secret Manager (lo manda el proxy del panel) |
| `GCP_SA_KEY` | llave JSON de una cuenta de servicio de Google |

`GCP_SA_KEY` necesita los permisos que hoy tiene la cuenta de servicio de la API en Cloud Run:
leer los buckets de documentos, lotes y el privado (comprobantes); crear objetos en
`vigia-peru-documentos`/`vigia-peru-reportes` (las URLs firmadas de subida valen con los permisos
de quien firma); `roles/run.invoker` en los 4 servicios de agentes; ejecutar el job
`vigia-dispatcher`. Si la política de la organización prohíbe crear llaves
(`iam.disableServiceAccountKeyCreation`), hay que habilitarla para esa cuenta.

No hacen falta en Workers: `PGPASSWORD`, `PGPASSWORD_ADMIN` (van en la config de Hyperdrive) ni
`GOOGLE_APPLICATION_CREDENTIALS_JSON` (sólo lo usa firebase-admin en Node). `AGENT_ID_TOKEN` sigue
existiendo como atajo de desarrollo.

Sin `GCP_SA_KEY`: las URLs firmadas y el comprobante responden 500 (`internal`, detalle en el log con
el requestId), `POST /admin/dispatcher/run` 502 con el motivo, y los sondeos a los agentes van sin
`Authorization` con un aviso único en el log. El resto de la API no la usa.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars     # ADMIN_TOKEN (y GCP_SA_KEY si hace falta); .dev.vars no se sube
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://usuario:clave@127.0.0.1:5432/vigia?sslmode=disable"
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE_ADMIN="$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
npm run dev:worker                 # wrangler dev en :8802
```

| Script | |
|---|---|
| `npm run typecheck` / `typecheck:worker` | tipos de Node / de Workers |
| `npm test` | pruebas de firma y tokens (`test/`), sin red |
| `npm run build:worker` | `wrangler deploy --dry-run --outdir .wrangler-dist` (bundle, no despliega) |

Wrangler no está entre las dependencias (el build de Cloud Run no lo necesita): se usa con `npx wrangler` (4.141 o más nuevo).

## Diferencias con Cloud Run

- **Relay por IP**: Workers no hace `fetch` a una IP pelada (error 1003). El sondeo del relay en
  `/admin/operacion` y `/admin/salud` lo va a dar caído hasta que `LOCAL_DOWNLOADER_URL` sea un nombre
  DNS (un registro A hacia la VPS). Sólo afecta a ese indicador del panel.
- **Cachés en memoria**: una por isolate, con más isolates y más cortos que las instancias de Cloud
  Run. La invalidación entre instancias (`ajustes.cache_gen`) funciona igual.
- **Conexiones**: hasta 3 (público) + 2 (panel) por pedido; Workers deja 6 abiertas a la vez contando
  los fetch. Las consultas en paralelo de un mismo pedido por encima de eso esperan turno.
- **Respuestas sin cuerpo** (204 de CORS, 304 por ETag): sin `Content-Type` (Node agrega `text/plain`).
- **CPU**: el plan gratuito da 10 ms de CPU por pedido; las listas grandes (serializar cientos de KB)
  lo pasan. Hace falta el plan pago (30 s por defecto, `limits.cpu_ms` para subirlo).
- **Latencia**: cada consulta viaja del borde a us-central1. Smart Placement (`"placement": { "mode": "smart" }`)
  acerca el Worker a la base; no está activado.
