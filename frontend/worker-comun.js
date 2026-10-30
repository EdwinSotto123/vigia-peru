// @ts-nocheck
/**
 * Lo que comparten las dos entradas del Worker de la web (worker-prod.js y worker-dev.js).
 *
 * `/v1/…`: lo que el NAVEGADOR le pide a la API (lib/api-client.ts → API_PUBLICA). La API sólo atiende a nuestros
 * Workers (backend/api/src/lib/antibots.ts → cerradaAlPublico): así todo lo de internet pasa por el dominio y su zona de
 * Cloudflare (WAF, bloqueo de bots, límite por IP) y no hay una API de datos abierta para bajarse la base. Este Worker la
 * reenvía con la IP de quien pide en `x-vigia-ip` (la API le cree sólo a nuestros Workers, por su CF-Worker) para que los
 * límites por IP y el captcha sigan siendo de cada persona.
 */

/** Una IPv4 entera; una IPv6 por su /64 (como backend/api/src/lib/antibots.ts → claveIp). */
export function claveIp(ip) {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const comprimida = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = comprimida && cola ? cola.split(":") : [];
  const grupos = comprimida ? [...antes, ...Array(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export const RUTA_API = /^\/v1(?:\/|$)/;
const PEDIDO = ["accept", "content-type", "cf-turnstile-response", "if-none-match"];
const RESPUESTA = ["content-type", "cache-control", "etag", "last-modified", "retry-after", "content-disposition", "x-vigia-cdn"];

/** Reenvía `/v1/…` a la API (VIGIA_API_URL, que también atiende con el prefijo /v1). */
export async function aLaApi(req, env, url, ip) {
  // El panel tiene su propio paso, con sesión (app/api/admin): por acá no.
  if (/^\/v1\/admin(?:\/|$)/.test(url.pathname)) return new Response("Not Found", { status: 404 });
  const h = new Headers();
  for (const k of PEDIDO) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  // Sólo el token de una cuenta (Bearer de Firebase): en DEV el navegador manda además el Basic de la clave del sitio.
  const auth = req.headers.get("authorization");
  if (auth && /^Bearer\s/i.test(auth)) h.set("authorization", auth);
  h.set("x-vigia-ip", ip);
  const conCuerpo = req.method !== "GET" && req.method !== "HEAD";
  const r = await fetch(`${env.VIGIA_API_URL}${url.pathname}${url.search}`, {
    method: req.method,
    headers: h,
    body: conCuerpo ? req.body : undefined,
    redirect: "manual",
  });
  const out = new Headers();
  for (const k of RESPUESTA) {
    const v = r.headers.get(k);
    if (v) out.set(k, v);
  }
  return new Response(r.body, { status: r.status, headers: out });
}
