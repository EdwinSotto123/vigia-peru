# vigia-relay

El relay de descargas de Zúrich. Es el Worker `vigia-relay`, en Cloudflare Workers:
`https://vigia-relay.vigiaperu.workers.dev`.

El OECE y el SEACE filtran por la IP de salida, y la de un Worker es la del punto de Cloudflare donde corre. Con
`"placement": { "mode": "targeted", "region": "gcp:europe-west6" }` este Worker corre siempre en Zúrich, llame quien
llame, y ahí responden. Medido el 30 de septiembre de 2026: Zúrich y Buenos Aires dan 200; Chicago, Dallas, Santiago,
São Paulo y Fráncfort, 403.

Reemplazó el 30 de septiembre de 2026 al relay que corría en un VPS de Lima (`backend/relay`, ya retirado).

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /health` | `{ok, bucket, project, protected}` |
| `POST /raw {url}` | los bytes tal cual, con el status del origen |
| `POST /fetch {url}` | `{ok, status, content_type, body}` (metadatos del OCDS) |
| `POST /download {url, ocid, filename}` | baja el archivo y lo sube a GCS (`gs://vigia-peru-documentos/convocatorias/<ocid>/…`) |

- Exige token: `X-Vigia-Token` o `Authorization: Bearer`. Sin token configurado no atiende.
- Sólo acepta URLs de `*.gob.pe` y la ficha de empresas de `www.universidadperu.com` (respaldo de SUNAT).
- `/download` escribe en GCS, que desde el 2026-11-06 está sin facturación.

## Quién lo usa

- `vigia-scrapers`, por service binding (`RELAY`, `POST /raw`): la API OCDS del OECE, los documentos de los expedientes
  y las contrataciones menores del SEACE.
- Scripts de `backend/scripts` por su URL, como `menores_detalle.py` (`/fetch`) y `cargar_seace_menores.py`.
- La API lo sondea para el panel de salud (`LOCAL_DOWNLOADER_URL`, en `lib/salud.ts`).

Para las páginas con sesión del SEACE está `vigia-seace-zrh` (`backend/seace-zrh-worker`), también en Zúrich. Para
las fuentes que sólo responden a IPs del Perú, el relay de Lima (`backend/relay-lima`).

**Si Zúrich empezara a dar 403:** probar otra región en `placement` y volver a medir con URLs fijas.

## Variables y secretos (`wrangler.jsonc`)

- Variables: `GCS_BUCKET`, `GCP_PROJECT` (sólo para `/download`) y `MAX_BYTES` (tope de cada descarga).
- Secretos (`npx wrangler secret put`): `VIGIA_DL_TOKEN`, el token de los clientes (copia en SSM `/vigia/relay/token`;
  en `vigia-scrapers` se llama `RELAY_TOKEN`), y `GCP_SA_KEY`, la cuenta de Google que escribe en el bucket (sólo
  `/download`).

## Desplegar

`bash infrastructure/deploy/cloudflare/worker.sh relay`, desde la raíz del repo. Se niega si la carpeta tiene cambios
sin commitear. Para revisar tipos: `npm ci && npm run typecheck`. No hay pruebas automáticas.
