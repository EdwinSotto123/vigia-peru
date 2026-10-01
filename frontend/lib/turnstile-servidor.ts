/**
 * Verificación de Cloudflare Turnstile del lado del servidor (siteverify). Sólo servidor.
 *
 * El secreto es `TURNSTILE_SECRET_KEY`: secreto del worker `vigia-web` en Cloudflare (OpenNext
 * lo deja en `process.env`, como `ADMIN_SESSION_SECRET`) y variable de entorno en Cloud Run.
 * Sin secreto (desarrollo local) no se exige el token y se avisa una vez en el log.
 *
 * Un token sirve una sola vez: siteverify rechaza el segundo uso (`timeout-or-duplicate`).
 */
import "server-only";

const URL_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Un token real ronda los 700–900 caracteres; el tope de Cloudflare es 2048. */
const MAX_TOKEN = 2048;

/** `sin_secreto`: no hay secreto en este servidor y no se verifica (desarrollo). */
export type ResultadoTurnstile = "ok" | "sin_secreto" | "captcha_requerido" | "captcha_invalido";

let avisado = false;

export async function verificarTurnstile(token: string | null | undefined, ip: string | null): Promise<ResultadoTurnstile> {
  const secreto = process.env.TURNSTILE_SECRET_KEY;
  if (!secreto) {
    if (!avisado) {
      avisado = true;
      console.warn("[turnstile] sin TURNSTILE_SECRET_KEY: no se exige la verificación contra bots");
    }
    return "sin_secreto";
  }
  const t = token?.trim();
  if (!t) return "captcha_requerido";
  if (t.length > MAX_TOKEN) return "captcha_invalido";

  const cuerpo = new URLSearchParams({ secret: secreto, response: t });
  if (ip) cuerpo.set("remoteip", ip);
  try {
    const r = await fetch(URL_SITEVERIFY, { method: "POST", body: cuerpo, signal: AbortSignal.timeout(8_000) });
    const j = (await r.json()) as { success?: boolean; "error-codes"?: string[] };
    if (j.success === true) return "ok";
    console.warn("[turnstile] rechazado:", (j["error-codes"] ?? []).join(",") || `HTTP ${r.status}`);
    return "captcha_invalido";
  } catch (e) {
    // Sin respuesta de Cloudflare no se deja pasar: falla cerrado.
    console.error("[turnstile] siteverify:", (e as Error).message);
    return "captcha_invalido";
  }
}
