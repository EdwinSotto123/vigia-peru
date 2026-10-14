/**
 * HTTP de los scrapers: lo de backend/scrapers/_core/http.py.
 *
 * - User-Agent de navegador real: casi todo `.gob.pe` devuelve 403 a un cliente "robot".
 * - Reintentos en 429/5xx con espera creciente (el `Retry(total=4, backoff_factor=1.5)` de la sesión).
 * - `relay: true` manda el GET por el Worker `vigia-relay` (Zúrich): la API OCDS del OECE responde 403
 *   a Cloudflare en EE.UU. El status que se devuelve es el del ORIGEN, como `http.get()` con RELAY_URL.
 */

import type { Env } from "./config.ts";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CABECERAS = { "User-Agent": UA, "Accept-Language": "es-PE,es;q=0.9,en;q=0.8", Accept: "*/*" };
const REINTENTABLE = new Set([429, 500, 502, 503, 504]);
/** Esperas entre reintentos (s): 4 reintentos, como urllib3 con backoff_factor=1.5. */
const ESPERAS_S = [1.5, 3, 6, 12];

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ErrorHttp extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, detalle = "") {
    super(`HTTP ${status} en ${url.split("?")[0]}${detalle ? `: ${detalle}` : ""}`);
    this.status = status;
    this.url = url;
  }
}

function conParams(url: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.append(k, String(v));
  return u.toString();
}

async function porRelay(env: Env, url: string, timeoutMs: number): Promise<Response> {
  const r = await env.RELAY.fetch("https://vigia-relay/raw", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Vigia-Token": (env.RELAY_TOKEN ?? "").trim(), "User-Agent": UA },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(Math.max(timeoutMs, 120_000)),
  });
  if (r.status === 401 && !r.headers.get("x-relay-status")) throw new Error("el relay rechazó RELAY_TOKEN (401)");
  return r;
}

export interface OpcionesGet {
  params?: Record<string, string | number | undefined>;
  relay?: boolean;
  /** Tiempo total del pedido (ms); las descargas grandes pasan `null` (las acota el timeout del paso). */
  timeoutMs?: number | null;
  /** Sin reintentos propios (el que llama ya reintenta, como `_get_json` de oece_ocds). */
  sinReintentos?: boolean;
}

/** GET con los reintentos de la sesión de Python. Devuelve la respuesta tal cual (no lanza por status). */
export async function obtener(env: Env, url: string, op: OpcionesGet = {}): Promise<Response> {
  const destino = conParams(url, op.params);
  const timeout = op.timeoutMs === undefined ? 90_000 : op.timeoutMs;
  for (let intento = 0; ; intento++) {
    let r: Response;
    if (op.relay) r = await porRelay(env, destino, timeout ?? 120_000);
    else r = await fetch(destino, { headers: CABECERAS, redirect: "follow", ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}) });
    if (op.sinReintentos || !REINTENTABLE.has(r.status) || intento >= ESPERAS_S.length) return r;
    await r.body?.cancel();
    await dormir(ESPERAS_S[intento] * 1000);
  }
}

/** `http.get_text`: GET + raise_for_status + texto. */
export async function texto(env: Env, url: string, op: OpcionesGet = {}): Promise<string> {
  const r = await obtener(env, url, op);
  if (!r.ok) {
    await r.body?.cancel();
    throw new ErrorHttp(r.status, url);
  }
  return r.text();
}
