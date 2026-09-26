# Réplica en Cloudflare Workers

El mismo frontend (Next.js 14.2) corre también como worker `vigia-web`
(`https://vigia-web.vigiaperu.workers.dev`) con OpenNext. Cloud Run no cambia:
`infrastructure/deploy/frontend.sh` sigue siendo el deploy de siempre.

- Adaptador: `@opennextjs/cloudflare` **1.15.1**, fijo. Es el último que acepta Next 14
  (desde 1.16 exige Next 15). No subirlo sin migrar Next.
- Archivos: `wrangler.jsonc`, `open-next.config.ts`, `cloudflare/cache-memoria.ts`.

## Comandos

```bash
npm run cf:build     # next build + bundle del worker en .open-next/
npm run cf:preview   # el worker en local (workerd): http://localhost:8788
npm run cf:deploy    # build + deploy (necesita `wrangler login` o CLOUDFLARE_API_TOKEN)
```

`cf:build` usa `.env.production` (los `NEXT_PUBLIC_*` de Firebase), igual que Cloud Run.
En Windows funciona (OpenNext avisa que prefiere Linux); para producción, mejor Linux o CI.

## Variables

En `wrangler.jsonc` (`vars`, no son secretas): `VIGIA_API_URL`, `VIGIA_AGENT_URL`,
`GOOGLE_CLOUD_PROJECT`, `DOCS_BUCKET`, `REPORTES_BUCKET`, `GCS_BUCKET_PRIVADO`,
`OECE_RELAY_URL`. Opcionales: `VIGIA_CACHE_MAX_MB` (24 por defecto), `AGENT_ID_TOKEN`.

Secretos, una vez por cuenta (`npx wrangler secret put NOMBRE`):

| Secreto | Qué es |
|---|---|
| `ADMIN_TOKEN` | el mismo de Cloud Run (`admin-token`) |
| `ADMIN_EMAILS` | el mismo de Cloud Run (`admin-emails`) |
| `ADMIN_SESSION_SECRET` | el mismo de Cloud Run (`admin-session-secret`) |
| `GCP_SA_KEY` | llave JSON de `vigia-frontend@…`: firma los ID tokens del orquestador y los tokens de Cloud Storage |

En Workers no hay servidor de metadatos ni credenciales por defecto de Google: sin
`GCP_SA_KEY`, las subidas a GCS fallan y el orquestador (IAM-only) responde 403. La cuenta
necesita los mismos permisos que en Cloud Run (`run.invoker` en los agentes, escritura en
los buckets).

Del build (se fijan al compilar, van al navegador):

- `NEXT_PUBLIC_SITE_URL=https://vigia-web.vigiaperu.workers.dev`: URLs de Open Graph.
- `NEXT_PUBLIC_VIGIA_API_URL`: la API que llama el navegador. Sin ella, el navegador sigue
  usando la API de Cloud Run (la URL fija de `lib/api-client.ts`).

```bash
NEXT_PUBLIC_SITE_URL=https://vigia-web.vigiaperu.workers.dev \
NEXT_PUBLIC_VIGIA_API_URL=https://vigia-api.vigiaperu.workers.dev npm run cf:build
```

En local, `.dev.vars` (ignorado por git) pisa variables y pone secretos de prueba, por
ejemplo `VIGIA_API_URL` apuntando a la API de Cloud Run. `STORAGE_EMULATOR_HOST` apunta
GCS a un emulador, como en `@google-cloud/storage`.

## Qué cambia respecto de Cloud Run

- **Credenciales de Google**: `lib/cuenta-google.ts` (JWT RS256 con WebCrypto). Lo usan
  `app/api/agent/_orquestador.ts` y `lib/gcs.ts` sólo en Workers (`lib/entorno.ts`).
- **Cloud Storage**: en Workers, API JSON por `fetch`; en Node, `@google-cloud/storage`.
  `undici` y `@google-cloud/storage` quedan fuera del worker (`next.config.js`).
- **Caché**: una LRU en memoria por isolate (`cloudflare/cache-memoria.ts`), sembrada con
  lo prerenderizado. ISR: el worker se pide a sí mismo la página vencida.
- **Compresión**: el borde de Cloudflare comprime; las rutas que gzipeaban a mano no lo
  hacen en Workers (saldría gzip dentro de gzip).
- **Imágenes**: `/_next/image` usa el binding `IMAGES` (Cloudflare Images).
- **Ícono y tarjetas Open Graph**: runtime Node (OpenNext no corre rutas `edge`). Con
  `next dev` o `next start` en Windows no se dibujan: bug de `next/og` con las rutas de
  Windows. En Linux (Cloud Run, Workers) salen igual que antes.

## Límites

- Tamaño: ~2,5 MB comprimido (tope 3 MB en el plan gratis, 10 MB en el pago).
- CPU: renderizar Next pasa los 10 ms por pedido del plan gratis; hace falta el plan pago.
- `/api/agent/analyze` (sin stream) espera la respuesta entera del orquestador; la UI usa
  `/api/agent/analyze/stream`, que manda bytes mientras corre.
