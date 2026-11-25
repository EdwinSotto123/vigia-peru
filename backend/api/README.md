# vigia-api

La API de Vigía y de las apps de Gobserva (Empleo, Licitaciones, Obras y Salud). Es una app de Hono que corre en
Cloudflare Workers: el Worker `vigia-api`, con entrada en `src/worker.ts` y las rutas en `src/app.ts`.

La base es PostgreSQL 16 en AWS RDS (con PostGIS, pgvector y pg_trgm). El Worker llega a ella por Hyperdrive.

Bindings, variables, secretos y desarrollo local: [CLOUDFLARE.md](CLOUDFLARE.md).

## Quién la usa

La API no atiende a internet. Sólo responde a nuestros Workers (`lib/antibots.ts`, `cerradaAlPublico`):

- la web (`frontend`), desde su servidor;
- el MCP (`backend/mcp-worker`), por service binding;
- el build de la web en el CI, con la cabecera `x-vigia-build` (secreto `BUILD_TOKEN`);
- sus propios crons.

Siempre abiertas: `/`, `/health`, `/livez` y el aviso de Mercado Pago (`POST /pagos/mercadopago/webhook`, que exige
su firma). Lo demás desde internet responde 403 (`api_privada`). Con `API_PUBLICA=si` se vuelve a abrir.

Las rutas existen sin prefijo y bajo `/v1`.

## Qué hace

- **Datos de Vigía:** contratos, entidades, empresas, personas, señales, órdenes, planillas, visitas, informes de
  control, normas y lo demás (`src/routes`).
- **Cuentas:** tokens de Firebase (cuentas de Vigía) y de AWS Cognito (cuentas de las apps de Gobserva), verificados
  con `jose` (`lib/auth.ts`, `lib/cognito.ts`).
- **Gobserva:** planes, alertas, recordatorios y créditos del MCP (`lib/gobservaPlanes.ts`, `lib/creditosMcp.ts`).
  Los cobros están en pausa desde el 24 de noviembre de 2026: toda cuenta con el correo verificado tiene el acceso
  abierto (`cobrosEnPausa`). `GOBSERVA_COBROS=activos` vuelve a vender.
- **Límites por IP:** el Durable Object `Limitador` (`src/workers/limitador.ts`), uno por clave. Lo comparten la web
  y el MCP.
- **Chat de investigación:** cada informe corre en el Durable Object `ChatInforme` (`src/workers/chatInforme.ts`) y
  sigue aunque se cierre la pestaña.
- **Panel:** rutas `/admin/*`, con `x-admin-token` (`ADMIN_TOKEN`).
- **Caché del borde:** las lecturas públicas se guardan en la caché de Cloudflare según su `s-maxage`
  (`src/workers/cdn.ts`).

## Crons (`wrangler.jsonc`)

| Cron (UTC) | Hora de Lima | Qué hace |
|---|---|---|
| `*/10 * * * *` | cada 10 min | reasigna aportes abiertos y refresca el financiamiento (`/admin/asignar`) |
| `0 12 * * *` | 07:00 | tareas de Gobserva: alertas, recordatorios y vencimientos (`/admin/gobserva/tareas`) |
| `*/20 5-10 * * *` | 00:00 a 05:40 | recolector de bases de las plazas CAS (`/admin/empleo/noche`) |

## Probar

```bash
cd backend/api
npm ci
npm test                    # node --import tsx --test test/*.test.ts
npx tsc --noEmit            # tipos (lo mismo que corre el CI)
npm run typecheck:worker    # tipos del Worker (tsconfig.worker.json)
npm run build:worker        # arma el bundle sin desplegar (.wrangler-dist)
```

El job `verificar:api` de `.gitlab-ci.yml` corre `npx tsc --noEmit` y `npm test` en cada push a `main` o `dev` que
toca `backend/api`.

Para probar con datos reales antes del commit está DEV: `bash infrastructure/deploy/dev.sh api` despliega la copia de
trabajo en `vigia-api-dev`, contra la base `vigia-db-dev` (`docs/DEV.md`).

## Desplegar

- **Desde la PC:** `bash infrastructure/deploy/cloudflare/worker.sh api`. Se niega si `backend/api` tiene cambios sin
  commitear. Sube una versión y la activa al 100 %. Para volver a la anterior: `npx wrangler versions deploy <id>@100% -y`
  desde `backend/api`.
- **Desde GitLab:** el job manual `deploy:api:prod` en `main` (`wrangler deploy`). En `dev`, `deploy:api:dev` despliega
  `vigia-api-dev` solo con cada push.

## Lo que queda de Google Cloud

Antes la API corría en Cloud Run. Quedan rastros en el código:

- `src/index.ts`, `src/node/` y el `Dockerfile`: la entrada de Node (`npm run dev`, `npm start`). No se despliega.
- `GCP_SA_KEY` y las variables `GCS_*`, `AGENT_HOST_SUFFIX`, `DISPATCHER_REGION` y `DISPATCHER_JOB`: sirven para leer
  GCS y llamar a Cloud Run. Desde el 2026-11-06 GCP está sin facturación: los comprobantes y el bucket viejo de
  documentos se leen de R2 (`PRIVADO`, `DOCUMENTOS_VIEJOS`), y el dispatcher se llama por service binding.
