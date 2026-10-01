# Relay de descargas en Cloudflare (`vigia-relay`)

Réplica de `backend/relay/app.py` (el puente de Lima) como Worker: misma API (`/health`, `/fetch`, `/download`)
y mismo formato de respuesta. URL: `https://vigia-relay.vigiaperu.workers.dev`.

- Solo acepta URLs de `*.gob.pe` y exige token (`X-Vigia-Token` o `Authorization: Bearer`).
- `/download` sube a `gs://vigia-peru-documentos/convocatorias/<ocid>/<archivo>` con la cuenta `vigia-downloader`.
- `POST /raw {url}` devuelve los bytes tal cual (para descargar en la nube sin pasar por el bucket).
- **Dónde corre:** `placement` en la región `gcp:europe-west6` → siempre en Zúrich. OECE y SEACE filtran por la
  IP de salida del punto de Cloudflare (no se reenvía la de quien llama). Medido el 30/09/2026 con sondas
  llamadas desde GCP us-central1: Zúrich y Buenos Aires 200; Chicago, Dallas, Santiago, São Paulo y Fráncfort 403.
  Desde GCP verificado: `/fetch` del OCDS 200, `/download` de un PDF de prod1 (4,8 MB) al bucket, `/raw` de prod4.
- Reemplaza al VPS de Lima (ya no existe): los agentes y la API lo usan como `LOCAL_DOWNLOADER_URL`, con el
  token del secreto `local-downloader-token` (copia de `relay-cloudflare-token`).
- **Si Zúrich empezara a dar 403:** probar otra región en `placement` (o `"host": "www.bcrp.gob.pe:443"`, que
  Cloudflare ubicó en Buenos Aires o Zúrich según el momento) y volver a medir con una sonda de URLs fijas.

Secretos (`npx wrangler secret put`): `VIGIA_DL_TOKEN` (copia en Secret Manager: `relay-cloudflare-token`) y
`GCP_SA_KEY` (llave JSON de `vigia-downloader`). Despliegue: `npm install && npx wrangler deploy`.

## Cambiar de proyecto

- `GCP_PROJECT` (en `wrangler.jsonc`): el proyecto de los buckets, `BUCKETS_PROJECT_ID`.
- `GCP_SA_KEY`: una cuenta con escritura en el bucket de documentos.

Mientras los buckets sigan en `vivid-spot-480905-a4`, no cambia nada. Guía: `infrastructure/deploy/migracion/README.md`.
