/**
 * Directorio de tiendas peruanas y su buscador público (2026-11-12). El usuario: «para búsqueda web, todo open source».
 * Los buscadores abiertos con índice propio (Mwmbl, Marginalia, Stract) no traen tiendas del Perú y los metabuscadores
 * (SearXNG) raspan a Google y Bing; así que en vez de buscar en la web se le pregunta a cada tienda por su propia
 * búsqueda, la que ya expone su plataforma:
 *
 *   woocommerce  Store API     GET  /wp-json/wc/store/v1/products?search=      (precio en céntimos)
 *   shopify      Predictive    GET  /search/suggest.json?q=&resources[type]=product
 *   vtex         Catálogo      GET  /api/catalog_system/pub/products/search?ft=
 *   magento      GraphQL       POST /graphql  { products(search:) }
 *   navegador    la página de resultados abierta con Crawl4AI (tiendas armadas con JavaScript sin API pública)
 *
 * Cortesía igual que `leerUrl`: robots.txt de la ruta (y `Content-Signal: ai-input=no`), turno por dominio (≤ 1 pedido
 * por segundo), nuestro User-Agent, y no se insiste ante 401/403/429 o un desafío. Cada tienda se probó a mano antes de
 * entrar al directorio (2026-11-12: 39 por API y 2 por Crawl4AI); las que se descartaron y por qué están en
 * directorio_descartadas.md.
 */
import { decodificarEntidades } from "./extraer.ts";
import type { EnvTurnos } from "./turnos.ts";

export type Rubro = "farmacia" | "medico" | "oficina" | "computo" | "ferreteria" | "limpieza" | "alimentos" | "hogar" | "seguridad" | "automotriz";
export const RUBROS: Rubro[] = ["farmacia", "medico", "oficina", "computo", "ferreteria", "limpieza", "alimentos", "hogar", "seguridad", "automotriz"];

export type Plataforma = "woocommerce" | "shopify" | "vtex" | "magento" | "navegador";

export interface TiendaDirectorio {
  id: string;
  nombre: string;
  base: string;
  plataforma: Plataforma;
  rubros: Rubro[];
  /** Parámetros extra de la búsqueda (p. ej. `sc=1` en VTEX). */
  parametros?: string;
  /** navegador: la página de resultados para un término. */
  buscador?: (q: string) => string;
}

const q = encodeURIComponent;

/** Las tiendas, por rubro. Cada una probada con un término real el 2026-11-12. */
export const DIRECTORIO: TiendaDirectorio[] = [
  // ── navegador (Crawl4AI): se arman con JavaScript y no exponen una API pública ──
  { id: "inkafarma.pe", nombre: "Inkafarma", base: "https://inkafarma.pe", plataforma: "navegador", rubros: ["farmacia", "medico"], buscador: (t) => `https://inkafarma.pe/buscador?keyword=${q(t)}` },
  { id: "mifarma.com.pe", nombre: "Mifarma", base: "https://www.mifarma.com.pe", plataforma: "navegador", rubros: ["farmacia", "medico"], buscador: (t) => `https://www.mifarma.com.pe/buscador?keyword=${q(t)}` },
  // ── WooCommerce (Store API) ──
  { id: "llantasyaros.pe", nombre: "Llantas y Aros", base: "https://llantasyaros.pe", plataforma: "woocommerce", rubros: ["automotriz"] },
  { id: "hpstore.com.pe", nombre: "HP Store Perú (hpstore.com.pe)", base: "https://hpstore.com.pe", plataforma: "woocommerce", rubros: ["computo", "oficina"] },
  { id: "botifarma.pe", nombre: "Botifarma", base: "https://botifarma.pe", plataforma: "woocommerce", rubros: ["farmacia", "medico"] },
  { id: "hogarysalud.com.pe", nombre: "Boticas Hogar y Salud", base: "https://www.hogarysalud.com.pe", plataforma: "woocommerce", rubros: ["farmacia", "medico"] },
  { id: "novafarmawimer.pe", nombre: "NovaFarma Wimer", base: "https://novafarmawimer.pe", plataforma: "woocommerce", rubros: ["farmacia", "medico"] },
  { id: "santanatura.com.pe", nombre: "Santa Natura", base: "https://santanatura.com.pe", plataforma: "woocommerce", rubros: ["farmacia"] },
  { id: "beurer.pe", nombre: "Beurer Perú", base: "https://beurer.pe", plataforma: "woocommerce", rubros: ["medico"] },
  { id: "labmedical.pe", nombre: "LabMedical Perú", base: "https://www.labmedical.pe", plataforma: "woocommerce", rubros: ["medico"] },
  { id: "segurimax.com.pe", nombre: "Segurimax", base: "https://segurimax.com.pe", plataforma: "woocommerce", rubros: ["seguridad"] },
  // ── Shopify (búsqueda predictiva) ──
  { id: "wienerstech.com", nombre: "Wieners Tech", base: "https://wienerstech.com", plataforma: "shopify", rubros: ["computo"] },
  { id: "dermashop.pe", nombre: "Dermashop", base: "https://dermashop.pe", plataforma: "shopify", rubros: ["farmacia"] },
  { id: "forte.com.pe", nombre: "Forte (ASSA ABLOY)", base: "https://forte.com.pe", plataforma: "shopify", rubros: ["ferreteria", "seguridad"] },
  { id: "imaco.pe", nombre: "Imaco", base: "https://imaco.pe", plataforma: "shopify", rubros: ["hogar"] },
  { id: "record.com.pe", nombre: "Record Perú", base: "https://record.com.pe", plataforma: "shopify", rubros: ["hogar"] },
  { id: "ofimarket.pe", nombre: "Ofimarket", base: "https://www.ofimarket.pe", plataforma: "shopify", rubros: ["oficina", "limpieza", "seguridad"] },
  // ── VTEX (catálogo) ──
  { id: "florayfauna.pe", nombre: "Flora & Fauna", base: "https://www.florayfauna.pe", plataforma: "vtex", rubros: ["alimentos"] },
  { id: "makro.plazavea.com.pe", nombre: "Makro Perú", base: "https://www.makro.plazavea.com.pe", plataforma: "vtex", rubros: ["alimentos", "limpieza"] },
  { id: "sanfernando.pe", nombre: "San Fernando", base: "https://www.sanfernando.pe", plataforma: "vtex", rubros: ["alimentos"] },
  { id: "motorola.com.pe", nombre: "Motorola Perú", base: "https://www.motorola.com.pe", plataforma: "vtex", rubros: ["computo"] },
  { id: "store.sony.com.pe", nombre: "Sony Store Perú", base: "https://store.sony.com.pe", plataforma: "vtex", rubros: ["computo"] },
  { id: "xiaomi.qtc.pe", nombre: "Xiaomi Perú (QTC)", base: "https://xiaomi.qtc.pe", plataforma: "vtex", rubros: ["computo"] },
  { id: "farmaciauniversal.com", nombre: "Farmacia Universal", base: "https://www.farmaciauniversal.com", plataforma: "vtex", rubros: ["farmacia", "medico"] },
  { id: "rotoplas.com.pe", nombre: "Rotoplas Perú", base: "https://www.rotoplas.com.pe", plataforma: "vtex", rubros: ["ferreteria"] },
  { id: "vainsa.com", nombre: "Vainsa", base: "https://www.vainsa.com", plataforma: "vtex", rubros: ["ferreteria"] },
  { id: "basa.com.pe", nombre: "Basa", base: "https://www.basa.com.pe", plataforma: "vtex", rubros: ["hogar", "limpieza"] },
  { id: "casaideas.com.pe", nombre: "Casaideas", base: "https://www.casaideas.com.pe", plataforma: "vtex", rubros: ["hogar"] },
  { id: "electrolux.com.pe", nombre: "Electrolux Perú", base: "https://www.electrolux.com.pe", plataforma: "vtex", rubros: ["hogar"] },
  { id: "forli.com.pe", nombre: "Forli", base: "https://www.forli.com.pe", plataforma: "vtex", rubros: ["hogar"] },
  { id: "oster.com.pe", nombre: "Oster Perú", base: "https://www.oster.com.pe", plataforma: "vtex", rubros: ["hogar"] },
  { id: "tramontina.com.pe", nombre: "Tramontina Store Perú", base: "https://www.tramontina.com.pe", plataforma: "vtex", rubros: ["hogar"] },
  { id: "eliteprofessional.com.pe", nombre: "Elite Professional (Softys)", base: "https://www.eliteprofessional.com.pe", plataforma: "vtex", rubros: ["limpieza"] },
  { id: "iberolibrerias.com", nombre: "Ibero Librerías", base: "https://www.iberolibrerias.com", plataforma: "vtex", rubros: ["oficina"] },
  // ── Magento 2 (GraphQL; robots prohíbe /catalogsearch/) ──
  { id: "llantas.pe", nombre: "Llantas.pe", base: "https://www.llantas.pe", plataforma: "magento", rubros: ["automotriz"] },
  { id: "phantom.pe", nombre: "Phantom", base: "https://phantom.pe", plataforma: "magento", rubros: ["computo"] },
  { id: "promelsa.com.pe", nombre: "Promelsa", base: "https://www.promelsa.com.pe", plataforma: "magento", rubros: ["ferreteria"] },
  { id: "sole.com.pe", nombre: "Sole", base: "https://www.sole.com.pe", plataforma: "magento", rubros: ["hogar", "ferreteria"] },
  { id: "crisol.com.pe", nombre: "Librerías Crisol", base: "https://www.crisol.com.pe", plataforma: "magento", rubros: ["oficina"] },
  { id: "sbs.com.pe", nombre: "Librería SBS", base: "https://www.sbs.com.pe", plataforma: "magento", rubros: ["oficina"] },
  { id: "tiendaonline.soltrak.com.pe", nombre: "Tienda Soltrak (Ferreycorp)", base: "https://tiendaonline.soltrak.com.pe", plataforma: "magento", rubros: ["seguridad", "automotriz"] },
];

/** Palabras que ponen un producto en un rubro, por si el modelo no lo dijo. */
const PALABRAS: Record<Rubro, RegExp> = {
  farmacia: /medic|f[aá]rmac|tableta|c[aá]psula|jarabe|inyect|ampoll|vial|suero|vacuna|vitamin|antibi[oó]t|analg[eé]s|paracetamol|ibuprofeno|amoxicilina|insulina|preservativo|pa[nñ]al/i,
  medico: /jeringa|guante|mascarilla|barbijo|gasa|ap[oó]sito|venda|algod[oó]n|alcohol|antis[eé]pt|cl[oó]rhexidina|yodo|term[oó]metro|tensi[oó]metro|ox[ií]metro|esteto|cat[eé]ter|sonda|reactivo|laboratorio|quir[uú]rg/i,
  oficina: /papel|bond|cuaderno|lapicero|l[aá]piz|folder|archivador|engrapador|grapa|resaltador|plumon|plum[oó]n|corrector|sobre manila|cinta adhesiva|tinta|t[oó]ner|cartucho|[uú]tiles|oficina|escritorio/i,
  computo: /computador|laptop|port[aá]til|monitor|teclado|mouse|impresora|disco duro|ssd|memoria|usb|router|switch|proyector|tablet|cable hdmi|ups|estabilizador|servidor|c[aá]mara web/i,
  ferreteria: /cemento|fierro|varilla|ladrillo|arena|tubo|pvc|tuber[ií]a|codo|v[aá]lvula|pintura|thinner|clavo|tornillo|perno|taladro|amoladora|alambre|cable el[eé]ctrico|interruptor|tomacorriente|foco|luminaria|calamina|madera|triplay|herramienta|ferret/i,
  limpieza: /detergente|lej[ií]a|desinfectante|jab[oó]n|papel higi[eé]nico|papel toalla|escoba|trapeador|recogedor|bolsa de basura|limpia|ambientador|cera|lavavajilla|alcohol en gel|hipoclorito/i,
  alimentos: /arroz|az[uú]car|aceite|fideo|leche|at[uú]n|conserva|harina|menestra|frejol|lenteja|avena|caf[eé]|galleta|agua de mesa|agua mineral|abarrote|v[ií]veres|sal de mesa|huevo|pollo|carne|pan /i,
  hogar: /colch[oó]n|silla|mesa|escritorio|estante|armario|ropero|cama|frazada|cortina|ventilador|refriger|cocina|horno|microondas|licuadora|termo|olla|vajilla|menaje/i,
  seguridad: /casco|chaleco|botas? de seguridad|zapato de seguridad|lentes de seguridad|guantes de seguridad|protector auditivo|respirador|arn[eé]s|extintor|se[nñ]al[eé]tica|cono vial|epp/i,
  automotriz: /llanta|neum[aá]tico|aceite de motor|lubricante|bater[ií]a de auto|filtro de aceite|filtro de aire|pastilla de freno|repuesto|refrigerante|aditivo|grasa/i,
};

/** Los rubros de un producto: los que dio el modelo y, además, los que delatan sus palabras. */
export function rubrosDe(delModelo: unknown, texto: string): Rubro[] {
  const dados = (Array.isArray(delModelo) ? delModelo : []).map(String).filter((r): r is Rubro => (RUBROS as string[]).includes(r));
  const porPalabras = RUBROS.filter((r) => PALABRAS[r].test(texto));
  return [...new Set([...dados, ...porPalabras])];
}

/** Las tiendas a preguntar para esos rubros (las de más rubros en común primero), hasta `max`. */
export function tiendasPara(rubros: Rubro[], max: number): TiendaDirectorio[] {
  if (!rubros.length) return [];
  const pide = new Set(rubros);
  return DIRECTORIO.map((t) => ({ t, n: t.rubros.filter((r) => pide.has(r)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => x.t);
}

export interface ProductoApi {
  titulo: string;
  marca: string | null;
  precio: number;
  moneda: string;
  url: string;
  disponible: boolean | null;
}

/** La dirección del pedido y, si es POST, su cuerpo. */
export function pedidoDe(t: TiendaDirectorio, termino: string): { url: string; metodo: "GET" | "POST"; cuerpo?: string } {
  const extra = t.parametros ? `&${t.parametros}` : "";
  switch (t.plataforma) {
    case "woocommerce":
      return { url: `${t.base}/wp-json/wc/store/v1/products?search=${q(termino)}&per_page=20${extra}`, metodo: "GET" };
    case "shopify":
      return { url: `${t.base}/search/suggest.json?q=${q(termino)}&resources%5Btype%5D=product&resources%5Blimit%5D=10${extra}`, metodo: "GET" };
    case "vtex":
      return { url: `${t.base}/api/catalog_system/pub/products/search?ft=${q(termino)}&_from=0&_to=19${extra}`, metodo: "GET" };
    case "magento":
      return {
        url: `${t.base}/graphql`,
        metodo: "POST",
        cuerpo: JSON.stringify({
          query: `{ products(search: ${JSON.stringify(termino)}, pageSize: 20) { items { name url_key url_suffix price_range { minimum_price { final_price { value currency } } } stock_status } } }`,
        }),
      };
    case "navegador":
      return { url: t.buscador ? t.buscador(termino) : t.base, metodo: "GET" };
  }
}

const num = (x: unknown) => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const absoluta = (base: string, u: unknown) => {
  try {
    return new URL(String(u ?? ""), base).toString();
  } catch {
    return null;
  }
};
const limpio = (s: unknown) => decodificarEntidades(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 240);

interface Woo { name?: string; permalink?: string; is_in_stock?: boolean; prices?: { price?: string; currency_code?: string; currency_minor_unit?: number }; brands?: { name?: string }[] }
interface Shopify { resources?: { results?: { products?: { title?: string; price?: string | number; url?: string; vendor?: string; available?: boolean }[] } } }
interface Vtex { productName?: string; brand?: string; link?: string; items?: { sellers?: { commertialOffer?: { Price?: number; AvailableQuantity?: number } }[] }[] }
interface Magento { data?: { products?: { items?: { name?: string; url_key?: string; url_suffix?: string | null; stock_status?: string; price_range?: { minimum_price?: { final_price?: { value?: number; currency?: string } } } }[] } } }

/**
 * Los productos de la respuesta JSON de cada plataforma. Precio en soles (las que no son PEN se dejan con su moneda:
 * `validar` las descarta después). Shopify: `price` viene en la moneda de la tienda con decimales, salvo tiendas que lo
 * dan en céntimos como entero (> 100 veces lo razonable): el directorio marca esas con `parametros`.
 */
export function leerRespuesta(t: TiendaDirectorio, j: unknown): ProductoApi[] {
  const out: ProductoApi[] = [];
  const poner = (p: ProductoApi | null) => {
    if (p && p.titulo && p.precio > 0 && p.url) out.push(p);
  };
  if (t.plataforma === "woocommerce" && Array.isArray(j)) {
    for (const x of j as Woo[]) {
      const menor = x.prices?.currency_minor_unit ?? 2;
      const crudo = num(x.prices?.price);
      poner({
        titulo: limpio(x.name),
        marca: x.brands?.[0]?.name ? limpio(x.brands[0].name) : null,
        precio: crudo == null ? 0 : crudo / 10 ** menor,
        moneda: (x.prices?.currency_code ?? "PEN").toUpperCase(),
        url: absoluta(t.base, x.permalink) ?? "",
        disponible: x.is_in_stock ?? null,
      });
    }
  } else if (t.plataforma === "shopify") {
    const centimos = /precio=centimos/.test(t.parametros ?? "");
    for (const x of (j as Shopify).resources?.results?.products ?? []) {
      const p = num(x.price);
      poner({
        titulo: limpio(x.title),
        marca: x.vendor ? limpio(x.vendor) : null,
        precio: p == null ? 0 : centimos ? p / 100 : p,
        moneda: "PEN",
        url: absoluta(t.base, x.url) ?? "",
        disponible: x.available ?? null,
      });
    }
  } else if (t.plataforma === "vtex" && Array.isArray(j)) {
    for (const x of j as Vtex[]) {
      const oferta = x.items?.flatMap((i) => i.sellers ?? []).map((s) => s.commertialOffer).find((o) => (o?.Price ?? 0) > 0);
      poner({
        titulo: limpio(x.productName),
        marca: x.brand ? limpio(x.brand) : null,
        precio: oferta?.Price ?? 0,
        moneda: "PEN",
        url: absoluta(t.base, x.link) ?? "",
        disponible: oferta ? (oferta.AvailableQuantity ?? 0) > 0 : null,
      });
    }
  } else if (t.plataforma === "magento") {
    for (const x of (j as Magento).data?.products?.items ?? []) {
      const f = x.price_range?.minimum_price?.final_price;
      poner({
        titulo: limpio(x.name),
        marca: null,
        precio: f?.value ?? 0,
        moneda: (f?.currency ?? "PEN").toUpperCase(),
        url: x.url_key ? (absoluta(t.base, `/${x.url_key}${x.url_suffix ?? ".html"}`) ?? "") : "",
        disponible: x.stock_status ? x.stock_status === "IN_STOCK" : null,
      });
    }
  }
  return out;
}

export type { EnvTurnos };
