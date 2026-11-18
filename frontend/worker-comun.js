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
  // El panel tiene su propio paso, con sesión (app/api/admin): por acá no. Con la ruta decodificada y sin distinguir
  // mayúsculas: `/v1/%61dmin` también es el panel (auditoría 2026-10-30).
  let rutaPlana = url.pathname;
  try {
    rutaPlana = decodeURIComponent(rutaPlana);
  } catch {
    /* una ruta mal codificada se mira tal cual */
  }
  if (/^\/v1\/admin(?:\/|$)/i.test(rutaPlana)) return new Response("Not Found", { status: 404 });
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

// ─── Rastreadores que no respetan robots.txt ────────────────────────────────────────────────────────────────────────
/**
 * El índice de Meta AI (`meta-webindexer`) recorre el sitio a 2 páginas por segundo sin pausa (12 mil pedidos el
 * 2026-11-01, 20 mil el 11-03) y entra en lo que robots.txt prohíbe a todos: la mitad eran fichas de personas (llevan
 * noindex) y el resto, enlaces con consulta de cada ficha (`/app/apoyar?para=…`, `/privacidad?enlace=…`). Cada una son
 * ~0,7 s de CPU y ~3 consultas a la base; ese 11-03 llevó al tope las conexiones de la API. Lo que app/robots.ts le
 * prohíbe se le corta acá, antes de armar la página; el resto del sitio lo sigue leyendo.
 */
const INDICE_META = /meta-webindexer/i;
const FUERA_PARA_META = /^\/(?:app\/personas\/|login(?:\/|$)|reporte\/nuevo(?:\/|$))/;

/** 403 si es el índice de Meta pidiendo algo que app/robots.ts le prohíbe; null si pasa. */
export function fueraDeRobots(req, url) {
  if (!INDICE_META.test(req.headers.get("user-agent") || "")) return null;
  if (!url.search && !FUERA_PARA_META.test(url.pathname)) return null;
  return new Response("Excluido en /robots.txt", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ─── Páginas: límite por IP y trampa (worker-prod.js; en DEV, worker-dev.js con un veto corto para probarla) ──────────
const TOPE_PAGINAS = 300;
/** Prefetch de Next por IP y por minuto: una persona navegando rápido hace unos cientos; un programa, miles. */
const TOPE_PREFETCH = 900;
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
    // Sólo se veta a quien LLEGÓ a la trampa por su cuenta (un programa que sigue el enlace escondido: sin `Sec-Fetch-Site`,
    // o navegando dentro del sitio). Si la pide el navegador de una persona porque OTRA página la incrustó (una imagen, un
    // marco, un enlace ajeno), no: con eso cualquiera dejaba una hora sin Vigía a quien abriera su página o su correo, y a
    // toda su red si sale por una misma IP (auditoría del 2026-11-17).
    const sitio = req.headers.get("sec-fetch-site");
    const destino = req.headers.get("sec-fetch-dest");
    const ajeno = (sitio && sitio !== "same-origin" && sitio !== "none") || (destino && destino !== "document" && destino !== "empty");
    if (ajeno) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    try {
      await objeto.vetar(vetoS * 1000);
    } catch {
      // Sin veto, igual no se sirve la trampa.
    }
    console.log(JSON.stringify({ severity: "WARNING", message: `[trampa] una IP pidió el enlace escondido: vetada ${vetoS} s` }));
    return pagina(VETADO, 403, vetoS);
  }
  // Los estáticos (en DEV pasan por el Worker: run_worker_first) no cuentan.
  if (url.pathname.startsWith("/_next/static/")) return null;
  // Los prefetch de Next no cuentan como páginas, pero sólo los de verdad (un GET de RSC a una página, nunca /v1) y con su
  // propio tope: antes bastaba mandar la cabecera `Next-Router-Prefetch` en cualquier pedido para saltarse la cuenta y el
  // veto, y Next armaba la página entera igual (auditoría del 2026-11-17).
  const prefetch = req.method === "GET" && req.headers.get("rsc") === "1" && req.headers.has("next-router-prefetch") && !RUTA_API.test(url.pathname);
  if (prefetch) {
    try {
      const aparte = env.LIMITADOR.get(env.LIMITADOR.idFromName(`prefetch|${claveIp(ip)}`));
      if ((await aparte.pasar(TOPE_PREFETCH, VENTANA_S * 1000)) === "lleno") return pagina(ESPERA, 429, VENTANA_S);
    } catch {
      // ver arriba
    }
    return null;
  }
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
