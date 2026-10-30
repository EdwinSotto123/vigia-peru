// @ts-nocheck
/**
 * Entrada del Worker `vigia-web` en producción (wrangler.jsonc → main): el build de OpenNext envuelto, como
 * worker-dev.js en DEV. No cambia nada del código de la web.
 *
 *   · Todo por el dominio: lo que entra por vigia-web.vigiaperu.workers.dev se redirige a https://vigia.gobserva.cloud
 *     (mismo camino y consulta). En *.workers.dev no hay zona: ni WAF, ni bloqueo de rastreadores de IA, ni límite por
 *     IP de Cloudflare (infrastructure/deploy/cloudflare/gobserva-redirect/README.md). El 2026-10-30 casi todo lo que
 *     llegaba por ahí era el rastreador de entrenamiento de Meta recorriendo /app/personas con filtros.
 *   · Páginas por IP: 300 por minuto (una IPv6 por su /64), contadas por el Durable Object `Limitador` de la API
 *     (binding LIMITADOR con script_name "vigia-api"; un binding de Rate Limiting deja pasar casi todo con el placement
 *     en us-east-2). No cuentan los prefetch de Next (`Next-Router-Prefetch`): una lista con 50 enlaces pide 50 de golpe
 *     y sólo traen el esqueleto, sin datos. Los estáticos (/_next/static) no pasan por acá: los entrega Cloudflare antes.
 *   · `/v1/…` va a la API (worker-comun.js → aLaApi): es lo que pide el navegador; la API sólo atiende a nuestros Workers.
 *     Cuenta en el límite de páginas como cualquier pedido.
 *   · La trampa: un enlace escondido en el pie de todas las páginas (components/Footer.tsx) a una ruta que robots.txt
 *     prohíbe (app/robots.ts). Una persona no lo ve ni lo alcanza con el teclado y los buscadores no lo siguen: quien lo
 *     pide es un programa que ignora las reglas, y su IP queda vetada una hora (veto en el Durable Object, en disco).
 *   · Lo interno pasa tal cual: la revalidación ISR (WORKER_SELF_REFERENCE) llega sin CF-Connecting-IP, que Cloudflare
 *     pone (y no deja falsificar) en todo pedido que entra de internet.
 */
import abierto from "./.open-next/worker.js";
import { aLaApi, claveIp, RUTA_API } from "./worker-comun.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const DOMINIO = "https://vigia.gobserva.cloud";
const HOST_VIEJO = "vigia-web.vigiaperu.workers.dev";
const TOPE_PAGINAS = 300;
const VENTANA_S = 60;
const TRAMPA = /^\/app\/indice-completo(?:\/|$)/;
const VETO_S = 3600;

const ESPERA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Espera un momento | Vigía</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Abriste muchas páginas seguidas</h1>
<p>Desde tu conexión llegaron más pedidos de los que Vigía atiende en un minuto. Espera un minuto y vuelve a intentarlo.</p>
<p><a href="/">Ir al inicio</a></p></body></html>`;

const VETADO = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Acceso pausado | Vigía</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Acceso pausado por una hora</h1>
<p>Desde tu conexión se pidieron páginas que el sitio pide no visitar, algo que solo hacen los programas automáticos.
Vuelve a intentarlo en una hora.</p></body></html>`;

const pagina = (html, status, segundos) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(segundos), "Cache-Control": "no-store" },
  });

export default {
  async fetch(req, env, ctx) {
    const ip = req.headers.get("cf-connecting-ip");
    if (ip) {
      const url = new URL(req.url);
      if (url.hostname === HOST_VIEJO) {
        const metodoSeguro = req.method === "GET" || req.method === "HEAD";
        return Response.redirect(`${DOMINIO}${url.pathname}${url.search}`, metodoSeguro ? 301 : 308);
      }
      const objeto = env.LIMITADOR ? env.LIMITADOR.get(env.LIMITADOR.idFromName(`paginas|${claveIp(ip)}`)) : null;
      if (objeto && TRAMPA.test(url.pathname)) {
        try {
          await objeto.vetar(VETO_S * 1000);
        } catch {
          // Sin veto, igual no se sirve la trampa.
        }
        console.log(JSON.stringify({ severity: "WARNING", message: "[trampa] una IP pidió el enlace escondido: vetada 1 h" }));
        return pagina(VETADO, 403, VETO_S);
      }
      if (objeto && !req.headers.has("next-router-prefetch")) {
        let paso = "ok";
        try {
          paso = await objeto.pasar(TOPE_PAGINAS, VENTANA_S * 1000);
        } catch {
          // Si el limitador falla, se atiende: es preferible eso a dejar el sitio caído.
        }
        if (paso === "vetado") return pagina(VETADO, 403, VETO_S);
        if (paso === "lleno") return pagina(ESPERA, 429, VENTANA_S);
      }
      if (RUTA_API.test(url.pathname)) return aLaApi(req, env, url, ip);
    }
    return abierto.fetch(req, env, ctx);
  },
};
