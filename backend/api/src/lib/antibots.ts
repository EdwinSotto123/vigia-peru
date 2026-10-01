/**
 * Protección contra bots de las escrituras públicas (sin zona propia en Cloudflare no hay WAF de zona
 * ni Bot Fight Mode: todo corre en *.workers.dev, así que la protección va acá).
 *
 *   · Turnstile (widget "managed": invisible para la gente, desafío solo ante sospecha). El token llega
 *     en el header `cf-turnstile-response` y se valida con siteverify; sirve UNA sola vez.
 *   · Límite por IP y ruta para las escrituras: en Workers con el binding de Rate Limiting
 *     (`LIMITE_ESCRITURA`, wrangler.jsonc); en Cloud Run con una ventana en memoria por instancia.
 *
 * Errores (contrato con el frontend):
 *   403 { error: "captcha_requerido" }   falta el token
 *   403 { error: "captcha_invalido" }    siteverify lo rechazó (vencido, usado, de otro dominio)
 *   429 { error: "demasiados_pedidos", reintentarEn } + Retry-After
 *
 * Sin `TURNSTILE_SECRET_KEY` (desarrollo local) no se exige el token: se avisa en el registro una vez.
 */
import type { Context, MiddlewareHandler } from "hono";
import { ambitoPedido } from "./plataforma.js";
import { registrar } from "./registro.js";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const HEADER_TURNSTILE = "cf-turnstile-response";

/** Escrituras por IP y ruta en la ventana (el binding de Workers usa el mismo número). */
export const LIMITE_ESCRITURAS = 10;
export const VENTANA_S = 60;

/** La IP de quien llama: la de Cloudflare (Workers) o la primera de x-forwarded-for (Cloud Run). */
export function ipCliente(c: Context): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "desconocida";
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

/** true si el pedido entra en el límite. En Workers, el binding; si no, la ventana en memoria. */
async function dentroDelLimite(clave: string): Promise<boolean> {
  const binding = ambitoPedido.getStore()?.limitador?.("escritura");
  if (binding) {
    try {
      return (await binding.limit({ key: clave })).success;
    } catch (e) {
      registrar("WARNING", `[antibots] el limitador de Workers falló, se usa el de memoria: ${(e as Error).message}`);
    }
  }
  return limitarEnMemoria(clave);
}

/** Middleware: límite de escrituras por IP y ruta (sin contar el prefijo /v1). */
export const limiteEscritura: MiddlewareHandler = async (c, next) => {
  const ruta = c.req.routePath.replace(/^\/v1(?=\/)/, "");
  if (!(await dentroDelLimite(`${ipCliente(c)}|${c.req.method}|${ruta}`))) {
    c.header("Retry-After", String(VENTANA_S));
    return c.json({ error: "demasiados_pedidos", reintentarEn: VENTANA_S }, 429);
  }
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
