// @ts-nocheck
/**
 * Entrada del Worker `vigia-web` en producción (wrangler.jsonc → main): el build de OpenNext envuelto, como
 * worker-dev.js en DEV. No cambia nada del código de la web.
 *
 *   · Todo por el dominio: lo que entra por vigia-web.vigiaperu.workers.dev se redirige a https://vigia.gobserva.cloud
 *     (mismo camino y consulta). En *.workers.dev no hay zona: ni WAF, ni bloqueo de rastreadores de IA, ni límite por
 *     IP de Cloudflare (infrastructure/deploy/cloudflare/gobserva-redirect/README.md). El 2026-10-30 casi todo lo que
 *     llegaba por ahí era el rastreador de entrenamiento de Meta recorriendo /app/personas con filtros.
 *   · Páginas por IP (binding LIMITE_PAGINAS: 300 por minuto; una IPv6 por su /64). No cuentan los prefetch de Next
 *     (`Next-Router-Prefetch`): una lista con 50 enlaces pide 50 de golpe y sólo traen el esqueleto, sin datos.
 *     Los estáticos (/_next/static) no pasan por acá: los entrega Cloudflare antes.
 *   · Lo interno pasa tal cual: la revalidación ISR (WORKER_SELF_REFERENCE) llega sin CF-Connecting-IP, que Cloudflare
 *     pone (y no deja falsificar) en todo pedido que entra de internet.
 */
import abierto from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const DOMINIO = "https://vigia.gobserva.cloud";
const HOST_VIEJO = "vigia-web.vigiaperu.workers.dev";
const VENTANA_S = 60;

/** Una IPv4 entera; una IPv6 por su /64 (como backend/api/src/lib/antibots.ts → claveIp). */
function claveIp(ip) {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const comprimida = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = comprimida && cola ? cola.split(":") : [];
  const grupos = comprimida ? [...antes, ...Array(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Fuera de Next (sin los tokens de globals.css): sin colores propios, los del navegador en modo día o noche.
const ESPERA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Espera un momento | Vigía</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Abriste muchas páginas seguidas</h1>
<p>Desde tu conexión llegaron más pedidos de los que Vigía atiende en un minuto. Espera un minuto y vuelve a intentarlo.</p>
<p><a href="/">Ir al inicio</a></p></body></html>`;

export default {
  async fetch(req, env, ctx) {
    const ip = req.headers.get("cf-connecting-ip");
    if (ip) {
      const url = new URL(req.url);
      if (url.hostname === HOST_VIEJO) {
        const metodoSeguro = req.method === "GET" || req.method === "HEAD";
        return Response.redirect(`${DOMINIO}${url.pathname}${url.search}`, metodoSeguro ? 301 : 308);
      }
      if (env.LIMITE_PAGINAS && !req.headers.has("next-router-prefetch")) {
        let dentro = true;
        try {
          dentro = (await env.LIMITE_PAGINAS.limit({ key: claveIp(ip) })).success;
        } catch {
          // Si el limitador falla, se atiende: es preferible eso a dejar el sitio caído.
        }
        if (!dentro) {
          return new Response(ESPERA, {
            status: 429,
            headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(VENTANA_S), "Cache-Control": "no-store" },
          });
        }
      }
    }
    return abierto.fetch(req, env, ctx);
  },
};
