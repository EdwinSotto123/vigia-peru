/**
 * Búsquedas de productos en tiendas peruanas, sin clave: la misma consulta que hace cada web.
 *
 *   vtex       `/api/catalog_system/pub/products/search?ft=` (JSON). Promart, Plaza Vea, Oechsle, Metro, Wong, ...
 *   vtex_is    VTEX Intelligent Search `/api/io/_v/api/intelligent-search/product_search/` (JSON): mejor orden en
 *              términos largos y trae a los vendedores del marketplace. Busca con todas las palabras: si no
 *              encuentra nada, se repite con la búsqueda clásica (`vtex`).
 *   sodimac    página de búsqueda Next.js `/sodimac-pe/buscar?Ntt=`: resultados en `__NEXT_DATA__`.
 *   falabella  igual que Sodimac (`/falabella-pe/search?Ntt=`). Solo responde desde Cloudflare: desde una PC en
 *              Perú sale un desafío anti-bots (403), que pausa la tienda como cualquier otro 403.
 *   ripley     página Next.js `/search/<término>`: `findabilityProps.data.products`.
 *   magento    GraphQL de Magento (`POST /graphql`, `products(search:)`). Hiraoka (tecnología).
 *   tailoy     HTML de Magento `/catalogsearch/result/?q=` (`data-price-amount`). Útiles de oficina.
 *
 * Ninguna es una API ofrecida a terceros: sin garantía de servicio, pueden cambiar o cerrarse. Por eso este Worker
 * las usa con cuidado: caché, pocas consultas, un pedido por segundo como máximo a cada tienda, User-Agent de
 * navegador, tope de tamaño de la respuesta (las páginas pesan 2-4 MB: se leen y se descartan, nunca se guardan)
 * y corte automático de la tienda que empieza a fallar (`estadoTrasFallo`). Los resultados patrocinados se omiten:
 * no responden al término.
 */

export type Plataforma = "vtex" | "vtex_is" | "sodimac" | "falabella" | "ripley" | "magento" | "tailoy";

export interface Tienda {
  id: string;
  base: string;
  /** false: no vende alimentos, queda fuera de la canasta semanal (solo responde búsquedas). */
  canasta?: boolean;
  /** Por defecto "vtex". */
  plataforma?: Plataforma;
}

export const TIENDAS: Tienda[] = [
  { id: "promart.pe", base: "https://www.promart.pe" },
  { id: "plazavea.com.pe", base: "https://www.plazavea.com.pe" },
  { id: "oechsle.pe", base: "https://www.oechsle.pe" },
  { id: "metro.pe", base: "https://www.metro.pe" },
  { id: "wong.pe", base: "https://www.wong.pe" },
  { id: "cassinelli.com", base: "https://www.cassinelli.com", canasta: false },   // ferretería y construcción
  { id: "coolbox.pe", base: "https://www.coolbox.pe", canasta: false },           // tecnología y electrodomésticos
  { id: "sodimac.com.pe", base: "https://www.sodimac.com.pe", canasta: false, plataforma: "sodimac" },
  { id: "shopstar.pe", base: "https://www.shopstar.pe", canasta: false, plataforma: "vtex_is" },        // marketplace
  { id: "estilos.com.pe", base: "https://www.estilos.com.pe", canasta: false, plataforma: "vtex_is" },  // tecnología, hogar
  { id: "carsa.pe", base: "https://www.carsa.pe", canasta: false, plataforma: "vtex_is" },              // tecnología, hogar
  { id: "falabella.com.pe", base: "https://www.falabella.com.pe", canasta: false, plataforma: "falabella" },
  { id: "ripley.com.pe", base: "https://simple.ripley.com.pe", canasta: false, plataforma: "ripley" },
  { id: "hiraoka.com.pe", base: "https://hiraoka.com.pe", canasta: false, plataforma: "magento" },      // tecnología
  { id: "tailoy.com.pe", base: "https://www.tailoy.com.pe", canasta: false, plataforma: "tailoy" },     // útiles de oficina
];

/** Fuentes oficiales (Osinergmin, EMMSA): User-Agent propio. */
export const USER_AGENT = "VigiaPeru-Precios/1.0 (+https://vigia-web.vigiaperu.workers.dev; consulta de precios de referencia)";

/** Tiendas: User-Agent de navegador común (algunas rechazan los que no lo son). */
export const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Productos por tienda que se leen de una página completa (y se guardan en caché) aunque se pidan menos. */
export const N_MAX = 10;

/** Tope de bytes de una respuesta, por tipo. La página más pesada medida (Ripley) pesó 4,4 MB. */
export const TOPE_BYTES = { json: 2_000_000, html: 6_000_000 } as const;

export interface Producto {
  tienda: string;
  producto: string;
  marca: string | null;
  sku: string | null;
  precio: number;
  precio_lista: number | null;
  unidad_medida: string | null;
  multiplicador: number | null;
  /** Quién vende en un marketplace (Plaza Vea, Shopstar, Ripley, Falabella, ...); la tienda misma si vende ella. */
  vendedor: string | null;
  /** Siempre false: los patrocinados se descartan al leer. Queda en la respuesta para que quien la use lo sepa. */
  patrocinado: boolean;
  url: string;
}

export const plataformaDe = (t: Tienda): Plataforma => t.plataforma ?? "vtex";

/** Término comparable: minúsculas, sin tildes ni signos, espacios simples. Es la clave de caché. */
export function normalizarTermino(t: string): string {
  return (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1.$2")          // "42,5 kg" / "42.5 kg" → "42.5 kg": el decimal es parte del producto
    .replace(/[^a-z0-9ñ. ]+/g, " ")
    .replace(/\.(?!\d)|(?<!\d)\./g, " ")       // los demás puntos fuera
    .replace(/\s+/g, " ")
    .trim();
}

// ─── el pedido ────────────────────────────────────────────────────────────────
export function urlBusqueda(t: Tienda, termino: string, n: number, p: Plataforma = plataformaDe(t)): string {
  const q = encodeURIComponent(termino);   // espacios como %20: el firewall de VTEX rechaza "+"
  switch (p) {
    case "sodimac": return `${t.base}/sodimac-pe/buscar?Ntt=${q}`;
    case "falabella": return `${t.base}/falabella-pe/search?Ntt=${q}`;
    case "ripley": return `${t.base}/search/${q}`;
    case "tailoy": return `${t.base}/catalogsearch/result/?q=${q}`;
    case "magento": return `${t.base}/graphql`;
    case "vtex_is": return `${t.base}/api/io/_v/api/intelligent-search/product_search/?query=${q}&count=${n}&locale=es-PE`;
    default: return `${t.base}/api/catalog_system/pub/products/search?ft=${q}&_from=0&_to=${Math.max(0, n - 1)}`;
  }
}

export interface Pedido {
  url: string;
  init: RequestInit;
  tipo: "json" | "html";
}

const CONSULTA_MAGENTO = `query ($q: String!, $n: Int) { products(search: $q, pageSize: $n) { items {
  name sku url_key url_suffix stock_status
  price_range { minimum_price { final_price { value } regular_price { value } } } } } }`;

/** URL, método, cabeceras y cuerpo de la búsqueda de `termino` en la tienda. */
export function pedidoBusqueda(t: Tienda, termino: string, n: number, p: Plataforma = plataformaDe(t)): Pedido {
  const tipo = p === "vtex" || p === "vtex_is" || p === "magento" ? "json" : "html";
  const headers: Record<string, string> = {
    "user-agent": UA_NAVEGADOR,
    "accept-language": "es-PE,es;q=0.9",
    accept: tipo === "json" ? "application/json" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  const url = urlBusqueda(t, termino, n, p);
  if (p === "magento") {
    return { url, tipo, init: { method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query: CONSULTA_MAGENTO, variables: { q: termino, n: Math.min(n, N_MAX) } }) } };
  }
  return { url, tipo, init: { method: "GET", headers } };
}

/** El cuerpo como texto, cortando la lectura si pasa de `tope` bytes (no se carga en memoria una página enorme). */
export async function leerCuerpo(r: Response, tope: number): Promise<string> {
  if (!r.body) return "";
  const lector = r.body.getReader();
  const dec = new TextDecoder();
  const partes: string[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel();
      throw new Error(`respuesta de más de ${tope} bytes`);
    }
    partes.push(dec.decode(value, { stream: true }));
  }
  partes.push(dec.decode());
  return partes.join("");
}

// ─── la respuesta ─────────────────────────────────────────────────────────────
/**
 * Respuesta de la tienda → hasta `n` productos con precio y stock, sin patrocinados. null: la respuesta no tiene la
 * forma esperada (desafío anti-bots, página de error o cambio de la web): cuenta como fallo y no va a la caché. Una
 * página válida sin resultados devuelve [].
 */
export function leerProductos(t: Tienda, cuerpo: string, n: number, p: Plataforma = plataformaDe(t)): Producto[] | null {
  switch (p) {
    case "sodimac":
    case "falabella": {
      const d = datosNext(cuerpo);
      return d ? normalizarFalabella(d?.props?.pageProps?.results, t, n) : null;
    }
    case "ripley": return normalizarRipley(cuerpo, t, n);
    case "tailoy": return normalizarTaiLoy(cuerpo, t, n);
    case "magento": {
      const items = jsonSeguro(cuerpo)?.data?.products?.items;
      return Array.isArray(items) ? normalizarMagento(items, t, n) : null;
    }
    case "vtex_is": {
      const ps = jsonSeguro(cuerpo)?.products;
      return Array.isArray(ps) ? normalizarVtex(ps, t).slice(0, n) : null;
    }
    default: {
      const d = jsonSeguro(cuerpo);
      return Array.isArray(d) ? normalizarVtex(d, t).slice(0, n) : null;
    }
  }
}

function jsonSeguro(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** `<script id="__NEXT_DATA__">` de una página Next.js, o null si no está (bloqueo o cambio de la web). */
export function datosNext(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? jsonSeguro(m[1]) : null;
}

const ENTIDADES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** Entidades HTML decodificadas (`&quot;`, `&#xF3;`, ...). Sin tocar lo demás: "<2.5 kg" queda como está. */
export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (e, c: string) => {
    if (c[0] === "#") {
      const cp = c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : " ";
    }
    return ENTIDADES[c.toLowerCase()] ?? e;
  });
}

/** Texto visible de un fragmento HTML: sin etiquetas, entidades decodificadas, espacios simples. */
export function textoPlano(html: string): string {
  return decodificarEntidades(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const nombre = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
const absoluta = (t: Tienda, u: string) => (u.startsWith("/") ? `${t.base}${u}` : u);

export interface OfertaVtex {
  precio: number;
  lista: number | null;
  vendedor: string | null;
  /** El SKU de la oferta (unidad de medida, multiplicador). */
  item: any;
}

/**
 * La oferta de un producto VTEX: el primer SKU que tiene algún vendedor con stock y, en ese SKU, el menor precio. En
 * Plaza Vea, Shopstar o Carsa el primer vendedor suele ser la tienda misma, con precio 0 y sin stock, mientras un
 * vendedor del marketplace tiene el precio real; en Shopstar hasta el primer SKU entero puede estar así. Sin ofertas
 * por vendedor en ningún SKU (Intelligent Search puede omitirlas), el rango de precios del producto.
 */
export function ofertaVtex(p: any): OfertaVtex | null {
  const items: any[] = Array.isArray(p?.items) ? p.items : [];
  let conVendedores = false;
  for (const item of items) {
    const vendedores: any[] = Array.isArray(item?.sellers) ? item.sellers : [];
    conVendedores ||= vendedores.length > 0;
    let mejor: OfertaVtex | null = null;
    for (const s of vendedores) {
      const o = s?.commertialOffer;
      const precio = Number(o?.Price);
      if (!o || !(precio > 0)) continue;
      if (o.AvailableQuantity !== undefined && Number(o.AvailableQuantity) <= 0) continue;
      if (!mejor || precio < mejor.precio) {
        const lista = Number(o.ListPrice);
        mejor = { precio, lista: lista > 0 ? lista : null, vendedor: s.sellerName ? nombre(s.sellerName) : null, item };
      }
    }
    if (mejor) return mejor;
  }
  if (conVendedores || !items.length) return null;     // todos agotados o sin precio
  const bajo = Number(p?.priceRange?.sellingPrice?.lowPrice);
  const lista = Number(p?.priceRange?.listPrice?.lowPrice);
  return bajo > 0 ? { precio: bajo, lista: lista > 0 ? lista : null, vendedor: null, item: items[0] } : null;
}

/** Productos VTEX (catálogo o Intelligent Search) → con precio vigente y stock. Lo que no tiene la forma se omite. */
export function normalizarVtex(datos: unknown, t: Tienda): Producto[] {
  if (!Array.isArray(datos)) return [];
  const out: Producto[] = [];
  for (const p of datos as any[]) {
    const oferta = ofertaVtex(p);
    const item = oferta?.item;
    if (!item || !oferta || p?.advertisement) continue;   // `advertisement`: producto patrocinado (VTEX Ads)
    out.push({
      tienda: t.id,
      producto: nombre(p.productName),
      marca: p.brand ? String(p.brand) : null,
      sku: item.itemId ? String(item.itemId) : null,
      precio: oferta.precio,
      precio_lista: oferta.lista,
      unidad_medida: item.measurementUnit ? String(item.measurementUnit) : null,
      multiplicador: Number(item.unitMultiplier) > 0 ? Number(item.unitMultiplier) : null,
      vendedor: oferta.vendedor,
      patrocinado: false,
      url: typeof p.link === "string" && p.link ? absoluta(t, p.link) : `${t.base}/${p.linkText}/p`,
    });
  }
  return out;
}

/**
 * Sodimac y Falabella (misma plataforma): `props.pageProps.results` (~2-3 MB por página; si el término coincide con
 * una categoría, redirige a la lista de esa categoría, con la misma forma). Precio: el menor de los no tachados, sin
 * el de la tarjeta CMR (`cmrPrice`, solo con esa tarjeta) salvo que sea el único; el tachado, como precio de lista.
 * Los patrocinados (`isSponsored`) son copias de resultados que aparecen más abajo: se omiten.
 */
export function normalizarFalabella(resultados: unknown, t: Tienda, n: number): Producto[] {
  if (!Array.isArray(resultados)) return [];
  const out: Producto[] = [];
  for (const p of resultados as any[]) {
    const precios = (Array.isArray(p?.prices) ? p.prices : []).map((x: any) => ({
      tachado: !!x?.crossed, tarjeta: x?.type === "cmrPrice", valor: Number(String(x?.price?.[0] ?? "").replace(/,/g, "")),
    })).filter((x: { valor: number }) => x.valor > 0);
    const vigentes = precios.filter((x: any) => !x.tachado);
    const sinTarjeta = vigentes.filter((x: any) => !x.tarjeta);
    const elegidos = (sinTarjeta.length ? sinTarjeta : vigentes).map((x: any) => x.valor as number);
    const tachados = precios.filter((x: any) => x.tachado).map((x: any) => x.valor as number);
    if (p?.isSponsored || !elegidos.length || !p?.displayName || typeof p?.url !== "string") continue;
    out.push({
      tienda: t.id,
      producto: nombre(p.displayName),
      marca: p.brand ? String(p.brand) : null,
      sku: p.skuId ? String(p.skuId) : null,
      precio: Math.min(...elegidos),
      precio_lista: tachados.length ? Math.max(...tachados) : null,
      unidad_medida: null,
      multiplicador: null,
      vendedor: p.sellerName ? nombre(p.sellerName) : null,
      patrocinado: false,
      url: absoluta(t, p.url.split("?")[0]),
    });
    if (out.length >= n) break;
  }
  return out;
}

/** Compatibilidad: la página de búsqueda de Sodimac → productos ([] si la página no trae `__NEXT_DATA__`). */
export function normalizarSodimac(html: string, t: Tienda, n: number): Producto[] {
  return leerProductos(t, html, n, "sodimac") ?? [];
}

/** Slug de Ripley para armar la URL si la página no trae el enlace: "1.6K PÁG." → "16k-pag". */
export function slugRipley(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Ripley: `props.pageProps.findabilityProps.data.products` (~2 MB de JSON en una página de 3-4 MB). Precio:
 * `priceNumber`; el de lista, `masterPriceNumber`. Los patrocinados (`sponsored.is_sponsored`) y los agotados se
 * omiten. El enlace de cada producto se toma de la página (termina en su `parentProductID`).
 */
export function normalizarRipley(html: string, t: Tienda, n: number): Producto[] | null {
  const d = datosNext(html);
  if (!d) return null;
  const ps = d?.props?.pageProps?.findabilityProps?.data?.products;
  if (!Array.isArray(ps)) return [];
  const rutas = new Map<string, string>();
  for (const m of html.matchAll(/href="(\/[a-z0-9-]+-([a-z0-9]+))(?:\?[^"]*)?"/g)) if (!rutas.has(m[2])) rutas.set(m[2], m[1]);
  const out: Producto[] = [];
  for (const p of ps) {
    const precio = Number(p?.priceNumber);
    const patrocinado = p?.sponsored?.is_sponsored === true || p?.sponsoredType === "sponsored";
    if (patrocinado || p?.inStock === false || !(precio > 0) || !p?.name) continue;
    const id = String(p.parentProductID ?? p.sku ?? "").toLowerCase();
    const lista = Number(p.masterPriceNumber);
    const vendedor = p.seller === "MARKETPLACE" ? p.shop?.shopName : p.seller ? "Ripley" : null;
    out.push({
      tienda: t.id,
      producto: nombre(p.name),
      marca: p.brand ? String(p.brand) : null,
      sku: p.sku ? String(p.sku) : null,
      precio,
      precio_lista: lista > 0 ? lista : null,
      unidad_medida: null,
      multiplicador: null,
      vendedor: vendedor ? nombre(vendedor) : null,
      patrocinado: false,
      url: `${t.base}${rutas.get(id) ?? `/${slugRipley(String(p.name))}-${id}`}`,
    });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Magento GraphQL (Hiraoka): `products(search:).items`; precio final y regular; sin los agotados. Los nombres vienen
 * con entidades HTML (`15.6&quot;`).
 */
export function normalizarMagento(items: unknown[], t: Tienda, n: number): Producto[] {
  const out: Producto[] = [];
  for (const i of items as any[]) {
    const precio = Number(i?.price_range?.minimum_price?.final_price?.value);
    const lista = Number(i?.price_range?.minimum_price?.regular_price?.value);
    if (!(precio > 0) || !i?.name || !i?.url_key || i?.stock_status === "OUT_OF_STOCK") continue;
    out.push({
      tienda: t.id,
      producto: nombre(decodificarEntidades(String(i.name))),
      marca: null,
      sku: i.sku ? String(i.sku) : null,
      precio,
      precio_lista: lista > 0 ? lista : null,
      unidad_medida: null,
      multiplicador: null,
      vendedor: null,
      patrocinado: false,
      url: `${t.base}/${i.url_key}${i.url_suffix ?? ""}`,
    });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Tai Loy (Magento, HTML): la lista `search results` de la página de resultados. Por producto: enlace y nombre
 * (`product-item-link`), marca (`brand-label`), precio final y anterior (`data-price-amount` con
 * `data-price-type="finalPrice"` / `"oldPrice"`); los marcados `stock unavailable` se omiten. Sin la clase
 * `catalogsearch-result-index` en el body, no es la página de resultados (null).
 */
export function normalizarTaiLoy(html: string, t: Tienda, n: number): Producto[] | null {
  if (!/<body[^>]*catalogsearch-result-index/.test(html)) return null;
  const i = html.indexOf('class="search results"');
  if (i < 0) return [];                                   // "Tu búsqueda no obtuvo resultados"
  const fin = html.indexOf("</ol>", i);
  const lista = html.slice(i, fin < 0 ? undefined : fin);
  const out: Producto[] = [];
  for (const bloque of lista.split(/<li class="item product product-item"/).slice(1)) {
    const enlace = bloque.match(/class="product-item-link"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const final = bloque.match(/data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"/);
    const anterior = bloque.match(/data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"/);
    const marca = bloque.match(/class="brand-label"[\s\S]*?<span class="label">([\s\S]*?)<\/span>/);
    const sku = bloque.match(/data-product-sku="([^"]+)"/);
    const precio = Number(final?.[1]);
    if (!enlace || !(precio > 0) || /class="[^"]*\bstock unavailable\b/.test(bloque)) continue;
    const lista = Number(anterior?.[1]);
    out.push({
      tienda: t.id,
      producto: textoPlano(enlace[2]).slice(0, 200),
      marca: marca ? textoPlano(marca[1]) || null : null,
      sku: sku ? sku[1] : null,
      precio,
      precio_lista: lista > 0 ? lista : null,
      unidad_medida: null,
      multiplicador: null,
      vendedor: null,
      patrocinado: false,
      url: textoPlano(enlace[1]),
    });
    if (out.length >= n) break;
  }
  return out;
}

// ─── cortesía: un pedido por segundo como máximo a cada tienda ────────────────
/**
 * Reserva el próximo turno de `tienda` en `turnos` (tienda → epoch ms del siguiente pedido permitido) y devuelve
 * cuántos ms esperar. Si la espera pasaría de `maxEspera`, no reserva y devuelve -1 (la tienda está ocupada).
 */
export function reservarTurno(turnos: Map<string, number>, tienda: string, ahora: number, intervalo = 1000, maxEspera = 5000): number {
  const t = Math.max(ahora, turnos.get(tienda) ?? 0);
  if (t - ahora > maxEspera) return -1;
  turnos.set(tienda, t + intervalo);
  return t - ahora;
}

// ─── corte automático por tienda ──────────────────────────────────────────────
export interface EstadoTienda {
  errores: number;
  bloqueada_hasta: number; // epoch ms; 0 = libre
}

export const LIBRE: EstadoTienda = { errores: 0, bloqueada_hasta: 0 };

export function bloqueada(e: EstadoTienda | null | undefined, ahora: number): boolean {
  return !!e && e.bloqueada_hasta > ahora;
}

/**
 * Tras un fallo (HTTP ≥ 400, timeout, respuesta sin la forma esperada): a partir del 3.º seguido, la tienda queda en
 * pausa 30 min y la pausa se duplica con cada fallo nuevo, hasta 24 h. Un 429 o 403 pausa de inmediato: es la tienda
 * pidiendo que paremos.
 */
export function estadoTrasFallo(e: EstadoTienda | null | undefined, ahora: number, status = 0): EstadoTienda {
  const errores = (e?.errores ?? 0) + 1;
  const inmediato = status === 429 || status === 403;
  if (errores < 3 && !inmediato) return { errores, bloqueada_hasta: 0 };
  const exp = Math.max(0, errores - 3);
  const pausa = Math.min(30 * 60_000 * 2 ** exp, 24 * 3_600_000);
  return { errores, bloqueada_hasta: ahora + pausa };
}

export function estadoTrasExito(): EstadoTienda {
  return { ...LIBRE };
}
