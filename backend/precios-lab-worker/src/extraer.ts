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

/** ¿El robots.txt deja leer esta ruta a cualquier agente? Reglas de `User-agent: *` (Allow gana si es más largo). */
export function robotsPermite(robots: string, ruta: string): boolean {
  let enGrupo = false, vioAgente = false;
  const reglas: { permitir: boolean; prefijo: string }[] = [];
  for (const cruda of robots.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*/, "").trim();
    if (!linea) continue;
    const [k, ...resto] = linea.split(":");
    const clave = k.trim().toLowerCase(), valor = resto.join(":").trim();
    if (clave === "user-agent") {
      if (vioAgente && !enGrupo) enGrupo = false;
      enGrupo = valor === "*" ? true : enGrupo && !vioAgente;
      vioAgente = false;
    } else if (enGrupo && (clave === "disallow" || clave === "allow")) {
      vioAgente = true;
      if (valor) reglas.push({ permitir: clave === "allow", prefijo: valor.replace(/\*.*$/, "") });
    }
  }
  let mejor: { permitir: boolean; prefijo: string } | null = null;
  for (const r of reglas) if (ruta.startsWith(r.prefijo) && (!mejor || r.prefijo.length > mejor.prefijo.length)) mejor = r;
  return mejor ? mejor.permitir : true;
}
