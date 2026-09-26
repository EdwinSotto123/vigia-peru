# Relay de descargas en Cloudflare (`vigia-relay`)

Réplica de `backend/relay/app.py` (el puente de Lima) como Worker: misma API (`/health`, `/fetch`, `/download`)
y mismo formato de respuesta. URL: `https://vigia-relay.vigiaperu.workers.dev`.

- Solo acepta URLs de `*.gob.pe` y exige token (`X-Vigia-Token` o `Authorization: Bearer`).
- `/download` sube a `gs://vigia-peru-documentos/convocatorias/<ocid>/<archivo>` con la cuenta `vigia-downloader`.
- **Límite medido:** OECE y SEACE responden 200 si el Worker corre en Sudamérica (quien lo llama está en Perú)
  y 403 si corre en EE.UU. (llamado desde Cloud Run). Por eso los agentes todavía no lo usan.

Secretos (`npx wrangler secret put`): `VIGIA_DL_TOKEN` (copia en Secret Manager: `relay-cloudflare-token`) y
`GCP_SA_KEY` (llave JSON de `vigia-downloader`). Despliegue: `npm install && npx wrangler deploy`.
