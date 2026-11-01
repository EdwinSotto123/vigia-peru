/**
 * HTTP de los scrapers: lo de backend/scrapers/_core/http.py.
 *
 * - User-Agent de navegador real: casi todo `.gob.pe` devuelve 403 a un cliente "robot".
 * - Reintentos en 429/5xx con espera creciente (el `Retry(total=4, backoff_factor=1.5)` de la sesión).
 * - `relay: true` manda el GET por el Worker `vigia-relay` (Zúrich): la API OCDS del OECE responde 403
 *   a Cloudflare en EE.UU. El status que se devuelve es el del ORIGEN, como `http.get()` con RELAY_URL.
 * - `relay: "lima"` lo manda por el relay de Lima (backend/relay-lima, binding RELAY_LIMA): la Contraloría, INFOBRAS,
 *   SERVIR y MINJUS sólo responden a IPs del Perú (522, 403 o sin DNS desde Cloudflare y desde Zúrich).
 * - `pedirLima` hace un pedido con sesión por ese relay (POST, cabeceras, cuerpo y las cookies que deja el origen): las
 *   plazas CAS de SERVIR (src/fuentes/servir_convocatorias.ts).
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

/** El servicio de Workers VPC del relay de Lima: la dirección con la que está definido (127.0.0.1:8080 de la instancia). */
export const URL_LIMA = "http://127.0.0.1:8080";

/** GET /health del relay de Lima: quién atiende («pc» o «aws-lima») si responde; null si no (apagado, sin túnel). */
export async function saludLima(env: Env): Promise<{ nombre: string } | null> {
  if (!env.RELAY_LIMA) return null;
  try {
    const r = await env.RELAY_LIMA.fetch(`${URL_LIMA}/health`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { ok?: boolean; nombre?: string };
    return d.ok ? { nombre: d.nombre || "relay" } : null;
  } catch {
    return null;
  }
}

async function porLima(env: Env, url: string, timeoutMs: number): Promise<Response> {
  if (!env.RELAY_LIMA) throw new Error("falta el binding RELAY_LIMA (vpc_services en wrangler.jsonc)");
  const r = await env.RELAY_LIMA.fetch(`${URL_LIMA}/raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Vigia-Token": (env.RELAY_LIMA_TOKEN ?? "").trim() },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(Math.max(timeoutMs, 120_000)),
  });
  if (r.status === 401 && !r.headers.get("x-relay-status")) throw new Error("el relay de Lima rechazó RELAY_LIMA_TOKEN (401)");
  return r;
}

/**
 * Un pedido con sesión por el relay de Lima (POST /raw con método, cabeceras y cuerpo): lo que necesita un sitio JSF como
 * SERVIR, que guarda la sesión en una cookie y la página en el ViewState. El relay no guarda nada entre pedidos: las
 * cookies las lleva el que llama (vuelven en `cookies` y se mandan en la cabecera Cookie del pedido siguiente).
 */
export interface PedidoLima {
  url: string;
  metodo?: "GET" | "HEAD" | "POST";
  /**
   * Para el origen. El relay sólo deja pasar Accept, Accept-Language, Content-Type, Cookie, Faces-Request,
   * If-Modified-Since, If-None-Match, Origin, Range, Referer, User-Agent y X-Requested-With (CABECERAS_PERMITIDAS de
   * backend/relay-lima/relay.py); sin User-Agent, pone uno de navegador.
   */
  cabeceras?: Record<string, string>;
  /** El cuerpo de un POST, como texto (un formulario urlencoded, por ejemplo). */
  cuerpo?: string;
  /** Tiempo del pedido (ms); como mínimo 30 s. Por defecto, 120 s (lo que el relay espera al origen). */
  timeoutMs?: number;
  /** Sin reintentos propios: un POST que cambia algo en el origen (pasar de página) no se repite a ciegas. */
  sinReintentos?: boolean;
}

export interface RespuestaLima {
  /** La respuesta del relay: el status y el cuerpo del origen, o el error del propio relay (entonces `origen` es null). */
  respuesta: Response;
  /** El status del origen (x-relay-status); null si la respuesta es un error del relay (400, 413, 502…). */
  origen: number | null;
  /** La URL final, después de las redirecciones que siguió el relay (x-relay-url). */
  url: string;
  /** Las cookies que dejó el origen en este pedido (x-relay-cookies), para sumarlas a las de la sesión. */
  cookies: Record<string, string>;
}

/** x-relay-cookies ({"JSESSIONID": "…"}) → objeto; vacío si no viene o no se lee. */
export function cookiesDelRelay(cabecera: string | null): Record<string, string> {
  if (!cabecera) return {};
  try {
    const d = JSON.parse(cabecera) as unknown;
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    return Object.fromEntries(Object.entries(d as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/**
 * Un pedido con sesión por el relay de Lima. Reintenta en 429/5xx como `obtener` (también el 502 del relay, que es «sin
 * respuesta del origen»), salvo con `sinReintentos`. Devuelve la respuesta tal cual (no lanza por status) con la URL
 * final y las cookies nuevas del origen. El cuerpo queda por leer: `(await pedirLima(…)).respuesta.text()`.
 */
export async function pedirLima(env: Env, p: PedidoLima): Promise<RespuestaLima> {
  if (!env.RELAY_LIMA) throw new Error("falta el binding RELAY_LIMA (vpc_services en wrangler.jsonc)");
  const cuerpo = JSON.stringify({ url: p.url, metodo: p.metodo ?? "GET", cabeceras: p.cabeceras ?? {}, ...(p.cuerpo === undefined ? {} : { cuerpo: p.cuerpo }) });
  for (let intento = 0; ; intento++) {
    const r = await env.RELAY_LIMA.fetch(`${URL_LIMA}/raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vigia-Token": (env.RELAY_LIMA_TOKEN ?? "").trim() },
      body: cuerpo,
      signal: AbortSignal.timeout(Math.max(p.timeoutMs ?? 120_000, 30_000)),
    });
    const status = r.headers.get("x-relay-status");
    if (r.status === 401 && !status) throw new Error("el relay de Lima rechazó RELAY_LIMA_TOKEN (401)");
    if (p.sinReintentos || !REINTENTABLE.has(r.status) || intento >= ESPERAS_S.length) {
      return { respuesta: r, origen: status ? Number(status) : null, url: r.headers.get("x-relay-url") || p.url, cookies: cookiesDelRelay(r.headers.get("x-relay-cookies")) };
    }
    await r.body?.cancel();
    await dormir(ESPERAS_S[intento] * 1000);
  }
}

export interface OpcionesGet {
  params?: Record<string, string | number | undefined>;
  /** true: por el relay de Zúrich; "lima": por el relay de Lima. */
  relay?: boolean | "lima";
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
    if (op.relay === "lima") r = await porLima(env, destino, timeout ?? 120_000);
    else if (op.relay) r = await porRelay(env, destino, timeout ?? 120_000);
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
