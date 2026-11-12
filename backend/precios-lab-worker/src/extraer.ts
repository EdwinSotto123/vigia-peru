/**
 * Leer el precio de una página de producto SIN modelo: lo que la tienda publica para los buscadores (schema.org).
 *
 *   1. JSON-LD (`<script type="application/ld+json">`): Product → offers (Offer o AggregateOffer), también dentro de
 *      @graph o de listas. Es lo más confiable: lo escribe la tienda para Google.
 *   2. Microdatos (`itemprop="price"` con `content`).
 *   3. Open Graph de producto (`product:price:amount`).
 *
 * Validación cruzada: el precio leído tiene que aparecer también en el texto visible (`confirmarEnTexto`); si no, la
 * oferta queda marcada como no confirmada (la tienda pudo dejar un precio viejo en los metadatos).
 * Funciones puras, con pruebas en test/extraer.test.ts.
 */
import type { Lectura } from "./tipos.ts";

const RE_JSONLD = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** «S/ 1,299.90», «1.299,90», «1 299.90», «12.5» → número; null si no parece un precio. */
export function numeroPrecio(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma > -1 && punto > -1) {
    // El último separador es el decimal.
    s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (coma > -1) {
    // «1,299» (miles) frente a «12,50» (decimal): con 3 cifras después es miles.
    s = /,\d{3}$/.test(s) && !/,\d{3},/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
    if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\.(?=.*\.)/g, "");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\.(?=.*\.)/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function* nodos(x: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(x)) {
    for (const y of x) yield* nodos(y);
  } else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    yield o;
    if (Array.isArray(o["@graph"])) yield* nodos(o["@graph"]);
  }
}

const esTipo = (o: Record<string, unknown>, t: string) => {
  const v = o["@type"];
  return v === t || (Array.isArray(v) && v.includes(t));
};

const texto = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string") return ((v as Record<string, unknown>).name as string).trim() || null;
  return null;
};

/** El primer Product con precio de los bloques JSON-LD de la página. */
export function leerJsonLd(html: string): Lectura | null {
  for (const m of html.matchAll(RE_JSONLD)) {
    let datos: unknown;
    try {
      datos = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ""));
    } catch {
      continue;
    }
    for (const o of nodos(datos)) {
      if (!esTipo(o, "Product") && !esTipo(o, "ProductGroup")) continue;
      for (const of of nodos(o.offers ?? (o.hasVariant as unknown[] | undefined)?.map((v) => (v as Record<string, unknown>).offers))) {
        const precio = numeroPrecio(of.price ?? of.lowPrice ?? (of.priceSpecification as Record<string, unknown> | undefined)?.price);
        if (precio == null) continue;
        const moneda = texto(of.priceCurrency ?? (of.priceSpecification as Record<string, unknown> | undefined)?.priceCurrency);
        const disp = texto(of.availability);
        return {
          titulo: texto(o.name),
          marca: texto(o.brand),
          precio,
          moneda: moneda?.toUpperCase() ?? null,
          disponibilidad: disp ? disp.replace(/^https?:\/\/schema\.org\//i, "") : null,
          metodo: "json_ld",
          fragmento: JSON.stringify({ name: o.name, brand: o.brand, offers: of }).slice(0, 1500),
        };
      }
    }
  }
  return null;
}

/**
 * El listado empieza donde aparece el primer precio en soles: lo de antes suele ser menú y promociones. Se deja un
 * margen para el título del primer producto. Sin precios, el texto entero.
 */
export function desdeElPrimerPrecio(texto: string, margen = 1500): string {
  const i = texto.search(/S\/\s?\d/);
  return i < 0 ? texto : texto.slice(Math.max(0, i - margen));
}

/** Todos los objetos de un JSON (los listados anidan Product dentro de ItemList → ListItem → item). */
function* todos(x: unknown, hondo = 0): Generator<Record<string, unknown>> {
  if (hondo > 8) return;
  if (Array.isArray(x)) {
    for (const y of x) yield* todos(y, hondo + 1);
  } else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    yield o;
    for (const v of Object.values(o)) if (v && typeof v === "object") yield* todos(v, hondo + 1);
  }
}

export interface ItemListado {
  titulo: string;
  marca: string | null;
  precio: number;
  moneda: string | null;
  url: string | null;
  fragmento: string;
}

/** Los productos con precio que el buscador de una tienda publica en JSON-LD (ItemList de Product). */
export function leerListadoJsonLd(html: string, base: string, tope = 40): ItemListado[] {
  const salida: ItemListado[] = [];
  const vistos = new Set<string>();
  for (const m of html.matchAll(RE_JSONLD)) {
    let datos: unknown;
    try {
      datos = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ""));
    } catch {
      continue;
    }
    for (const o of todos(datos)) {
      if (!esTipo(o, "Product") || !texto(o.name)) continue;
      for (const of of nodos(o.offers)) {
        const precio = numeroPrecio(of.price ?? of.lowPrice);
        if (precio == null) continue;
        let url: string | null = null;
        try {
          const u = texto(o.url) ?? texto(of.url);
          url = u ? new URL(u, base).toString() : null;
        } catch {
          url = null;
        }
        const clave = `${url ?? texto(o.name)}|${precio}`;
        if (vistos.has(clave)) break;
        vistos.add(clave);
        salida.push({
          titulo: texto(o.name)!.slice(0, 240),
          marca: texto(o.brand),
          precio,
          moneda: texto(of.priceCurrency)?.toUpperCase() ?? null,
          url,
          fragmento: JSON.stringify({ name: o.name, url: o.url, offers: of }).slice(0, 600),
        });
        break;
      }
      if (salida.length >= tope) return salida;
    }
  }
  return salida;
}

const atributo = (etiqueta: string, nombre: string) => new RegExp(`${nombre}\\s*=\\s*["']([^"']*)["']`, "i").exec(etiqueta)?.[1] ?? null;

/** `itemprop="price"` (con `content` o el texto de la etiqueta) y su moneda. */
export function leerMicrodatos(html: string): Lectura | null {
  const m = /<[^>]*itemprop\s*=\s*["']price["'][^>]*>([^<]{0,40})/i.exec(html);
  if (!m) return null;
  const precio = numeroPrecio(atributo(m[0], "content") ?? m[1]);
  if (precio == null) return null;
  const mon = /<[^>]*itemprop\s*=\s*["']priceCurrency["'][^>]*>/i.exec(html);
  const nombre = /<[^>]*itemprop\s*=\s*["']name["'][^>]*>([^<]{1,200})/i.exec(html);
  return {
    titulo: nombre ? (atributo(nombre[0], "content") ?? nombre[1]).trim() : null,
    marca: null,
    precio,
    moneda: mon ? atributo(mon[0], "content")?.toUpperCase() ?? null : null,
    disponibilidad: null,
    metodo: "microdatos",
    fragmento: m[0].slice(0, 400),
  };
}

const meta = (html: string, prop: string) => {
  const re = new RegExp(`<meta[^>]*(?:property|name)\\s*=\\s*["']${prop.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const m = re.exec(html);
  return m ? atributo(m[0], "content") : null;
};

/** Open Graph de producto. */
export function leerOpenGraph(html: string): Lectura | null {
  const precio = numeroPrecio(meta(html, "product:price:amount") ?? meta(html, "og:price:amount"));
  if (precio == null) return null;
  return {
    titulo: meta(html, "og:title"),
    marca: meta(html, "product:brand"),
    precio,
    moneda: (meta(html, "product:price:currency") ?? meta(html, "og:price:currency"))?.toUpperCase() ?? null,
    disponibilidad: meta(html, "product:availability"),
    metodo: "open_graph",
    fragmento: `product:price:amount=${precio}`,
  };
}

/** Lo mejor que se pueda leer sin modelo, en orden de confianza. */
export function leerPagina(html: string): Lectura | null {
  return leerJsonLd(html) ?? leerMicrodatos(html) ?? leerOpenGraph(html);
}

/** El texto visible, sin scripts ni estilos ni etiquetas (para confirmar el precio y para el modelo). */
export function textoVisible(html: string, tope = 200_000): string {
  return html
    .slice(0, 3_000_000)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .slice(0, tope);
}

/** ¿Aparece el precio en el texto visible? Prueba «1299.90», «1,299.90», «1.299,90», «1 299,90» y sin decimales. */
export function confirmarEnTexto(precio: number, visible: string): boolean {
  const ent = Math.trunc(precio), dec = Math.round((precio - ent) * 100);
  const d2 = String(dec).padStart(2, "0");
  const miles = (sep: string) => String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const formas = new Set<string>([`${ent}.${d2}`, `${miles(",")}.${d2}`, `${miles(".")},${d2}`, `${miles(" ")},${d2}`, `${ent},${d2}`]);
  if (dec === 0) for (const f of [String(ent), miles(","), miles("."), miles(" ")]) formas.add(f);
  const limpio = visible.replace(/\u00a0/g, " ");
  return [...formas].some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.]/g, "\\.")}(?![\\d])`).test(limpio));
}

/** ¿La ruta calza con el patrón de robots.txt? `*` = cualquier cosa, `$` al final = ahí termina (RFC 9309). */
function calzaPatron(patron: string, ruta: string): boolean {
  const fin = patron.endsWith("$");
  const cuerpo = (fin ? patron.slice(0, -1) : patron)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${cuerpo}${fin ? "$" : ""}`).test(ruta);
}

interface GrupoRobots {
  agentes: string[];
  reglas: { permitir: boolean; patron: string }[];
  senales: string[];
}

/** Los grupos de robots.txt que aplican a este agente: el que lo nombra o, si no hay, el de `*` (RFC 9309). */
function gruposQueAplican(robots: string, agente: string): GrupoRobots[] {
  const grupos: GrupoRobots[] = [];
  let actual: GrupoRobots | null = null;
  let conReglas = false;
  for (const cruda of robots.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*/, "").trim();
    const i = linea.indexOf(":");
    if (i < 0) continue;
    const clave = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();
    if (clave === "user-agent") {
      if (!actual || conReglas) {
        actual = { agentes: [], reglas: [], senales: [] };
        grupos.push(actual);
        conReglas = false;
      }
      actual.agentes.push(valor.toLowerCase());
    } else if (actual && (clave === "allow" || clave === "disallow")) {
      conReglas = true;
      if (valor) actual.reglas.push({ permitir: clave === "allow", patron: valor });
    } else if (actual && clave === "crawl-delay") {
      conReglas = true;
    } else if (actual && clave === "content-signal") {
      conReglas = true;
      actual.senales.push(valor.toLowerCase());
    }
  }
  const propios = grupos.filter((g) => g.agentes.some((a) => a !== "*" && agente.toLowerCase().includes(a)));
  return propios.length ? propios : grupos.filter((g) => g.agentes.includes("*"));
}

/**
 * ¿El robots.txt deja leer esta ruta? (RFC 9309) Se usa el grupo que nombra a este agente o, si no hay, el de `*`; entre
 * las reglas que calzan gana la del patrón más largo y, empatadas, Allow. Sin reglas que calcen, se puede.
 */
export function robotsPermite(robots: string, ruta: string, agente = "vigiaperu-precioslab"): boolean {
  let mejor: { permitir: boolean; largo: number } | null = null;
  for (const g of gruposQueAplican(robots, agente)) {
    for (const r of g.reglas) {
      if (!calzaPatron(r.patron, ruta)) continue;
      if (!mejor || r.patron.length > mejor.largo || (r.patron.length === mejor.largo && r.permitir)) mejor = { permitir: r.permitir, largo: r.patron.length };
    }
  }
  return mejor ? mejor.permitir : true;
}

/**
 * Content Signals (contentsignals.org, los pone Cloudflare en su robots.txt administrado): ¿el sitio dice
 * `ai-input=no`? Leer el precio pasa la página por un modelo (el juicio, la lectura con IA), así que se respeta igual
 * que un Disallow. Sin la señal, ni sí ni no: se puede.
 */
export function robotsNiegaIa(robots: string, agente = "vigiaperu-precioslab"): boolean {
  return gruposQueAplican(robots, agente).some((g) => g.senales.some((s) => /(^|[\s,])ai-input\s*=\s*no\b/.test(s)));
}

export interface ResultadoWeb {
  titulo: string;
  url: string;
  extracto: string;
}

const sinEtiquetas = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** La página de resultados de DuckDuckGo HTML → resultados (sin anuncios). Mismo criterio que busqueda_libre.py. */
export function parsearDdg(texto: string): ResultadoWeb[] {
  const out: ResultadoWeb[] = [];
  for (const blk of texto.split('<div class="result results_links').slice(1)) {
    if (blk.slice(0, 200).includes("result--ad")) continue;
    const a = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(blk);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, "&");
    if (url.includes("duckduckgo.com/l/?")) {
      try {
        url = new URL(url.startsWith("http") ? url : `https:${url}`).searchParams.get("uddg") ?? url;
      } catch {
        continue;
      }
    }
    if (url.includes("duckduckgo.com/y.js") || !/^https?:\/\//.test(url)) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(blk);
    out.push({ titulo: sinEtiquetas(a[2]).slice(0, 200), url, extracto: sn ? sinEtiquetas(sn[1]).slice(0, 400) : "" });
  }
  return out;
}

