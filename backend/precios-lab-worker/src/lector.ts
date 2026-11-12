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

/**
 * Cómo arranca Crawl4AI. Diagnóstico del 2026-11-12:
 *   - Sin CRAWL4AI_API_TOKEN, su entrypoint.sh solo escucha en 127.0.0.1 y el Worker no lo alcanza en 10.0.0.1:11235.
 *   - Con supervisord como PID 1 (lo que hace el CMD de la imagen: `exec supervisord`), en Cloudflare no lanza a sus
 *     hijos (ni Redis ni gunicorn; visto por SSH). Con bash como proceso principal y supervisord de hijo, escucha en
 *     ~2 s. Su salida queda en /tmp/arranque.log.
 */
export const arranque = (token: string) => ({
  entrypoint: ["bash", "-c", "cd /app && bash entrypoint.sh > /tmp/arranque.log 2>&1; echo \"supervisord salió: $?\" >> /tmp/arranque.log; sleep 30"],
  envVars: { CRAWL4AI_ALLOW_DEEP_CRAWL: "false", CRAWL4AI_API_TOKEN: token, GUNICORN_BIND: "0.0.0.0:11235" },
});

export class Lector extends Container<EnvContenedor> {
  defaultPort = 11235;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<{}>, env: EnvContenedor) {
    super(ctx, env);
    const a = arranque(env.CRAWL4AI_TOKEN ?? "");
    this.envVars = a.envVars;
    this.entrypoint = a.entrypoint;
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
/** Instancias de las pruebas del 2026-11-12 que quedaron prendidas («lector» con el CMD de la imagen, «diagnostico»). */
const INSTANCIAS_VIEJAS = ["lector", "diagnostico"];

/**
 * Abre una página con Crawl4AI. null si no hay contenedor o no respondió (la página queda «sin precio», no tumba el
 * paso). `agente` es nuestro User-Agent.
 */
export interface OpcionesRender {
  /** Segundos extra después de cargar. */
  esperar?: number;
  /** Esperar a que la red quede quieta (listados que traen los productos por XHR después de cargar). */
  red?: boolean;
  /** Etiquetas que no van al Markdown (menús, encabezado, pie). */
  sinEtiquetas?: string[];
  /** Condición de Crawl4AI (`wait_for`) antes de devolver la página, con su tope en ms. */
  esperarA?: { condicion: string; ms: number };
}

export async function rendir(env: EnvLector, gasto: Gasto, url: string, agente: string, op: OpcionesRender = {}, motivo?: { texto: string }): Promise<Rendida | null> {
  const falla = (t: string) => {
    if (motivo) motivo.texto = t.replace(/\s+/g, " ").slice(0, 400);
    return null;
  };
  if (!env.LECTOR) return falla("sin contenedor");
  if (!env.CRAWL4AI_TOKEN) return falla("falta el secreto CRAWL4AI_TOKEN");
  const t0 = Date.now();
  // Solo se cuenta el tiempo si el contenedor respondió: si no llegó a arrancar, Cloudflare no lo cobra.
  let respondio = false;
  try {
    // Instancia nueva («lector» quedó con un contenedor arrancado por el CMD de la imagen, que no escuchaba).
    const lector = getContainer(env.LECTOR, "crawl4ai");
    // La primera vez en una máquina baja la imagen (1,7 GB): se espera hasta 150 s a que abra el puerto. El arranque
    // va explícito (comando y variables) para no depender del estado que guarde el Durable Object.
    const arrancar = () =>
      lector.startAndWaitForPorts({
        ports: 11235,
        startOptions: arranque(env.CRAWL4AI_TOKEN!),
        cancellationOptions: { instanceGetTimeoutMS: 90_000, portReadyTimeoutMS: 150_000, waitInterval: 1_000 },
      });
    try {
      await arrancar().catch(async (e: unknown) => {
        // Sin cupo (max_instances): se apagan las instancias viejas que quedaron prendidas y se intenta una vez más.
        if (!/Maximum number of running container instances/i.test(String((e as Error)?.message ?? e))) throw e;
        await Promise.all(INSTANCIAS_VIEJAS.map((n) => getContainer(env.LECTOR!, n).destroy().catch(() => undefined)));
        await arrancar();
      });
    } catch (e) {
      // Si no abrió el puerto, se destruye para que el próximo pedido arranque de cero.
      const estado = await lector.getState().catch(() => null);
      console.warn("crawl4ai no arrancó", JSON.stringify(estado), String((e as Error)?.message ?? e).slice(0, 200));
      await lector.destroy().catch(() => undefined);
      return falla(`no arrancó (${estado?.status ?? "?"}): ${String((e as Error)?.message ?? e)}`);
    }
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
              page_timeout: 45_000,
              wait_until: op.red ? "networkidle" : "domcontentloaded",
              delay_before_return_html: op.esperar ?? 2,
              ...(op.sinEtiquetas?.length ? { excluded_tags: op.sinEtiquetas } : {}),
              ...(op.esperarA ? { wait_for: op.esperarA.condicion, wait_for_timeout: op.esperarA.ms } : {}),
              // Sin magic, simulate_user ni override_navigator (Crawl4AI 0.9.4 ni los acepta de un pedido externo:
              // quedan en false) y sin enable_stealth: no se disfraza de persona.
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }),
    );
    respondio = r.status < 500;
    if (!r.ok) {
      const t = (await r.text().catch(() => "")).slice(0, 300);
      console.warn("crawl4ai", r.status, t);
      return falla(`respondió ${r.status}: ${t}`);
    }
    const j = (await r.json()) as RespuestaCrawl;
    const x = j.results?.[0];
    if (!x || x.success === false || !x.html) return falla(`no leyó la página: ${x?.error_message ?? "sin HTML"}`);
    const md = typeof x.markdown === "string" ? x.markdown : (x.markdown?.raw_markdown ?? "");
    const enlaces = [...(x.links?.internal ?? []), ...(x.links?.external ?? [])].map((l) => l.href ?? "").filter((h) => /^https?:\/\//.test(h));
    return { html: x.html.slice(0, TOPE_HTML), markdown: md.slice(0, 400_000), estado: x.status_code ?? null, enlaces: [...new Set(enlaces)].slice(0, 2000) };
  } catch (e) {
    console.warn("crawl4ai", String((e as Error)?.message ?? e).slice(0, 300));
    return falla(String((e as Error)?.message ?? e));
  } finally {
    if (respondio) gasto.segundosContenedor += (Date.now() - t0) / 1000;
  }
}
