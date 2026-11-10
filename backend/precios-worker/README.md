# vigia-precios

Precios de referencia propios para el análisis de mercado de bienes (`backend/agent/tools/market/catalogos.py`).

| Fuente | Qué es | Cómo se usa |
|---|---|---|
| Catálogos VTEX (Promart, Plaza Vea, Oechsle, Metro, Wong; Cassinelli y Coolbox solo en búsquedas, no en la canasta) | La búsqueda que usa cada web (`/api/catalog_system/pub/products/search`). **No es una API ofrecida a terceros**: sin garantía, puede cambiar o cerrarse. Precio: el menor entre los vendedores con stock del primer SKU que tenga alguno (en Plaza Vea el primer vendedor suele ser la tienda con precio 0 y el real, un vendedor del marketplace). | Caché de 7 días, User-Agent de navegador, ≤ 1 pedido por segundo a cada tienda, tope de tamaño de cada respuesta, pausa automática de la tienda que falla (3 fallos seguidos, o un 429/403), canasta semanal consultada de a una tienda por vez. |
| VTEX Intelligent Search (Shopstar, Estilos, Carsa; solo búsquedas) | `/api/io/_v/api/intelligent-search/product_search/?query=&count=&locale=es-PE`: mejor orden en términos largos y con los vendedores del marketplace. Busca con todas las palabras: sin resultados, se repite con la búsqueda clásica. El precio sale de las ofertas de los vendedores (`priceRange` puede estar desactualizado: Estilos mostró 2999 con la oferta en 2499) y `priceRange` solo si no hay ofertas. | Lo mismo que VTEX. |
| Sodimac y Falabella (solo búsquedas) | No son VTEX y su API de búsqueda (`/s/search/v1/…`) responde vacía sin la sesión del navegador. Se lee la página `/sodimac-pe/buscar?Ntt=` o `/falabella-pe/search?Ntt=` (Next.js): los resultados vienen en `__NEXT_DATA__` (~2-3 MB por página). Sin los patrocinados (son copias de resultados de más abajo) ni el precio de la tarjeta CMR si hay otro. Falabella: desde una PC en Perú a veces responde con un desafío anti-bots (403, pausa la tienda); desde Cloudflare respondió siempre (2026-11-10). | La misma caché y pausa que las demás; una página por término. Sodimac tiene ferretería por medida (p. ej. autorroscante N8 x 1" en bolsas de 10 y 100). |
| Ripley (solo búsquedas) | Página `simple.ripley.com.pe/search/<término>` (Next.js, 3-4 MB): `findabilityProps.data.products`, sin patrocinados (`sponsored`) ni agotados; vendedor del marketplace (`shop.shopName`). | Igual. |
| Hiraoka (solo búsquedas, tecnología) | GraphQL de Magento (`POST /graphql`, `products(search:)`), sin agotados. | Igual. |
| Tai Loy (solo búsquedas, útiles de oficina) | HTML de Magento `/catalogsearch/result/?q=` (`data-price-amount`, precio final y anterior). Su buscador es flojo fuera de papelería. | Igual. |

Cada producto de `/tiendas/buscar` trae `tienda, producto, marca, sku, precio, precio_lista, unidad_medida, multiplicador,
vendedor, url, patrocinado` (`patrocinado` siempre false: se descartan al leer). Una respuesta sin la forma esperada
(desafío anti-bots, página de error) cuenta como fallo y no va a la caché; una página válida sin resultados, sí.
| Osinergmin · Registro de Precios de Distribuidores Minoristas (SCOP) | Reporte diario oficial y abierto (`CL-Registro-precios-DMIN.csv`, UTF-8, `;`). | Cron diario; el agente recibe p25, mediana y p75 por departamento (o nacional si hay < 3 declaraciones). |

## Rutas (Bearer `PRECIOS_TOKEN`, SSM `/vigia/precios/token`)

- `GET /salud` (sin auth): estado de cada tienda y última actualización.
- `GET /tiendas/buscar?q=<término>&n=4[&tiendas=ripley.com.pe,hiraoka.com.pe]` (`n` hasta 10; `tiendas`: los `id` de `src/tiendas.ts`)
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
- **Tottus, Maestro, Efe/La Curacao, farmacias:** no exponen la búsqueda VTEX (503, 404 o HTML). Tai Loy tampoco, pero
  su página de resultados se lee (2026-11-10). Mercado Libre: su API pide clave (403) y el listado, verificación anti-bots.
- Lo que el Estado pagó por un bien (precio unitario adjudicado) no sale de este Worker: está en la base, tabla
  `conosce_adjudicaciones` (`backend/agent/tools/market/compras_estado.py`).
