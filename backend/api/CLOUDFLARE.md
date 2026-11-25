# vigia-api en Cloudflare Workers

El detalle del Worker `vigia-api`: cómo atiende, sus bindings, variables y secretos, y cómo correrlo en tu PC. Qué hace
la API y cómo se despliega: [README.md](README.md).

## Cómo atiende un pedido

1. `src/worker.ts` corta lo que viene de internet sin permiso (`cerradaAlPublico`, en `lib/antibots.ts`).
2. Las lecturas públicas salen de la caché del borde si están (`src/workers/cdn.ts`). La cabecera `X-Vigia-Cdn` dice
   `HIT`, `STALE` o `MISS`.
3. Cada pedido corre en su ámbito (`src/workers/ambito.ts`): abre sus pools de Postgres al primer uso, sobre
   `HYPERDRIVE` o `HYPERDRIVE_ADMIN`, y los cierra con `ctx.waitUntil` cuando ya respondió.
4. Lo propio de Workers se registra en `src/workers/plataforma.ts`. Por ejemplo, los tokens de Firebase se verifican
   con `jose` (`src/workers/firebase.ts`).

El Worker corre junto a la base (`"placement": { "region": "aws:us-east-2" }`). Medido el 2026-10-20: unos 17 ms por
consulta, frente a unos 177 ms con la ubicación anterior.

## La base

PostgreSQL en AWS RDS (us-east-2). No acepta conexiones de internet. El Worker llega por Hyperdrive, que pasa por un
servicio de Workers VPC y un túnel de Cloudflare hasta PgBouncer, en el proxy de EC2, y de ahí a RDS.

| Binding | Rol | Límite por sentencia |
|---|---|---|
| `HYPERDRIVE` | `vigia_api` (rutas públicas) | 10 s |
| `HYPERDRIVE_ADMIN` | `vigia_api_admin` (panel y crons) | 120 s |

- Las dos configuraciones de Hyperdrive tienen el caché de consultas apagado: la API ya tiene sus cachés, y el panel lee
  lo que acaba de escribir.
- Hyperdrive reparte en modo transacción, como PgBouncer: el código no usa estado de sesión. El `statement_timeout` sale
  del rol.
- El entorno `dev` usa otras dos configuraciones, contra la base `vigia-db-dev`.

## Bindings (`wrangler.jsonc`)

| Binding | Qué es | Para qué |
|---|---|---|
| `DOCUMENTOS` | R2 `vigia-peru-batch` | documentos de los expedientes y requerimientos de los contratos menores (`routes/menores.ts`) |
| `PRIVADO` | R2 `vigia-peru-privado` | comprobantes de aportes y pagos; sólo el panel |
| `DOCUMENTOS_VIEJOS` | R2 `vigia-peru-documentos` | comprobantes guardados con la ruta de antes |
| `DISPATCHER` | Worker `vigia-dispatcher` | «correr el dispatcher ahora» (`lib/dispatcher.ts`) |
| `SEACE_ZRH` | Worker `vigia-seace-zrh` | el expediente SIAF de una orden, a pedido (`routes/ordenes.ts`) |
| `LLM` | Worker `vigia-llm` | los modelos (chat, asistente, lectura de bases de plazas) |
| `MCP` | Worker `vigia-mcp` | las herramientas del MCP para el chat del panel (`routes/admin_chat.ts`) |
| `PRECIOS_LAB` | Worker `vigia-precios-lab` | el laboratorio de precios del panel (`routes/admin_precios.ts`) |
| `RELAY_LIMA` | servicio de Workers VPC | salida con IP peruana (`backend/relay-lima`): bases del Poder Judicial (`lib/basesPlaza.ts`) |
| `LIMITADOR` | Durable Object `Limitador` | límites por IP y créditos del MCP (`src/workers/limitador.ts`) |
| `CHAT_INFORME` | Durable Object `ChatInforme` | un informe del chat de investigación (`src/workers/chatInforme.ts`) |
| `AI` | Workers AI | embeddings de `@cf/baai/bge-m3` para el RAG de documentos (`lib/rag.ts`) |

Un Worker no puede llamar por su URL pública a otro `workers.dev` de la misma cuenta (error 1042). Por eso el
dispatcher, el MCP y los demás van por service binding.

La web (`frontend/wrangler.jsonc`) y el MCP usan la misma clase `Limitador` con `script_name: "vigia-api"`.

## Variables (`vars` en `wrangler.jsonc`)

| Variable | Para qué |
|---|---|
| `ALLOWED_ORIGINS` | orígenes permitidos por CORS |
| `WORKERS_PROPIOS` | zonas de nuestros Workers (cabecera `CF-Worker`): sus pedidos pasan y no cuentan en el límite por IP |
| `TURNSTILE_HOSTS` | dónde se resuelve el captcha; con `TURNSTILE_HOSTS_ESTRICTO=si`, otro host se rechaza |
| `FIREBASE_PROJECT_ID` | el proyecto de Firebase de las cuentas de Vigía |
| `COGNITO_GOBSERVA` | los grupos de Cognito de cada app: `app\|grupo\|cliente,…` (ids públicos) |
| `GOBSERVA_CUENTAS_VIGIA` | qué puede pedir una cuenta de Vigía en `/gobserva/cuenta` |
| `MCP_INTERNO_URL` | la URL del MCP que se pide por el binding `MCP` |
| `DISPATCHER_URL` | respaldo del binding `DISPATCHER` |
| `LOCAL_DOWNLOADER_URL` | el relay de descargas, `vigia-relay` (`backend/relay-worker`) |
| `VAPID_PUBLIC_KEY` | la llave pública de las notificaciones push |
| `GCS_*`, `AGENT_HOST_SUFFIX` | de cuando la API corría en Google Cloud (ver README.md) |

Llegan además a `process.env` (con `nodejs_compat`), que es lo que lee el código compartido.

`GOBSERVA_COBROS` no está en `wrangler.jsonc`: sin ella, los cobros siguen en pausa.

## Secretos

Se cargan con `npx wrangler secret put <NOMBRE>` (y `--env dev` para DEV). Nunca van al repo.

| Secreto | Para qué |
|---|---|
| `ADMIN_TOKEN` | el panel y los crons (`x-admin-token`) |
| `BUILD_TOKEN` | el build de la web en el CI (`x-vigia-build`) |
| `PRIVACIDAD_CLAVE` | las referencias opacas de DNI y RUC 10 (`lib/privacidad.ts`) |
| `TURNSTILE_SECRET_KEY` | el captcha de las escrituras públicas |
| `LLM_TOKEN` | el token de `vigia-llm` |
| `MCP_INTERNO_TOKEN` | la cabecera con que el MCP acepta al equipo en el chat del panel |
| `DISPATCHER_TOKEN` | `POST /ejecutar` de `vigia-dispatcher` |
| `SEACE_ZRH_TOKEN` | el token de `vigia-seace-zrh` |
| `RELAY_LIMA_TOKEN` | el token del relay de Lima |
| `VAPID_PRIVATE_KEY` | la llave privada de las notificaciones push |
| `RESEND_API_KEY` | el correo; sin él, va por la Lambda de correo (`CORREO_URL`, `CORREO_TOKEN`) |
| `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` | Mercado Pago (en DEV, los de la cuenta de prueba) |
| `GCP_SA_KEY` | sólo para leer GCS o llamar a Cloud Run (legado) |

## En tu PC

```bash
cd backend/api
cp .dev.vars.example .dev.vars      # ADMIN_TOKEN de desarrollo; .dev.vars no se sube
python infrastructure/aws/tunel_rds.py dev     # en otra terminal, desde la raíz: la base DEV en 127.0.0.1:15433
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://<usuario>:<clave>@127.0.0.1:15433/vigia?sslmode=require"
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE_ADMIN="$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
npm run dev:worker                  # wrangler dev en el puerto 8802
```

`wrangler` no está entre las dependencias: se usa con `npx`. El CI fija la versión (`wrangler@4.151.0`).

## Cosas que conviene saber

- **Cachés en memoria:** una por isolate. La invalidación entre isolates va por `ajustes.cache_gen`.
- **Respuestas sin cuerpo** (204 de CORS, 304 por ETag): salen sin `Content-Type`.
- **CPU:** las listas grandes necesitan el plan pago de Workers.
- **Crons:** los dispara `scheduled` en `src/worker.ts`, con un pedido interno a `/admin/*` y el `ADMIN_TOKEN`. En
  `dev` no hay crons.
