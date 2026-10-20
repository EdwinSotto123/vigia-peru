// @ts-nocheck
/**
 * Entrada del Worker `vigia-web-dev` (wrangler.jsonc → env.dev.main): el mismo build de OpenNext que producción,
 * envuelto. No cambia nada del código de la web: producción sigue entrando por `.open-next/worker.js`.
 *
 *   · Pide usuario y clave (Basic). Los secretos son DEV_USUARIO y DEV_CLAVE; sin ellos, no deja pasar a nadie.
 *   · `X-Robots-Tag: noindex`: que ningún buscador indexe la copia.
 *   · Una franja "DEV" arriba de cada página HTML, para no confundirla con producción.
 *
 * Desplegar: `bash infrastructure/deploy/dev.sh web` (ver docs/DEV.md).
 */
import abierto from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const FRANJA =
  '<div style="position:sticky;top:0;z-index:2147483647;display:flex;gap:10px;align-items:center;justify-content:center;' +
  'padding:4px 12px;background:#F2B84B;color:#0B0F0F;font:600 12px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.08em">' +
  "ENTORNO DEV · base vigia-db-dev · nada de esto se ve en producción</div>";

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
    if (!interna && !autorizado(req, env)) {
      return new Response("Vigía DEV: pide usuario y clave al equipo.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Vigia DEV", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    const r = await abierto.fetch(req, env, ctx);
    const res = new Response(r.body, r);
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      return new HTMLRewriter().on("body", { element(e) { e.prepend(FRANJA, { html: true }); } }).transform(res);
    }
    return res;
  },
};
