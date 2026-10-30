// @ts-nocheck
/**
 * Entrada del Worker `vigia-web` en producción (wrangler.jsonc → main): el build de OpenNext envuelto, como
 * worker-dev.js en DEV. No cambia nada del código de la web.
 *
 *   · Todo por el dominio: lo que entra por vigia-web.vigiaperu.workers.dev se redirige a https://vigia.gobserva.cloud
 *     (mismo camino y consulta). En *.workers.dev no hay zona: ni WAF, ni bloqueo de rastreadores de IA, ni límite por
 *     IP de Cloudflare (infrastructure/deploy/cloudflare/gobserva-redirect/README.md). El 2026-10-30 casi todo lo que
 *     llegaba por ahí era el rastreador de entrenamiento de Meta recorriendo /app/personas con filtros.
 *   · Páginas por IP (worker-comun.js → frenoDePaginas): 300 por minuto (una IPv6 por su /64), contadas por el Durable Object `Limitador` de la API
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
import { aLaApi, frenoDePaginas, RUTA_API } from "./worker-comun.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const DOMINIO = "https://vigia.gobserva.cloud";
const HOST_VIEJO = "vigia-web.vigiaperu.workers.dev";

export default {
  async fetch(req, env, ctx) {
    const ip = req.headers.get("cf-connecting-ip");
    if (ip) {
      const url = new URL(req.url);
      if (url.hostname === HOST_VIEJO) {
        const metodoSeguro = req.method === "GET" || req.method === "HEAD";
        return Response.redirect(`${DOMINIO}${url.pathname}${url.search}`, metodoSeguro ? 301 : 308);
      }
      const freno = await frenoDePaginas(req, env, url, ip);
      if (freno) return freno;
      if (RUTA_API.test(url.pathname)) return aLaApi(req, env, url, ip);
    }
    return abierto.fetch(req, env, ctx);
  },
};
