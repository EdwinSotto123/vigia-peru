# vigia-seace-zrh

Los reportes «ongei» del SEACE, pedidos desde Zúrich. Es el Worker `vigia-seace-zrh`, en Cloudflare Workers, con
`"placement": { "mode": "targeted", "region": "gcp:europe-west6" }`: el SEACE filtra por la IP de salida y Zúrich
pasa.

Son páginas JSF del buscador público que el SEACE da a los portales de transparencia, una entidad y un mes por vez.
Cada consulta son dos pedidos en la misma sesión: la página (cookie y ViewState) y, si hay más filas de las que trae,
la tabla entera por el mismo AJAX con que el navegador pagina. La sesión no sale del Worker. Por eso va aparte del
relay de Zúrich (`backend/relay-worker`), que sólo hace pedidos sueltos sin cookies.

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /health` | `{ok, protegido}`, sin token |
| `POST /ongei {reporte, ruc, anio, mes}` | `{ok, status, total, columnas, filas, pedidos, ms}` |

- `reporte: "pen"`: las penalidades que la entidad aplicó en ese mes.
- `reporte: "ocos"`: sus órdenes de compra y de servicio del mes con el número de expediente SIAF, que CONOSCE no trae.

`/ongei` pide `Authorization: Bearer <VIGIA_DL_TOKEN>`. El Worker no reintenta ni encola: quien llama decide cuántas
consultas hace a la vez.

## Quién lo usa

La API, por service binding (`SEACE_ZRH`, secreto `SEACE_ZRH_TOKEN`): el expediente SIAF de una orden, a pedido
(`backend/api/src/routes/ordenes.ts`). El mes de una entidad queda un día en caché.

## Secreto

`VIGIA_DL_TOKEN` (`npx wrangler secret put VIGIA_DL_TOKEN`): el mismo token del relay de Zúrich (SSM `/vigia/relay/token`).

## Desplegar

```bash
cd backend/seace-zrh-worker
npm ci && npm run typecheck
npm run deploy       # wrangler deploy
```

Este Worker no está en `infrastructure/deploy/cloudflare/worker.sh` ni en `.gitlab-ci.yml`. No hay pruebas
automáticas.
