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

/**
 * `/cdn-cgi/…` no es de la web: Cloudflare lo atiende antes del Worker. Lo que llegue hasta acá es un intento de saltar
 * ese filtro (`/cdn-cgi\image/…`, GHSA-c7mq-gh6q-6q7c): el worker de OpenNext trae un manejador de imágenes para
 * desarrollo que pide cualquier URL y devuelve lo que trae, con la identidad de nuestro Worker ante la API (CF-Worker).
 * Hoy lo frena la normalización de URL de la zona (url_normalization = cloudflare); esto no depende de ella.
 */
export const RUTA_CDN_CGI = /^\/cdn-cgi(?![\w-])/i;
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

// ─── Páginas: límite por IP y trampa (worker-prod.js; en DEV, worker-dev.js con un veto corto para probarla) ──────────
const TOPE_PAGINAS = 300;
const VENTANA_S = 60;
/** El enlace escondido de app/layout.tsx, prohibido en app/robots.ts. */
export const TRAMPA = /^\/app\/indice-completo(?:\/|$)/;

const ESPERA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Espera un momento | Vigía</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Abriste muchas páginas seguidas</h1>
<p>Desde tu conexión llegaron más pedidos de los que Vigía atiende en un minuto. Espera un minuto y vuelve a intentarlo.</p>
<p><a href="/">Ir al inicio</a></p></body></html>`;

const VETADO = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Acceso pausado | Vigía</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">Acceso pausado por un rato</h1>
<p>Desde tu conexión se pidieron páginas que el sitio pide no visitar, algo que solo hacen los programas automáticos.
Vuelve a intentarlo más tarde.</p></body></html>`;

const pagina = (html, status, segundos) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(segundos), "Cache-Control": "no-store" },
  });

/**
 * El freno de páginas por IP (una IPv6 por su /64) con el Durable Object `Limitador` de la API (binding LIMITADOR): la
 * trampa veta a la IP por VETO_S segundos (una hora; en DEV, un minuto), una IP vetada recibe 403 y una que pasa de 300
 * pedidos por minuto, 429. No cuentan los prefetch de Next. Devuelve la respuesta del freno, o null si pasa. Si el
 * limitador falla, se atiende: es preferible eso a dejar el sitio caído.
 */
export async function frenoDePaginas(req, env, url, ip) {
  if (!env.LIMITADOR) return null;
  const vetoS = Number(env.VETO_S) || 3600;
  const objeto = env.LIMITADOR.get(env.LIMITADOR.idFromName(`paginas|${claveIp(ip)}`));
  if (TRAMPA.test(url.pathname)) {
    try {
      await objeto.vetar(vetoS * 1000);
    } catch {
      // Sin veto, igual no se sirve la trampa.
    }
    console.log(JSON.stringify({ severity: "WARNING", message: `[trampa] una IP pidió el enlace escondido: vetada ${vetoS} s` }));
    return pagina(VETADO, 403, vetoS);
  }
  // Los prefetch de Next y los estáticos (en DEV pasan por el Worker: run_worker_first) no cuentan.
  if (req.headers.has("next-router-prefetch") || url.pathname.startsWith("/_next/static/")) return null;
  let paso = "ok";
  try {
    paso = await objeto.pasar(TOPE_PAGINAS, VENTANA_S * 1000);
  } catch {
    // ver arriba
  }
  if (paso === "vetado") return pagina(VETADO, 403, vetoS);
  if (paso === "lleno") return pagina(ESPERA, 429, VENTANA_S);
  return null;
}
