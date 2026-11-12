/**
 * Crawl4AI (Apache 2.0) en un contenedor de Cloudflare (2026-11-12). El usuario: «Crawl4AI integra… usa contenedor en
 * Cloudflare». Abre con Chromium las páginas que arman el precio con JavaScript (buscadores de tiendas, fichas de
 * producto) y devuelve el HTML ya armado y su texto en Markdown.
 *
 * La imagen sale tal cual de Docker Hub (unclecode/crawl4ai, fijada por versión en wrangler.jsonc). Escucha en el
 * puerto 11235 y no tiene salida al público: solo este Worker le habla, por el Durable Object `Lector`. Se duerme a
 * los 5 minutos sin uso (se cobra solo mientras corre).
 *
 * Cortesía: el Worker revisa robots.txt y espera el turno del dominio ANTES de pedirle una página (fuentes.ts). Al
 * navegador se le pide que se presente con nuestro nombre, que no cargue imágenes y que no simule a una persona
 * (sin magic, simulate_user ni override_navigator): si el sitio pone un desafío, la página queda como rechazo.
 */
import { Container, getContainer } from "@cloudflare/containers";
import type { Gasto } from "./tipos.ts";

interface EnvContenedor {
  /** Token de Crawl4AI (secreto del Worker = SSM /vigia/precios-lab/crawl4ai-token). */
  CRAWL4AI_TOKEN?: string;
}

export class Lector extends Container<EnvContenedor> {
  defaultPort = 11235;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<{}>, env: EnvContenedor) {
    super(ctx, env);
    // Crawl4AI 0.9.4 solo escucha fuera de su propio loopback si tiene token (entrypoint.sh); sin él, el Worker no
    // lo alcanza en 10.0.0.1:11235. Cada pedido lleva el token (rendir).
    this.envVars = { CRAWL4AI_ALLOW_DEEP_CRAWL: "false", CRAWL4AI_API_TOKEN: env.CRAWL4AI_TOKEN ?? "", GUNICORN_BIND: "0.0.0.0:11235" };
    // La imagen solo trae `CMD ["bash", "entrypoint.sh"]` (sin ENTRYPOINT, relativo a /app): en Cloudflare salía con
    // código 0 sin levantar nada. Con el comando explícito arranca en ~2 s (diagnóstico del 2026-11-12).
    this.entrypoint = ["bash", "-c", "cd /app && exec bash entrypoint.sh"];
  }

  override onStop(p: { exitCode?: number; reason?: string }) {
    if (p.exitCode) console.warn("crawl4ai se detuvo", JSON.stringify(p));
  }

  override onError(e: unknown) {
    console.warn("crawl4ai falló", String((e as Error)?.message ?? e).slice(0, 500));
    return super.onError(e);
  }
}

export interface EnvLector extends EnvContenedor {
  LECTOR?: DurableObjectNamespace<Lector>;
}

/** standard-1 (½ vCPU, 4 GiB, 8 GB): memoria y disco mientras corre + CPU activa, tarifa de Workers Paid. */
export const COSTO_SEGUNDO_CONTENEDOR = 4 * 0.0000025 + 8 * 0.00000007 + 0.5 * 0.00002;

export interface Rendida {
  html: string;
  markdown: string;
  estado: number | null;
  enlaces: string[];
}

interface RespuestaCrawl {
  success?: boolean;
  results?: {
    success?: boolean;
    html?: string;
    status_code?: number | null;
    error_message?: string | null;
    markdown?: { raw_markdown?: string; fit_markdown?: string } | string | null;
    links?: { internal?: { href?: string }[]; external?: { href?: string }[] };
  }[];
}

const TOPE_HTML = 4_000_000;

/**
 * Abre una página con Crawl4AI. null si no hay contenedor o no respondió (la página queda «sin precio», no tumba el
 * paso). `agente` es nuestro User-Agent.
 */
export async function rendir(env: EnvLector, gasto: Gasto, url: string, agente: string, esperar = 2): Promise<Rendida | null> {
  if (!env.LECTOR || !env.CRAWL4AI_TOKEN) return null;
  const t0 = Date.now();
  // Solo se cuenta el tiempo si el contenedor respondió: si no llegó a arrancar, Cloudflare no lo cobra.
  let respondio = false;
  try {
    const lector = getContainer(env.LECTOR, "lector");
    // Crawl4AI levanta Redis, su servidor y Chromium antes de abrir el puerto: tarda más que los 20 s que espera
    // `fetch` por defecto («not listening in the TCP address 10.0.0.1:11235», 2026-11-12).
    await lector.startAndWaitForPorts({ ports: 11235, cancellationOptions: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 150_000, waitInterval: 1_000 } });
    const r = await lector.fetch(
      new Request("http://lector/crawl", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.CRAWL4AI_TOKEN}` },
        body: JSON.stringify({
          urls: [url],
          browser_config: { type: "BrowserConfig", params: { headless: true, user_agent: agente, text_mode: true, light_mode: true } },
          crawler_config: {
            type: "CrawlerRunConfig",
            params: {
              cache_mode: "bypass",
              check_robots_txt: true,
              page_timeout: 40_000,
              wait_until: "domcontentloaded",
              delay_before_return_html: esperar,
              magic: false,
              simulate_user: false,
              override_navigator: false,
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }),
    );
    respondio = r.status < 500;
    if (!r.ok) {
      console.warn("crawl4ai", r.status, (await r.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const j = (await r.json()) as RespuestaCrawl;
    const x = j.results?.[0];
    if (!x || x.success === false || !x.html) return null;
    const md = typeof x.markdown === "string" ? x.markdown : (x.markdown?.raw_markdown ?? "");
    const enlaces = [...(x.links?.internal ?? []), ...(x.links?.external ?? [])].map((l) => l.href ?? "").filter((h) => /^https?:\/\//.test(h));
    return { html: x.html.slice(0, TOPE_HTML), markdown: md.slice(0, 400_000), estado: x.status_code ?? null, enlaces: [...new Set(enlaces)].slice(0, 2000) };
  } catch (e) {
    console.warn("crawl4ai", String((e as Error)?.message ?? e).slice(0, 300));
    return null;
  } finally {
    if (respondio) gasto.segundosContenedor += (Date.now() - t0) / 1000;
  }
}
