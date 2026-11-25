# vigia-web en Cloudflare Workers

El sitio (`frontend/`, Next.js 14.2) corre como el Worker `vigia-web` con OpenNext. Es su único despliegue: Cloud Run y
Firebase Hosting quedaron como legado (`infrastructure/hosting/README.md`). El dominio público es
`vigia.gobserva.cloud`; lo que entra por `vigia-web.vigiaperu.workers.dev` se redirige ahí.

- Adaptador: `@opennextjs/cloudflare` **1.15.1**, fijo. Es el último que acepta Next 14 (desde 1.16 exige Next 15). No
  subirlo sin migrar Next.
- Archivos: `wrangler.jsonc`, `open-next.config.ts` y las entradas del Worker: `worker-prod.js` (producción),
  `worker-dev.js` (DEV) y `worker-comun.js` (lo que comparten).

## La entrada de producción (`worker-prod.js`)

Envuelve el build de OpenNext sin cambiar el código de la web:

- Redirige `vigia-web.vigiaperu.workers.dev` al dominio: en `*.workers.dev` no hay WAF ni límites de la zona.
- Reenvía `/v1/…` a la API con la IP de quien pide (`x-vigia-ip`). La API sólo atiende a nuestros Workers.
- Cuenta 300 páginas por minuto por IP con el Durable Object `Limitador` de `vigia-api` (binding `LIMITADOR`). Los
  prefetch de Next no cuentan.
- Veta una hora a la IP que pide la trampa: un enlace escondido a una ruta que `robots.txt` prohíbe.
- No deja que `/cdn-cgi/…` llegue al build de OpenNext.

Los productos de Gobserva entran por sus subdominios al mismo Worker; los reparte `middleware.ts`.

## Comandos

```bash
npm run cf:build     # next build + el Worker en .open-next/
npm run cf:preview   # el Worker en local (workerd): http://localhost:8788
npm run cf:deploy    # build + deploy (necesita `wrangler login` o CLOUDFLARE_API_TOKEN)
```

Producción se despliega desde GitLab: el job manual `deploy:web:prod` arma el Worker con `scripts/fetch-build.cjs` y la
variable secreta `VIGIA_BUILD_TOKEN` (así prerenderiza con datos) y corre `opennextjs-cloudflare deploy`. Desde la PC,
`bash infrastructure/deploy/cloudflare/web.sh` hace un build local; no lo corras con un `next dev` abierto, porque
comparten `.next`.

`cf:build` toma los `NEXT_PUBLIC_*` de Firebase de `.env.production` en la PC; en el CI, de las variables del proyecto.
En Windows funciona (OpenNext avisa que prefiere Linux).

## Bindings y variables (`wrangler.jsonc`)

| Binding | Qué es |
|---|---|
| `ASSETS` | los estáticos de `.open-next/assets` |
| `IMAGES` | `/_next/image` con Cloudflare Images |
| `NEXT_INC_CACHE_R2_BUCKET` | la caché de páginas en R2 (`vigia-web-cache`) |
| `MEDIOS` | R2 `vigia-peru-reportes`: lo público, servido en `medios.gobserva.cloud` |
| `PRIVADO` | R2 `vigia-peru-privado`: los comprobantes |
| `DOCUMENTOS` | R2 `vigia-peru-documentos`: lo que sube «Analizar» del panel |
| `WORKER_SELF_REFERENCE` | la revalidación ISR: el Worker se pide a sí mismo la página vencida |
| `LIMITE_SUBIDAS` | 10 subidas por IP cada 60 s en `/api/upload` |
| `LIMITADOR` | el Durable Object de `vigia-api` que cuenta las páginas por IP |

`placement` es `aws:us-east-2`, junto a la API y la base.

Variables (`vars`, no son secretas):

- `VIGIA_API_URL`: la API.
- `AGENT_URL_BIENES`, `_SERVICIOS`, `_OBRAS`, `_CONSULTORIA` y `_OTROS`: las Lambdas de agentes, una por red. Las usa
  «Analizar» del panel (`app/api/agent/_orquestador.ts`).
- `OECE_RELAY_URL`: el relay hacia el OECE.
- `DOCS_BUCKET`, `REPORTES_BUCKET` y `GCS_BUCKET_PRIVADO`: nombres de bucket que `lib/gcs.ts` traduce a su binding de R2.
- Legado: `VIGIA_AGENT_URL` y `GOOGLE_CLOUD_PROJECT` (el orquestador de Cloud Run). Sólo se usan si no hay Lambdas.

Secretos, una vez por entorno (`npx wrangler secret put NOMBRE`):

| Secreto | Qué es |
|---|---|
| `ADMIN_TOKEN` | el token de servicio del panel hacia la API |
| `ADMIN_EMAILS` | los administradores principales |
| `ADMIN_SESSION_SECRET` | la llave que firma la cookie de sesión del panel |
| `TURNSTILE_SECRET_KEY` | el captcha de los formularios |
| `AGENTE_TOKEN` | la llave para llamar a las Lambdas de agentes |

`GCP_SA_KEY` es legado: firmaba los tokens de Cloud Run y de Cloud Storage. Con las Lambdas y R2 no hace falta.

Del build (se fijan al compilar y van al navegador):

- `NEXT_PUBLIC_SITE_URL=https://vigia.gobserva.cloud`: enlaces para compartir e imágenes Open Graph.
- `NEXT_PUBLIC_VIGIA_API_URL`: la API.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y los `NEXT_PUBLIC_FIREBASE_*`: claves públicas de cliente.

En local, `.dev.vars` (ignorado por git) pisa variables y pone secretos de prueba para `cf:preview`.

## Qué cambia respecto de Node

- **Archivos**: en Workers van a R2 por binding (`lib/gcs.ts`). Fuera de Workers queda el camino viejo de Cloud Storage,
  que ya no responde (GCP está sin facturación).
- **Caché de páginas**: en R2 (`vigia-web-cache`), compartida por todas las instancias, con una capa regional (Cache API
  de cada punto) delante. Va por build: un despliegue nuevo no sirve páginas del anterior. `cf:deploy` sube lo
  prerenderizado.
- **Compresión**: la hace el borde de Cloudflare; las rutas que comprimían a mano no lo hacen en Workers (saldría gzip
  dentro de gzip).
- **Imágenes**: `/_next/image` usa el binding `IMAGES`.
- **Ícono y tarjetas Open Graph**: runtime Node (OpenNext no corre rutas `edge`). Con `next dev` o `next start` en
  Windows se sirve el logo fijo (`lib/imagen-fija-windows.ts`), por un bug de `next/og` con las rutas de Windows.

## Límites

- Tamaño: ~2,5 MB comprimido (tope 3 MB en el plan gratis, 10 MB en el pago).
- CPU: renderizar Next pasa los 10 ms por pedido del plan gratis; hace falta el plan pago.
- `/api/agent/analyze` (sin stream) espera la respuesta entera del agente; la UI usa `/api/agent/analyze/stream`, que
  manda bytes mientras corre.

## DEV

`env.dev` de `wrangler.jsonc` es el Worker `vigia-web-dev`: entra por `worker-dev.js` (usuario y clave, noindex y una
franja DEV), habla con `vigia-api-dev` y tiene su propia caché (`vigia-web-cache-dev`). Los buckets `MEDIOS` y
`PRIVADO` son los mismos de producción. Detalle en `docs/DEV.md`.

## Legado: build en Cloud Build

`USAR_CLOUD_BUILD=1 bash infrastructure/deploy/cloudflare/web.sh` hacía el `next build` en Cloud Build
(`frontend/cloudbuild-cf.yaml`) y desplegaba desde la PC. No anda mientras GCP siga sin facturación.
