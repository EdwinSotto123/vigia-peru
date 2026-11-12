/**
 * De dónde salen las ofertas.
 *
 *   tiendas   vigia-precios (service binding): 15 tiendas peruanas por la misma búsqueda que hace su web, con caché de
 *             7 días, un pedido por segundo a cada tienda y pausa de la que falla. Precio estructurado (no hay que leer
 *             la página).
 *   buscadores  el buscador propio de las tiendas del directorio (directorio.ts) que venden el rubro del producto: la
 *             API pública de su plataforma (WooCommerce, Shopify, VTEX, Magento) o, si se arman con JavaScript y no
 *             tienen API, su página de resultados abierta con Crawl4AI en un contenedor de Cloudflare (lector.ts).
 *             Reemplaza a la búsqueda web (Tavily y DuckDuckGo) desde el 2026-11-12: «todo open source».
 *
 *   web       solo las páginas que pega quien investiga; cada una se lee con `leerUrl`.
 *
 * `leerUrl` lee una página con cortesía: respeta robots.txt (también `Content-Signal: ai-input=no`), espera su turno
 * por dominio (≤ 1 pedido por segundo), se presenta con su nombre (sin hacerse pasar por un navegador), corta las
 * respuestas grandes y no insiste si el sitio dice que no (403, 429, desafío, inicio de sesión). Si la página no trae
 * el precio en el HTML (tiendas armadas con JavaScript), la abre Crawl4AI y, si el contenedor no responde, un
 * navegador de Cloudflare (Browser Run).
 */
import puppeteer from "@cloudflare/puppeteer";
import { leerPagina, robotsNiegaIa, robotsPermite, textoVisible, type ResultadoWeb } from "./extraer.ts";
import { leerRespuesta, pedidoDe, type ProductoApi, type TiendaDirectorio } from "./directorio.ts";
import { rendir, type EnvLector, type Rendida } from "./lector.ts";
import { esperarTurno, type EnvTurnos } from "./turnos.ts";
import type { Gasto, Lectura } from "./tipos.ts";

export const USER_AGENT = "VigiaPeru-PreciosLab/0.1 (+https://vigia.gobserva.cloud; precios de referencia de compras públicas)";
const TOPE_BYTES = 4_000_000;

export interface EnvFuentes extends EnvTurnos, EnvLector {
  DB: D1Database;
  PRECIOS: Fetcher;
  PRECIOS_TOKEN: string;
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

// ─── buscadores de las tiendas del directorio ────────────────────────────────

export interface PaginaBuscador {
  url: string;
  estado: "ok" | "robots" | "rechazo" | "error" | "sin_resultados" | "sin_contenedor";
  detalle: string | null;
  /** navegador: la página armada por Crawl4AI. */
  rendida: Rendida | null;
  /** API: los productos tal como los dio la tienda. */
  productos: ProductoApi[] | null;
}

/**
 * Pregunta a la búsqueda pública de la plataforma de la tienda (directorio.ts), con la misma cortesía que `leerUrl`.
 * Las tiendas sin API (`navegador`) van por `abrirBuscador`.
 */
export async function buscarEnTienda(env: EnvFuentes, gasto: Gasto, t: TiendaDirectorio, termino: string): Promise<PaginaBuscador> {
  if (t.plataforma === "navegador") return abrirBuscador(env, gasto, t, termino);
  const p = pedidoDe(t, termino);
  const fin = (estado: PaginaBuscador["estado"], detalle: string | null, productos: ProductoApi[] | null = null): PaginaBuscador => ({ url: p.url, estado, detalle, rendida: null, productos });
  const url = new URL(p.url);
  const no = await permitido(env, url);
  if (no) return fin("robots", no);
  // Si la tienda pidió esperar (429), no se le vuelve a preguntar en 30 minutos (Shopify lo hace con Cloudflare).
  const pausa = `pausa|${url.host}`;
  const c = await env.DB.prepare("SELECT creado FROM cache_busqueda WHERE clave = ?").bind(pausa).first<{ creado: number }>();
  if (c && Date.now() - c.creado < 30 * 60_000) return fin("rechazo", "la tienda pidió esperar (429); en pausa 30 minutos");
  await esperarTurno(env, url.hostname);
  let texto: string;
  try {
    const r = await fetch(url.toString(), {
      method: p.metodo,
      headers: { "user-agent": USER_AGENT, accept: "application/json", "accept-language": "es-PE,es;q=0.9", ...(p.cuerpo ? { "content-type": "application/json" } : {}) },
      body: p.cuerpo,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429) await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, valor, creado) VALUES (?, '1', ?)").bind(pausa, Date.now()).run();
    if (r.status === 403 || r.status === 429 || r.status === 401) return fin("rechazo", `la tienda respondió ${r.status}`);
    if (!r.ok) return fin("error", `HTTP ${r.status}`);
    texto = (await r.text()).slice(0, TOPE_BYTES);
  } catch (e) {
    return fin("error", String((e as Error).message ?? e).slice(0, 120));
  }
  if (esDesafio(texto)) return fin("rechazo", "la tienda pide verificar que eres humano");
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return fin("error", "la tienda no respondió JSON");
  }
  const productos = leerRespuesta(t, j);
  return productos.length ? fin("ok", null, productos) : fin("sin_resultados", "la búsqueda no trajo productos con precio");
}

/** Abre la página de resultados del buscador con Crawl4AI, con la misma cortesía que `leerUrl`. */
export async function abrirBuscador(env: EnvFuentes, gasto: Gasto, t: TiendaDirectorio, termino: string): Promise<PaginaBuscador> {
  const direccion = pedidoDe(t, termino).url;
  const fin = (estado: PaginaBuscador["estado"], detalle: string | null, rendida: Rendida | null = null): PaginaBuscador => ({ url: direccion, estado, detalle, rendida, productos: null });
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
