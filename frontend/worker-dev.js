// @ts-nocheck
/**
 * Entrada del Worker `vigia-web-dev` (wrangler.jsonc → env.dev.main): el mismo build de OpenNext que producción,
 * envuelto. No cambia nada del código de la web: producción sigue entrando por `.open-next/worker.js`.
 *
 *   · Pide usuario y clave (Basic). Los secretos son DEV_USUARIO y DEV_CLAVE; sin ellos, no deja pasar a nadie.
 *   · `X-Robots-Tag: noindex`: que ningún buscador indexe la copia.
 *   · Una franja "DEV" arriba de cada página HTML, para no confundirla con producción. Va como fondo del <body> (atributo
 *     style), no como un nodo nuevo: un nodo que React no renderizó rompe la hidratación (errores 418/423) y React lo borra.
 *
 * Desplegar: `bash infrastructure/deploy/dev.sh web` (ver docs/DEV.md).
 */
import abierto from "./.open-next/worker.js";
import { aLaApi, frenoDePaginas, RUTA_API } from "./worker-comun.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const FRANJA = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="22"><rect width="640" height="22" fill="#F2B84B"/>' +
  '<text x="320" y="15" text-anchor="middle" font-family="Consolas,monospace" font-size="12" font-weight="700" fill="#0B0F0F">' +
  "ENTORNO DEV · base vigia-db-dev · no es producción</text></svg>");
const ESTILO = `background-image:url("data:image/svg+xml,${FRANJA}");background-repeat:repeat-x;background-position:top center;padding-top:22px`;

function iguales(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function autorizado(req, env) {
  const usuario = (env.DEV_USUARIO ?? "").trim();
  const clave = (env.DEV_CLAVE ?? "").trim();
  if (!usuario || !clave) return false;
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  let par = "";
  try { par = atob(h.slice(6).trim()); } catch { return false; }
  const i = par.indexOf(":");
  return i > 0 && iguales(par.slice(0, i), usuario) && iguales(par.slice(i + 1), clave);
}

export default {
  async fetch(req, env, ctx) {
    // La revalidación ISR (memory-queue) se pide a sí misma por WORKER_SELF_REFERENCE, sin usuario: llega sin
    // CF-Connecting-IP (que Cloudflare pone, y no deja falsificar, en todo pedido que entra de internet).
    const interna = !req.headers.has("cf-connecting-ip") && req.headers.has("x-prerender-revalidate");
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip");
    // El mismo freno que producción (worker-comun.js), con un veto de un minuto (VETO_S) para poder probar la trampa.
    if (ip && autorizado(req, env)) {
      const freno = await frenoDePaginas(req, env, url, ip);
      if (freno) return freno;
    }
    // Lo que el navegador le pide a la API (worker-comun.js). Una cuenta manda su token (Bearer) en vez de la clave del
    // sitio: /v1/cuentas pasa igual, la API exige ahí un token válido.
    if (ip && RUTA_API.test(url.pathname) && (autorizado(req, env) || /^\/v1\/cuentas(?:\/|$)/.test(url.pathname))) {
      return aLaApi(req, env, url, ip);
    }
    if (!interna && !autorizado(req, env)) {
      return new Response("Vigía DEV: pide usuario y clave al equipo.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Vigia DEV", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    // Los estáticos también pasan por aquí (run_worker_first en wrangler.jsonc): antes Cloudflare los entregaba sin
    // usuario ni clave y sin noindex. Primero el archivo; si no existe, la web.
    const archivo = env.ASSETS ? await env.ASSETS.fetch(req) : null;
    const r = archivo && archivo.status !== 404 ? archivo : await abierto.fetch(req, env, ctx);
    const res = new Response(r.body, r);
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      return new HTMLRewriter().on("body", {
        element(e) { e.setAttribute("style", [e.getAttribute("style"), ESTILO].filter(Boolean).join(";")); },
      }).transform(res);
    }
    return res;
  },
};
