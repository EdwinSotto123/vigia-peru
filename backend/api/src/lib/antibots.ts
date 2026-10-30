/**
 * Protección contra bots y abuso de la API. La API vive en *.workers.dev, sin zona propia: el WAF, el bloqueo de
 * rastreadores de IA y el límite por IP de la zona gobserva.cloud no la cubren, así que la protección va acá.
 *
 *   · Turnstile en las escrituras (widget "managed": invisible para la gente, desafío solo ante sospecha). El token
 *     llega en el header `cf-turnstile-response` y se valida con siteverify; sirve UNA sola vez.
 *   · Límite por IP y ruta para las escrituras (10 por minuto) y por IP para las lecturas (120 por minuto; 30 las
 *     búsquedas de texto, las más caras para la base). En Workers con un Durable Object por clave (workers/limitador.ts:
 *     los bindings de Rate Limiting dejaban pasar casi todo con la API ubicada en us-east-2); en Cloud Run con una
 *     ventana en memoria por instancia.
 *   · Las lecturas de nuestros propios Workers no cuentan: la web pide a la API desde su servidor con la IP de salida
 *     de Cloudflare, la misma para todos sus visitantes (ver `pedidoInterno`).
 *
 * Errores (contrato con el frontend):
 *   403 { error: "captcha_requerido" }   falta el token
 *   403 { error: "captcha_invalido" }    siteverify lo rechazó (vencido, usado, de otro dominio)
 *   429 { error: "demasiados_pedidos", reintentarEn } + Retry-After
 *
 * Sin `TURNSTILE_SECRET_KEY` (desarrollo local) no se exige el token: se avisa en el registro una vez.
 */
import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { SIN_CACHE } from "./http.js";
import { ambitoPedido } from "./plataforma.js";
import { registrar } from "./registro.js";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const HEADER_TURNSTILE = "cf-turnstile-response";

/** Pedidos por IP en la ventana. */
export const LIMITE_ESCRITURAS = 10;
export const LIMITE_LECTURAS = 120;
export const LIMITE_BUSQUEDAS = 30;
export const VENTANA_S = 60;
type Limite = "escritura" | "lectura" | "busqueda";
const LIMITES: Record<Limite, number> = { escritura: LIMITE_ESCRITURAS, lectura: LIMITE_LECTURAS, busqueda: LIMITE_BUSQUEDAS };

/**
 * La IP de quien llama: la de Cloudflare (Workers) o la primera de x-forwarded-for (Cloud Run). Lo que el navegador pide
 * por la web (frontend/worker-prod.js reenvía `/v1` a la API) llega de nuestro Worker con la IP del visitante en
 * `x-vigia-ip`: sólo a nuestros Workers se les cree.
 */
export function ipCliente(c: Context): string {
  const reenviada = c.req.header("x-vigia-ip");
  if (reenviada && esWorkerPropio(c)) return reenviada.trim();
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "desconocida";
}

/**
 * La IP como clave del límite: una IPv4 entera; una IPv6 por su /64, que el proveedor le da entero a cada cliente
 * (rotar direcciones dentro de él no cuesta nada).
 */
export function claveIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);   // IPv4 escrita como IPv6 (::ffff:1.2.3.4)
  const comprimida = ip.toLowerCase().includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = comprimida && cola ? cola.split(":") : [];
  const grupos = comprimida ? [...antes, ...Array<string>(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Zonas de nuestros Workers. Cloudflare pone `CF-Worker: <zona>` en todo subpedido de un Worker y borra el que mande un
 * cliente (probado el 2026-10-30): la web llega como `vigiaperu.workers.dev` o `gobserva.cloud` según por dónde entró
 * su visitante. Un dominio nuevo para Vigía se suma en `WORKERS_PROPIOS` (wrangler.jsonc).
 */
function workersPropios(): Set<string> {
  return new Set((process.env.WORKERS_PROPIOS ?? "vigiaperu.workers.dev,gobserva.cloud").split(",").map((s) => s.trim()).filter(Boolean));
}

/** Viene de uno de nuestros Workers (su `CF-Worker`). */
export function esWorkerPropio(c: Context): boolean {
  const worker = c.req.header("cf-worker");
  return !!worker && workersPropios().has(worker);
}

/**
 * Un pedido de nuestros Workers por su cuenta (la web armando una página en su servidor) o que no vino de internet (el
 * cron, un service binding: sin IP de cliente). Lo que la web reenvía del navegador (`x-vigia-ip`) es de un visitante.
 */
export function pedidoInterno(c: Context): boolean {
  if (esWorkerPropio(c)) return !c.req.header("x-vigia-ip");
  return ipCliente(c) === "desconocida";
}

/** Un token contra su secreto en tiempo constante (como lib/adminlog.ts, sobre el pedido crudo). Sin secreto, nunca. */
function tokenIgual(token: string | null, esperado: string | undefined): boolean {
  if (!esperado || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * La API es de nuestros Workers (antiscraping, 2026-10-30): lo que viene de internet entra por la web
 * (vigia.gobserva.cloud/v1, frontend/worker-prod.js), detrás del WAF, el bloqueo de bots y el límite por IP de la zona
 * gobserva.cloud; en *.workers.dev no hay nada de eso. Directo sólo la portada, la salud, lo que trae el token del panel
 * y el build de la web en el CI (`x-vigia-build` = BUILD_TOKEN: prerenderiza páginas con datos; frontend/scripts/fetch-build.cjs).
 * Devuelve el 403 o null si pasa. Corre ANTES de la caché del borde (workers/cdn.ts): si no, lo guardado le llegaría a
 * cualquiera. `API_PUBLICA=si` (variable del Worker) la vuelve a abrir sin desplegar código.
 */
export function cerradaAlPublico(req: Request): Response | null {
  if (process.env.API_PUBLICA === "si" || req.method === "OPTIONS") return null;
  const worker = req.headers.get("cf-worker");
  if (worker && workersPropios().has(worker)) return null;
  if (!req.headers.get("cf-connecting-ip")) return null;   // no vino de internet: el cron, un service binding
  const ruta = new URL(req.url).pathname.replace(/^\/v1(?=\/|$)/, "") || "/";
  if (ruta === "/" || ruta === "/health" || ruta === "/livez") return null;
  if (tokenIgual(req.headers.get("x-admin-token"), process.env.ADMIN_TOKEN)) return null;
  if (tokenIgual(req.headers.get("x-vigia-build"), process.env.BUILD_TOKEN)) return null;
  return new Response(JSON.stringify({ error: "api_privada", mensaje: "Los datos de Vigía se consultan en https://vigia.gobserva.cloud" }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": SIN_CACHE },
  });
}

/** Una búsqueda de texto: /buscar o una lista con `?q=`. */
function esBusqueda(c: Context): boolean {
  return /(^|\/)buscar(\/|$)/.test(c.req.path) || !!c.req.query("q")?.trim();
}

function demasiados(c: Context): Response {
  c.header("Retry-After", String(VENTANA_S));
  c.header("Cache-Control", SIN_CACHE);
  return c.json({ error: "demasiados_pedidos", reintentarEn: VENTANA_S }, 429);
}

// ─── Límite por IP ─────────────────────────────────────────────────────────────
/** Ventana deslizante en memoria (Cloud Run / local): por instancia, que es lo que hay sin binding. */
const ventanas = new Map<string, number[]>();
let ultimaLimpieza = 0;

export function limitarEnMemoria(clave: string, limite = LIMITE_ESCRITURAS, ventanaMs = VENTANA_S * 1000, ahora = Date.now()): boolean {
  if (ahora - ultimaLimpieza > ventanaMs) {
    for (const [k, ts] of ventanas) if (!ts.length || ahora - ts[ts.length - 1]! > ventanaMs) ventanas.delete(k);
    ultimaLimpieza = ahora;
  }
  const ts = (ventanas.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
  if (ts.length >= limite) {
    ventanas.set(clave, ts);
    return false;
  }
  ts.push(ahora);
  ventanas.set(clave, ts);
  return true;
}

/** true si el pedido entra en el límite. En Workers, el Durable Object (exacto); si no, la ventana en memoria. */
async function dentroDelLimite(limite: Limite, clave: string): Promise<boolean> {
  const k = `${limite}|${clave}`;
  const limitador = ambitoPedido.getStore()?.limitador?.();
  if (limitador) {
    try {
      return await limitador.contar(k, LIMITES[limite], VENTANA_S);
    } catch (e) {
      registrar("WARNING", `[antibots] el limitador de Workers falló, se usa el de memoria: ${(e as Error).message}`);
    }
  }
  return limitarEnMemoria(k, LIMITES[limite]);
}

/** Middleware: límite de escrituras por IP y ruta (sin contar el prefijo /v1). */
export const limiteEscritura: MiddlewareHandler = async (c, next) => {
  const ruta = c.req.routePath.replace(/^\/v1(?=\/)/, "");
  if (!(await dentroDelLimite("escritura", `${ipCliente(c)}|${c.req.method}|${ruta}`))) return demasiados(c);
  return next();
};

/**
 * Middleware: lecturas por IP (una IPv6 por su /64), aparte las búsquedas de texto. Frena a quien baja la base pedido
 * a pedido; una persona navegando no llega ni cerca. Lo interno no cuenta (`pedidoInterno`).
 */
export const limiteLectura: MiddlewareHandler = async (c, next) => {
  if ((c.req.method !== "GET" && c.req.method !== "HEAD") || pedidoInterno(c)) return next();
  const limite: Limite = esBusqueda(c) ? "busqueda" : "lectura";
  if (!(await dentroDelLimite(limite, claveIp(ipCliente(c))))) return demasiados(c);
  return next();
};

// ─── Turnstile ─────────────────────────────────────────────────────────────────
let avisado = false;

export type ResultadoCaptcha = "ok" | "sin_secreto" | "captcha_requerido" | "captcha_invalido";

/** Valida el token con siteverify. `fetcher` se reemplaza en los tests. */
export async function verificarTurnstile(
  token: string | undefined,
  ip: string,
  secreto = process.env.TURNSTILE_SECRET_KEY,
  fetcher: typeof fetch = fetch,
): Promise<ResultadoCaptcha> {
  if (!secreto) {
    if (!avisado) {
      registrar("WARNING", "[antibots] sin TURNSTILE_SECRET_KEY: no se exige captcha (solo desarrollo)");
      avisado = true;
    }
    return "sin_secreto";
  }
  if (!token) return "captcha_requerido";
  const cuerpo = new URLSearchParams({ secret: secreto, response: token });
  if (ip && ip !== "desconocida") cuerpo.set("remoteip", ip);
  try {
    const r = await fetcher(SITEVERIFY, { method: "POST", body: cuerpo });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; "error-codes"?: string[] };
    if (j.success) return "ok";
    registrar("INFO", `[antibots] captcha rechazado: ${(j["error-codes"] ?? []).join(",") || r.status}`);
    return "captcha_invalido";
  } catch (e) {
    // Si Cloudflare no responde, se rechaza: es preferible un reintento a dejar pasar un bot.
    registrar("WARNING", `[antibots] siteverify no respondió: ${(e as Error).message}`);
    return "captcha_invalido";
  }
}

/** Middleware: exige un token de Turnstile válido. */
export const exigirCaptcha: MiddlewareHandler = async (c, next) => {
  const r = await verificarTurnstile(c.req.header(HEADER_TURNSTILE), ipCliente(c));
  if (r === "captcha_requerido" || r === "captcha_invalido") return c.json({ error: r }, 403);
  return next();
};
