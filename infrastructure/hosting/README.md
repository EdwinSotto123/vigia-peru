# Firebase Hosting delante de Vigía Perú

`https://vigia-peru.web.app` es la entrada pública con CDN (auditoría 2026-09-25, hallazgo A7): Hosting
reenvía todo a Cloud Run y su CDN guarda lo que las respuestas marcan `public, s-maxage=N`
(páginas ISR del frontend y GET públicos de la API). Lo `private, no-store` no se guarda.

| Ruta | Destino |
|---|---|
| `/v1/**` | API (`vigia-peru-api`). La API sirve cada ruta pública también bajo `/v1`. |
| todo lo demás | frontend (`vigia-peru-frontend`) |

Detalles que condicionan el código:
- **Cookies:** Hosting solo deja pasar la cookie `__session`. Por eso la sesión del panel admin se llama
  así (`frontend/lib/admin-sesion.ts`, que sigue aceptando el nombre anterior `vigia_admin`).
- **API desde el navegador:** detrás de Hosting el frontend llama a `/v1` en su mismo dominio
  (`frontend/lib/auditoria.ts`, `PUBLIC_API_BASE`), así también pasa por la CDN.
- **Tiempo máximo:** Hosting corta a los 60 s los pedidos a Cloud Run. El análisis en vivo del equipo
  (`/api/agent/*`, streaming largo) se usa desde la URL directa de Cloud Run.

Desplegar: `bash infrastructure/deploy/gcp/hosting.sh` (solo publica la configuración; no toca los servicios).

## Modo pausa (Cloud Run apagado)

`firebase.pausa.json` manda `vigia-peru.web.app` a la réplica en Cloudflare con un 302 (temporal, para
poder volver): `/v1/**` a `vigia-api.vigiaperu.workers.dev` y el resto a `vigia-web.vigiaperu.workers.dev`.
Se usa con `vigia-peru-frontend` y `vigia-peru-api` en `--ingress internal` (sin tráfico, sin costo).

- Activar: `firebase deploy --only hosting:vigia-peru --project vivid-spot-480905-a4 --config firebase.pausa.json`
  desde esta carpeta, y `gcloud run services update <servicio> --ingress internal` en los dos servicios.
- Volver: `--ingress all` en los dos servicios y `bash infrastructure/deploy/gcp/hosting.sh`.

## Cambiar de proyecto

El sitio `vigia-peru.web.app` es del proyecto de la entrada (`ENTRADA_PROJECT_ID`). `bash infrastructure/deploy/gcp/hosting.sh` publica ahí. Sus reescrituras apuntan a los servicios de Cloud Run de ese mismo proyecto. Guía: `infrastructure/deploy/gcp/migracion/README.md`.
