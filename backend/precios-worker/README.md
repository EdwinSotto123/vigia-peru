# vigia-precios

Precios de referencia propios para el análisis de mercado de bienes (`backend/agent/tools/market/catalogos.py`).

| Fuente | Qué es | Cómo se usa |
|---|---|---|
| Catálogos VTEX (Promart, Plaza Vea, Oechsle, Metro, Wong) | La búsqueda que usa cada web (`/api/catalog_system/pub/products/search`). **No es una API ofrecida a terceros**: sin garantía, puede cambiar o cerrarse. | Caché de 7 días, User-Agent propio, pausa automática de la tienda que falla (3 fallos seguidos, o un 429/403), canasta semanal consultada de a una tienda por vez. |
| Osinergmin · Registro de Precios de Distribuidores Minoristas (SCOP) | Reporte diario oficial y abierto (`CL-Registro-precios-DMIN.csv`, UTF-8, `;`). | Cron diario; el agente recibe p25, mediana y p75 por departamento (o nacional si hay < 3 declaraciones). |

## Rutas (Bearer `PRECIOS_TOKEN`, SSM `/vigia/precios/token`)

- `GET /salud` (sin auth): estado de cada tienda y última actualización.
- `GET /tiendas/buscar?q=<término>&n=4`
- `GET /combustible?producto=<texto>&departamento=<depto>&dias=120`
- `GET /historial?q=<término>&dias=180`: precios vistos (índice propio).
- `POST /admin/actualizar?que=combustible|canasta`

## Operación

```bash
npm install && npm test && npm run typecheck
npx wrangler d1 execute vigia-precios --remote --file schema.sql   # una vez
npx wrangler deploy
```

En la Lambda del agente: `PRECIOS_URL=https://vigia-precios.vigiaperu.workers.dev` y `PRECIOS_TOKEN`.
Sin esas variables, el agente consulta las tiendas directo y no usa Osinergmin.
