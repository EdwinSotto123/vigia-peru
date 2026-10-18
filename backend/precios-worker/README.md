# vigia-precios

Precios de referencia propios para el análisis de mercado de bienes (`backend/agent/tools/market/catalogos.py`).

| Fuente | Qué es | Cómo se usa |
|---|---|---|
| Catálogos VTEX (Promart, Plaza Vea, Oechsle, Metro, Wong; Cassinelli y Coolbox solo en búsquedas, no en la canasta) | La búsqueda que usa cada web (`/api/catalog_system/pub/products/search`). **No es una API ofrecida a terceros**: sin garantía, puede cambiar o cerrarse. | Caché de 7 días, User-Agent propio, pausa automática de la tienda que falla (3 fallos seguidos, o un 429/403), canasta semanal consultada de a una tienda por vez. |
| Sodimac (solo búsquedas) | No es VTEX y su API de búsqueda (`/s/search/v1/…`) responde vacía sin la sesión del navegador. Se lee la página `/sodimac-pe/buscar?Ntt=` (Next.js): los resultados vienen en `__NEXT_DATA__` (~2-3 MB por página). Sin los patrocinados. | La misma caché y pausa que las demás; una página por término. Tiene ferretería por medida (p. ej. autorroscante N8 x 1" en bolsas de 10 y 100). |
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

## Fuentes evaluadas y descartadas (2026-10-18)

- **Perú Compras, Catálogos Electrónicos (datosabiertos.gob.pe, `ReportePCBienes<AAAAMM>.csv`, desde 2022):** cada fila
  es una orden (entidad, proveedor, acuerdo marco, subtotal/IGV/total y el enlace al PDF de la orden), **sin ítems,
  cantidades ni precio unitario**. El detalle por producto solo está en el PDF de cada orden (~11 mil por mes): leerlo
  costaría más de lo que aporta mientras CONOSCE cubra los bienes. El buscador de fichas (buscadorcatalogos) publica la
  ficha técnica, no precios.
- **Tottus, Maestro, Tai Loy, Efe/La Curacao, farmacias:** no exponen la búsqueda VTEX (503, 404 o HTML).
- Lo que el Estado pagó por un bien (precio unitario adjudicado) no sale de este Worker: está en la base, tabla
  `conosce_adjudicaciones` (`backend/agent/tools/market/compras_estado.py`).
