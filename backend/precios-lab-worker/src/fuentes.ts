/**
 * De dónde salen las ofertas.
 *
 *   tiendas   vigia-precios (service binding): 15 tiendas peruanas por la misma búsqueda que hace su web, con caché de
 *             7 días, un pedido por segundo a cada tienda y pausa de la que falla. Precio estructurado (no hay que leer
 *             la página).
 *   web       Tavily (búsqueda web con clave propia, ~US$ 0,008 por búsqueda): páginas de venta en el Perú que no son
 *             esas tiendas. Si Tavily falla (p. ej. 432: cupo agotado), DuckDuckGo HTML como los agentes
 *             (tools/busqueda_libre.py): un pedido cada 8 s para todo el laboratorio y, si pide pausa, nada.
 *             Cada página se lee después (`leerUrl`).
 *
 *   buscadores  el buscador propio de tiendas que arman la página con JavaScript y que no están en vigia-precios
 *             (Inkafarma y Mifarma), abierto con Crawl4AI en un contenedor de Cloudflare (lector.ts).
 *
 * `leerUrl` lee una página con cortesía: respeta robots.txt (también `Content-Signal: ai-input=no`), espera su turno
 * por dominio (≤ 1 pedido por segundo), se presenta con su nombre (sin hacerse pasar por un navegador), corta las
 * respuestas grandes y no insiste si el sitio dice que no (403, 429, desafío, inicio de sesión). Si la página no trae
 * el precio en el HTML (tiendas armadas con JavaScript), la abre Crawl4AI y, si el contenedor no responde, un
 * navegador de Cloudflare (Browser Run).
 */
import puppeteer from "@cloudflare/puppeteer";
import { leerPagina, parsearDdg, robotsNiegaIa, robotsPermite, textoVisible, type ResultadoWeb } from "./extraer.ts";
import { rendir, type EnvLector, type Rendida } from "./lector.ts";
import { esperarTurno, type EnvTurnos } from "./turnos.ts";
import type { Gasto, Lectura } from "./tipos.ts";

export const USER_AGENT = "VigiaPeru-PreciosLab/0.1 (+https://vigia.gobserva.cloud; precios de referencia de compras públicas)";
const TOPE_BYTES = 4_000_000;
const COSTO_TAVILY = 0.008;

export interface EnvFuentes extends EnvTurnos, EnvLector {
  DB: D1Database;
  PRECIOS: Fetcher;
  PRECIOS_TOKEN: string;
  TAVILY_API_KEY?: string;
  BROWSER?: Fetcher;
}

export interface ProductoTienda {
  tienda: string;
  producto: string;
  marca: string | null;
  precio: number;
  precio_lista: number | null;
  unidad_medida: string | null;
  multiplicador: number | null;
  vendedor: string | null;
  url: string;
}

/** Busca en las tiendas de vigia-precios. Devuelve los productos y cómo respondió cada tienda. */
export async function buscarTiendas(env: EnvFuentes, termino: string, n = 4): Promise<{ productos: ProductoTienda[]; tiendas: Record<string, { fuente: string; n: number }> }> {
  const r = await env.PRECIOS.fetch(
    new Request(`https://vigia-precios.interno/tiendas/buscar?q=${encodeURIComponent(termino)}&n=${n}`, {
      headers: { authorization: `Bearer ${env.PRECIOS_TOKEN}` },
    }),
  );
  if (!r.ok) throw new Error(`vigia-precios ${r.status}`);
  const j = (await r.json()) as { productos?: ProductoTienda[]; tiendas?: Record<string, { fuente: string; n: number }> };
  return { productos: j.productos ?? [], tiendas: j.tiendas ?? {} };
}

export type { ResultadoWeb };

/** Tavily: páginas en el Perú (caché de 3 días en D1 por la misma búsqueda). */
export async function buscarWeb(env: EnvFuentes, gasto: Gasto, consulta: string, excluirDominios: string[]): Promise<ResultadoWeb[]> {
  if (!env.TAVILY_API_KEY) return [];
  const clave = `tavily|${consulta.toLowerCase()}`;
  const c = await env.DB.prepare("SELECT valor, creado FROM cache_busqueda WHERE clave = ?").bind(clave).first<{ valor: string; creado: number }>();
  let resultados: ResultadoWeb[];
  if (c && Date.now() - c.creado < 3 * 86_400_000) {
    resultados = JSON.parse(c.valor) as ResultadoWeb[];
  } else {
    // 432 = cupo de la cuenta agotado (y 401/403, clave inválida): no se vuelve a pedir hasta mañana.
    if (await enPausa(env, "tavily|sin_cupo", 86_400_000)) throw new Error("Tavily sin cupo (en pausa hasta mañana)");
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query: consulta, search_depth: "basic", max_results: 12, country: "peru", include_answer: false }),
    });
    if ([401, 403, 432, 433].includes(r.status)) await pausar(env, "tavily|sin_cupo");
    if (!r.ok) throw new Error(`Tavily respondió ${r.status}`);
    gasto.busquedasWeb += 1;
    gasto.costoWeb += COSTO_TAVILY;
    const j = (await r.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    resultados = (j.results ?? [])
      .filter((x) => x.url && /^https?:\/\//.test(x.url))
      .map((x) => ({ titulo: String(x.title ?? "").slice(0, 200), url: x.url!, extracto: String(x.content ?? "").slice(0, 400) }));
    await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, valor, creado) VALUES (?, ?, ?)").bind(clave, JSON.stringify(resultados), Date.now()).run();
  }
  const fuera = new Set(excluirDominios.map((d) => d.replace(/^www\./, "")));
  return resultados.filter((x) => !fuera.has(dominioDe(x.url)));
}

async function enPausa(env: EnvFuentes, clave: string, ms: number): Promise<boolean> {
  const c = await env.DB.prepare("SELECT creado FROM cache_busqueda WHERE clave = ?").bind(clave).first<{ creado: number }>();
  return !!c && Date.now() - c.creado < ms;
}

async function pausar(env: EnvFuentes, clave: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, valor, creado) VALUES (?, '1', ?)").bind(clave, Date.now()).run();
}

/** DuckDuckGo HTML (gratis): un pedido cada 8 s para todo el laboratorio; si pide pausa (202), 10 minutos sin pedir. */
export async function buscarLibre(env: EnvFuentes, consulta: string, excluirDominios: string[]): Promise<ResultadoWeb[]> {
  if (await enPausa(env, "ddg|pausa", 600_000)) throw new Error("DuckDuckGo en pausa (pidió esperar)");
  await esperarTurno(env, "duckduckgo.com", 8_000);
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT, "accept-language": "es-PE,es;q=0.9" },
    body: new URLSearchParams({ q: consulta, kl: "pe-es" }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  if (r.status !== 200 || texto.slice(0, 3000).includes("bots use DuckDuckGo")) {
    if (r.status === 202 || r.status === 403 || r.status === 429 || r.status === 200) await pausar(env, "ddg|pausa");
    throw new Error(`DuckDuckGo respondió ${r.status}`);
  }
  const fuera = new Set(excluirDominios.map((d) => d.replace(/^www\./, "")));
  return parsearDdg(texto).filter((x) => !fuera.has(dominioDe(x.url)));
}

export const dominioDe = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * ¿Se puede leer? robots.txt del sitio (caché de 1 día en D1): la ruta, y que no diga `ai-input=no` (el precio pasa
 * por un modelo). Sin robots, se puede. Devuelve el motivo si no.
 */
async function permitido(env: EnvFuentes, url: URL): Promise<string | null> {
  const clave = `robots|${url.host}`;
  const c = await env.DB.prepare("SELECT valor, creado FROM cache_busqueda WHERE clave = ?").bind(clave).first<{ valor: string; creado: number }>();
  let texto: string;
  if (c && Date.now() - c.creado < 86_400_000) {
    texto = c.valor;
  } else {
    await esperarTurno(env, url.hostname);
    try {
      const r = await fetch(`${url.origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
      texto = r.ok ? (await r.text()).slice(0, 200_000) : "";
    } catch {
      texto = "";
    }
    await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, valor, creado) VALUES (?, ?, ?)").bind(clave, texto, Date.now()).run();
  }
  if (!robotsPermite(texto, url.pathname + url.search)) return "robots.txt no permite leerla";
  if (robotsNiegaIa(texto)) return "el sitio pide no pasar su contenido por modelos de IA (Content-Signal)";
  return null;
}

/** Una página de desafío (Cloudflare, captcha): no se intenta pasar. */
const esDesafio = (html: string) =>
  /<title>\s*(just a moment|attention required|access denied)/i.test(html.slice(0, 5_000)) || (html.length < 80_000 && /challenge-platform|cf-chl-|g-recaptcha|h-captcha/i.test(html));

/** Un muro de inicio de sesión (MercadoLibre, 2026-11-12): nunca se entra con una cuenta. */
const esMuroSesion = (visible: string) =>
  visible.length < 3000 && /ingresa a tu cuenta|inicia sesi[oó]n para continuar|para continuar, (ingresa|inicia)|account-verification/i.test(visible);

export interface PaginaLeida {
  url: string;
  estado: "ok" | "robots" | "rechazo" | "error" | "sin_precio";
  detalle: string | null;
  lectura: Lectura | null;
  visible: string;
  /** Quién armó la página: el HTML tal cual, Crawl4AI (contenedor) o Browser Run. */
  via: "html" | "contenedor" | "navegador";
}

async function conNavegador(env: EnvFuentes, gasto: Gasto, url: string): Promise<string | null> {
  if (!env.BROWSER) return null;
  const t0 = Date.now();
  // Sin navegador disponible (límite de sesiones, cuenta sin Browser Run) la página queda «sin precio», sin tumbar el paso.
  const nav = await puppeteer.launch(env.BROWSER).catch(() => null);
  if (!nav) return null;
  try {
    const p = await nav.newPage();
    await p.setUserAgent(USER_AGENT);
    await p.goto(url, { waitUntil: "networkidle0", timeout: 25_000 });
    return (await p.content()).slice(0, TOPE_BYTES);
  } catch {
    return null;
  } finally {
    await nav.close().catch(() => undefined);
    gasto.segundosNavegador += (Date.now() - t0) / 1000;
  }
}

/**
 * Lee una página con cortesía. `armar`: si el HTML no trae precio (página armada con JavaScript), ¿se abre con
 * Crawl4AI (y, si el contenedor no responde, con Browser Run)?
 */
export async function leerUrl(env: EnvFuentes, gasto: Gasto, direccion: string, armar: boolean): Promise<PaginaLeida> {
  const fin = (estado: PaginaLeida["estado"], detalle: string | null): PaginaLeida => ({ url: direccion, estado, detalle, lectura: null, visible: "", via: "html" });
  let url: URL;
  try {
    url = new URL(direccion);
  } catch {
    return fin("error", "URL inválida");
  }
  const no = await permitido(env, url);
  if (no) return fin("robots", no);
  await esperarTurno(env, url.hostname);
  let html = "";
  try {
    const r = await fetch(url.toString(), {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "es-PE,es;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 403 || r.status === 429 || r.status === 401) return fin("rechazo", `el sitio respondió ${r.status}`);
    if (!r.ok) return fin("error", `HTTP ${r.status}`);
    if (!/html|xml/i.test(r.headers.get("content-type") ?? "")) return fin("error", "no es una página");
    html = (await r.text()).slice(0, TOPE_BYTES);
  } catch (e) {
    return fin("error", String((e as Error).message ?? e).slice(0, 120));
  }
  if (esDesafio(html)) return fin("rechazo", "el sitio pide verificar que eres humano");
  let lectura = leerPagina(html);
  let visible = textoVisible(html);
  if (!lectura && esMuroSesion(visible)) return fin("rechazo", "pide iniciar sesión para ver el producto");
  let via: PaginaLeida["via"] = "html";
  if (!lectura && armar) {
    await esperarTurno(env, url.hostname);
    const c = await rendir(env, gasto, url.toString(), USER_AGENT);
    const armada = c?.html ?? (await conNavegador(env, gasto, url.toString()));
    if (armada) {
      if (esDesafio(armada)) return fin("rechazo", "el sitio pide verificar que eres humano");
      via = c ? "contenedor" : "navegador";
      lectura = leerPagina(armada);
      visible = textoVisible(armada);
      if (!lectura && esMuroSesion(visible)) return fin("rechazo", "pide iniciar sesión para ver el producto");
    }
  }
  return { url: direccion, estado: lectura ? "ok" : "sin_precio", detalle: null, lectura, visible, via };
}

// ─── buscadores de tiendas (Crawl4AI) ────────────────────────────────────────

export interface Buscador {
  id: string;
  /** La página de resultados del buscador de la tienda para un término. */
  url: (q: string) => string;
  /** Solo para productos de salud (las farmacias). */
  salud?: boolean;
}

const q = encodeURIComponent;

/**
 * Tiendas peruanas que no están en vigia-precios y cuyo buscador permite robots.txt (revisado el 2026-11-12). Fuera:
 * MercadoLibre (manda a verificar la cuenta), Memory Kings e Impacto (robots prohíbe su buscador), Dimerc y Sercoplus
 * (nos responden 403), La Curacao y Efe (robots prohíbe /catalogsearch/ y /search/), Crisol (prohíbe `/*?`), Real Plaza
 * (realplaza.com ya es solo la web del centro comercial) y Makro (su listado no muestra precios sin elegir tienda; su API
 * VTEX sí los da, así que le toca a vigia-precios).
 */
export const BUSCADORES: Buscador[] = [
  { id: "inkafarma.pe", url: (t) => `https://inkafarma.pe/buscador?keyword=${q(t)}`, salud: true },
  { id: "mifarma.com.pe", url: (t) => `https://www.mifarma.com.pe/buscador?keyword=${q(t)}`, salud: true },
];

/** ¿Es un producto de salud? (para preguntar en las farmacias). */
export const esSalud = (texto: string) =>
  /medic|f[aá]rmac|tableta|c[aá]psula|jarabe|inyect|ampoll|vial|suero|vacuna|vitamin|antibi[oó]t|analg[eé]s|paracetamol|ibuprofeno|amoxicilina|insulina|jeringa|guante|mascarilla|barbijo|gasa|ap[oó]sito|venda|alcohol|antis[eé]pt|desinfect|cl[oó]rhexidina|yodo|term[oó]metro|tensi[oó]metro|ox[ií]metro|preservativo|pa[nñ]al/i.test(texto);

export interface PaginaBuscador {
  url: string;
  estado: "ok" | "robots" | "rechazo" | "error" | "sin_resultados" | "sin_contenedor";
  detalle: string | null;
  rendida: Rendida | null;
}

/** Abre la página de resultados del buscador con Crawl4AI, con la misma cortesía que `leerUrl`. */
export async function abrirBuscador(env: EnvFuentes, gasto: Gasto, b: Buscador, termino: string): Promise<PaginaBuscador> {
  const direccion = b.url(termino);
  const fin = (estado: PaginaBuscador["estado"], detalle: string | null, rendida: Rendida | null = null): PaginaBuscador => ({ url: direccion, estado, detalle, rendida });
  if (!env.LECTOR) return fin("sin_contenedor", "el contenedor de Crawl4AI no está conectado");
  const url = new URL(direccion);
  const no = await permitido(env, url);
  if (no) return fin("robots", no);
  await esperarTurno(env, url.hostname);
  const motivo = { texto: "" };
  // Los listados traen los productos por XHR después de cargar: se espera a que la red quede quieta, y el Markdown
  // va sin encabezado, menús ni pie (en Makro el menú de categorías ocupaba los primeros miles de caracteres).
  const r = await rendir(
    env,
    gasto,
    direccion,
    USER_AGENT,
    {
      // Sin esperar a que la red quede quieta: en Makro (VTEX) nunca pasa y el goto vencía a los 45 s.
      esperar: 2,
      sinEtiquetas: ["header", "nav", "footer", "aside", "form"],
      // Hasta que el listado muestre un precio en soles.
      esperarA: { condicion: "js:() => /S\\/\\s?\\d/.test(document.body ? document.body.innerText : '')", ms: 25_000 },
    },
    motivo,
  );
  // Si en 25 s no apareció ningún precio, la búsqueda no trajo productos (no es una falla).
  if (!r && /wait condition|wait_for|Timeout \d+ms exceeded/i.test(motivo.texto) && !/Page\.goto/i.test(motivo.texto)) {
    return fin("sin_resultados", "no apareció ningún precio en 25 s");
  }
  if (!r) return fin("error", `Crawl4AI no pudo abrirla${motivo.texto ? `: ${motivo.texto}` : ""}`);
  if (r.estado === 403 || r.estado === 429 || r.estado === 401) return fin("rechazo", `el sitio respondió ${r.estado}`);
  if (esDesafio(r.html)) return fin("rechazo", "el sitio pide verificar que eres humano");
  if (esMuroSesion(textoVisible(r.html))) return fin("rechazo", "pide iniciar sesión");
  return fin("ok", null, r);
}
