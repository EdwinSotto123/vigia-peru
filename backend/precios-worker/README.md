# vigia-precios

Precios de referencia propios para el análisis de mercado de bienes. Es el Worker `vigia-precios`, en Cloudflare
Workers, con una base D1 (`vigia-precios`, esquema en `schema.sql`). URL: `https://vigia-precios.vigiaperu.workers.dev`.

Lo usan los agentes (`backend/agent/tools/market/catalogos.py`, con `PRECIOS_URL` y `PRECIOS_TOKEN`, que pone
`infrastructure/deploy/aws/agentes.sh`) y el laboratorio de precios (`vigia-precios-lab`, por service binding).
Sin esas variables, el agente consulta las tiendas directo y no usa Osinergmin ni EMMSA.

| Fuente | Qué es | Cómo se usa |
|---|---|---|
| Catálogos VTEX (Promart, Plaza Vea, Oechsle, Metro, Wong; Cassinelli y Coolbox solo en búsquedas, no en la canasta) | La búsqueda que usa cada web (`/api/catalog_system/pub/products/search`). **No es una API ofrecida a terceros**: sin garantía, puede cambiar o cerrarse. Precio: el menor entre los vendedores con stock del primer SKU que tenga alguno (en Plaza Vea el primer vendedor suele ser la tienda con precio 0 y el real, un vendedor del marketplace). | Caché de 7 días, User-Agent de navegador, ≤ 1 pedido por segundo a cada tienda, tope de tamaño de cada respuesta, pausa automática de la tienda que falla (3 fallos seguidos, o un 429/403), canasta semanal consultada de a una tienda por vez. |
| VTEX Intelligent Search (Shopstar, Estilos, Carsa; solo búsquedas) | `/api/io/_v/api/intelligent-search/product_search/?query=&count=&locale=es-PE`: mejor orden en términos largos y con los vendedores del marketplace. Busca con todas las palabras: sin resultados, se repite con la búsqueda clásica. El precio sale de las ofertas de los vendedores (`priceRange` puede estar desactualizado: Estilos mostró 2999 con la oferta en 2499) y `priceRange` solo si no hay ofertas. | Lo mismo que VTEX. |
| Sodimac y Falabella (solo búsquedas) | No son VTEX y su API de búsqueda (`/s/search/v1/…`) responde vacía sin la sesión del navegador. Se lee la página `/sodimac-pe/buscar?Ntt=` o `/falabella-pe/search?Ntt=` (Next.js): los resultados vienen en `__NEXT_DATA__` (~2-3 MB por página). Sin los patrocinados (son copias de resultados de más abajo) ni el precio de la tarjeta CMR si hay otro. Falabella: desde una PC en Perú a veces responde con un desafío anti-bots (403, pausa la tienda); desde Cloudflare respondió siempre (2026-11-10). | La misma caché y pausa que las demás; una página por término. Sodimac tiene ferretería por medida (p. ej. autorroscante N8 x 1" en bolsas de 10 y 100). |
| Ripley (solo búsquedas) | Página `simple.ripley.com.pe/search/<término>` (Next.js, 3-4 MB): `findabilityProps.data.products`, sin patrocinados (`sponsored`) ni agotados; vendedor del marketplace (`shop.shopName`). | Igual. |
| Hiraoka (solo búsquedas, tecnología) | GraphQL de Magento (`POST /graphql`, `products(search:)`), sin agotados. | Igual. |
| Tai Loy (solo búsquedas, útiles de oficina) | HTML de Magento `/catalogsearch/result/?q=` (`data-price-amount`, precio final y anterior). Su buscador es flojo fuera de papelería. | Igual. |
| Osinergmin, Registro de Precios de Distribuidores Minoristas (SCOP) | Reporte diario oficial y abierto (`CL-Registro-precios-DMIN.csv`, UTF-8, `;`). | Cron diario; el agente recibe p25, mediana y p75 por departamento (o nacional si hay menos de 3 declaraciones). |
| EMMSA, Gran Mercado Mayorista de Lima (`src/mayorista.ts`) | Precio diario por kilo (mínimo, máximo y promedio) de unas 110 variedades de hortalizas, tubérculos y frutas, del reporte que publica su web. | Cron diario (ayer y hoy) y un relleno del historial hasta 2014 (tabla `mayorista`). |

Cada producto de `/tiendas/buscar` trae `tienda, producto, marca, sku, precio, precio_lista, unidad_medida, multiplicador,
vendedor, url, patrocinado` (`patrocinado` siempre false: se descartan al leer). Una respuesta sin la forma esperada
(desafío anti-bots, página de error) cuenta como fallo y no va a la caché; una página válida sin resultados, sí.

## Rutas (Bearer `PRECIOS_TOKEN`, SSM `/vigia/precios/token`)

- `GET /salud` (sin auth): estado de cada tienda y última actualización.
- `GET /tiendas/buscar?q=<término>&n=4[&tiendas=ripley.com.pe,hiraoka.com.pe]` (`n` hasta 10; `tiendas`: los `id` de `src/tiendas.ts`)
- `GET /combustible?producto=<texto>&departamento=<depto>&dias=120`
- `GET /historial?q=<término>&dias=180`: precios vistos (índice propio).
- `GET /mayorista?q=<producto>&dias=30[&hasta=AAAA-MM-DD]`: EMMSA, precio por kilo de cada variedad en los días previos.
- `POST /admin/actualizar?que=combustible|canasta|mayorista[&desde=&hasta=]`: corre ya lo que hace el cron.

## Crons (`wrangler.jsonc`)

| Cron (UTC) | Hora de Lima | Qué hace |
|---|---|---|
| `0 12 * * *` | 07:00, a diario | Osinergmin y EMMSA (ayer y hoy) |
| `0 13 * * 1` | 08:00, los lunes | la canasta semanal de las tiendas (índice propio) |
| `*/3 * * * *` | cada 3 min | rellena el historial de EMMSA hacia atrás hasta 2014; después no hace nada |

## Probar y desplegar

```bash
cd backend/precios-worker
npm ci && npm test && npm run typecheck
npx wrangler d1 execute vigia-precios --remote --file schema.sql   # sólo si cambió el esquema
bash infrastructure/deploy/cloudflare/worker.sh precios             # desde la raíz del repo
```

`worker.sh` se niega si la carpeta tiene cambios sin commitear. Secreto: `PRECIOS_TOKEN` (`npx wrangler secret put`).

## Fuentes evaluadas y descartadas (2026-10-18)

- **Perú Compras, Catálogos Electrónicos (datosabiertos.gob.pe, `ReportePCBienes<AAAAMM>.csv`, desde 2022):** cada fila
  es una orden (entidad, proveedor, acuerdo marco, subtotal/IGV/total y el enlace al PDF de la orden), **sin ítems,
  cantidades ni precio unitario**. El detalle por producto solo está en el PDF de cada orden (~11 mil por mes): leerlo
  costaría más de lo que aporta mientras CONOSCE cubra los bienes. El buscador de fichas (buscadorcatalogos) publica la
  ficha técnica, no precios.
- **Tottus, Maestro, Efe/La Curacao, farmacias:** no exponen la búsqueda VTEX (503, 404 o HTML). Tai Loy tampoco, pero
  su página de resultados se lee (2026-11-10). Mercado Libre: su API pide clave (403) y el listado, verificación anti-bots.
- Lo que el Estado pagó por un bien (precio unitario adjudicado) no sale de este Worker: está en la base, tabla
  `conosce_adjudicaciones` (`backend/agent/tools/market/compras_estado.py`).
