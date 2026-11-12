/**
 * De dónde salen las ofertas.
 *
 *   tiendas   vigia-precios (service binding): 15 tiendas peruanas por la misma búsqueda que hace su web, con caché de
 *             7 días, un pedido por segundo a cada tienda y pausa de la que falla. Precio estructurado (no hay que leer
 *             la página).
 *   web       Tavily (búsqueda web con clave propia, ~US$ 0,008 por búsqueda): páginas de venta en el Perú que no son
 *             esas tiendas. Cada página se lee después (`leerUrl`).
 *
 * `leerUrl` lee una página con cortesía: respeta robots.txt, espera su turno por dominio (≤ 1 pedido por segundo),
 * se presenta con su nombre (sin hacerse pasar por un navegador), corta las respuestas grandes y no insiste si el sitio
 * dice que no (403, 429, desafío). Si la página no trae el precio en el HTML (tiendas armadas con JavaScript), puede
 * abrirla un navegador de Cloudflare (Browser Run), con tope por investigación.
 */
import puppeteer from "@cloudflare/puppeteer";
import { leerPagina, robotsPermite, textoVisible } from "./extraer.ts";
import { esperarTurno, type EnvTurnos } from "./turnos.ts";
import type { Gasto, Lectura } from "./tipos.ts";

export const USER_AGENT = "VigiaPeru-PreciosLab/0.1 (+https://vigia.gobserva.cloud; precios de referencia de compras públicas)";
const TOPE_BYTES = 4_000_000;
const COSTO_TAVILY = 0.008;

export interface EnvFuentes extends EnvTurnos {
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

export interface ResultadoWeb {
  titulo: string;
  url: string;
  extracto: string;
}

/** Tavily: páginas en el Perú (caché de 3 días en D1 por la misma búsqueda). */
export async function buscarWeb(env: EnvFuentes, gasto: Gasto, consulta: string, excluirDominios: string[]): Promise<ResultadoWeb[]> {
  if (!env.TAVILY_API_KEY) return [];
  const clave = `tavily|${consulta.toLowerCase()}`;
  const c = await env.DB.prepare("SELECT valor, creado FROM cache_busqueda WHERE clave = ?").bind(clave).first<{ valor: string; creado: number }>();
  let resultados: ResultadoWeb[];
  if (c && Date.now() - c.creado < 3 * 86_400_000) {
    resultados = JSON.parse(c.valor) as ResultadoWeb[];
  } else {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query: consulta, search_depth: "basic", max_results: 12, country: "peru", include_answer: false }),
    });
    gasto.busquedasWeb += 1;
    gasto.costoWeb += COSTO_TAVILY;
    if (!r.ok) throw new Error(`tavily ${r.status}`);
    const j = (await r.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    resultados = (j.results ?? [])
      .filter((x) => x.url && /^https?:\/\//.test(x.url))
      .map((x) => ({ titulo: String(x.title ?? "").slice(0, 200), url: x.url!, extracto: String(x.content ?? "").slice(0, 400) }));
    await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, valor, creado) VALUES (?, ?, ?)").bind(clave, JSON.stringify(resultados), Date.now()).run();
  }
  const fuera = new Set(excluirDominios.map((d) => d.replace(/^www\./, "")));
  return resultados.filter((x) => !fuera.has(dominioDe(x.url)));
}

export const dominioDe = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** robots.txt del sitio (caché de 1 día en D1). Sin robots, se puede. */
async function permitido(env: EnvFuentes, url: URL): Promise<boolean> {
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
  return robotsPermite(texto, url.pathname + url.search);
}

export interface PaginaLeida {
  url: string;
  estado: "ok" | "robots" | "rechazo" | "error" | "sin_precio";
  detalle: string | null;
  lectura: Lectura | null;
  visible: string;
  navegador: boolean;
}

async function conNavegador(env: EnvFuentes, gasto: Gasto, url: string): Promise<string | null> {
  if (!env.BROWSER) return null;
  const t0 = Date.now();
  const nav = await puppeteer.launch(env.BROWSER);
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

/** Lee una página con cortesía. `navegador`: si el HTML no trae precio, ¿se abre con Browser Run? */
export async function leerUrl(env: EnvFuentes, gasto: Gasto, direccion: string, navegador: boolean): Promise<PaginaLeida> {
  let url: URL;
  try {
    url = new URL(direccion);
  } catch {
    return { url: direccion, estado: "error", detalle: "URL inválida", lectura: null, visible: "", navegador: false };
  }
  if (!(await permitido(env, url))) return { url: direccion, estado: "robots", detalle: "robots.txt no permite leerla", lectura: null, visible: "", navegador: false };
  await esperarTurno(env, url.hostname);
  let html = "";
  try {
    const r = await fetch(url.toString(), {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "es-PE,es;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 403 || r.status === 429 || r.status === 401) {
      return { url: direccion, estado: "rechazo", detalle: `el sitio respondió ${r.status}`, lectura: null, visible: "", navegador: false };
    }
    if (!r.ok) return { url: direccion, estado: "error", detalle: `HTTP ${r.status}`, lectura: null, visible: "", navegador: false };
    if (!/html|xml/i.test(r.headers.get("content-type") ?? "")) return { url: direccion, estado: "error", detalle: "no es una página", lectura: null, visible: "", navegador: false };
    html = (await r.text()).slice(0, TOPE_BYTES);
  } catch (e) {
    return { url: direccion, estado: "error", detalle: String((e as Error).message ?? e).slice(0, 120), lectura: null, visible: "", navegador: false };
  }
  // Una página de desafío (Cloudflare, captcha) no se intenta pasar.
  if (/<title>\s*(just a moment|attention required|access denied)/i.test(html.slice(0, 5_000)) || (html.length < 80_000 && /challenge-platform|cf-chl-|g-recaptcha|h-captcha/i.test(html))) {
    return { url: direccion, estado: "rechazo", detalle: "el sitio pide verificar que eres humano", lectura: null, visible: "", navegador: false };
  }
  let lectura = leerPagina(html);
  let visible = textoVisible(html);
  let usoNavegador = false;
  if (!lectura && navegador) {
    const rendido = await conNavegador(env, gasto, url.toString());
    if (rendido) {
      usoNavegador = true;
      lectura = leerPagina(rendido);
      visible = textoVisible(rendido);
    }
  }
  return { url: direccion, estado: lectura ? "ok" : "sin_precio", detalle: null, lectura, visible, navegador: usoNavegador };
}
