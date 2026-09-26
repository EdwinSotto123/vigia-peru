/**
 * Registro estructurado para Cloud Logging (auditoría A4): una línea JSON por pedido, con
 * `severity`, `httpRequest`, la traza (`logging.googleapis.com/trace`, desde `X-Cloud-Trace-Context`
 * o `traceparent`) y un `requestId` que también sale en la cabecera `X-Request-Id` y en el cuerpo
 * de los errores 500. Reemplaza a `hono/logger` (texto con colores ANSI, sin id).
 *
 * Los errores se registran en UNA sola entrada con el stack completo (antes el stack se partía en
 * ~30 líneas sueltas y no había forma de unirlas al pedido).
 */

import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const PROYECTO = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCS_PROJECT_ID ?? "";
const ID_VALIDO = /^[A-Za-z0-9._:-]{8,128}$/;

/** Traza de Cloud Trace del pedido: `X-Cloud-Trace-Context: TRAZA/SPAN;o=1` o W3C `traceparent`. */
function trazaDe(c: Context): { traza: string; span: string | null } | null {
  const xc = c.req.header("x-cloud-trace-context");
  const m = xc?.match(/^([0-9a-f]{32})(?:\/(\d{1,20}))?/i);
  // El span de X-Cloud-Trace-Context viene en decimal; Cloud Logging lo quiere en 16 hex.
  if (m) return { traza: m[1].toLowerCase(), span: m[2] ? BigInt(m[2]).toString(16).padStart(16, "0").slice(-16) : null };
  const tp = c.req.header("traceparent")?.match(/^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-/i);
  if (tp) return { traza: tp[1].toLowerCase(), span: tp[2] };
  return null;
}

/** Campos de correlación (traza + requestId) para cualquier entrada de log de este pedido. */
export function correlacion(c: Context): Record<string, string> {
  const out: Record<string, string> = {};
  const id = c.get("requestId");
  if (id) out.requestId = id;
  const t = trazaDe(c);
  if (t && PROYECTO) {
    out["logging.googleapis.com/trace"] = `projects/${PROYECTO}/traces/${t.traza}`;
    if (t.span) out["logging.googleapis.com/spanId"] = t.span;
  }
  return out;
}

/** Una entrada de log estructurada (una línea JSON en stdout/stderr). */
export function registrar(severity: "DEBUG" | "INFO" | "WARNING" | "ERROR", message: string, extra: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ severity, message, ...extra });
  if (severity === "ERROR") console.error(linea);
  else console.log(linea);
}

/** Middleware: requestId + una entrada por pedido al terminar. */
export const registroPedidos: MiddlewareHandler = async (c, next) => {
  const t0 = performance.now();
  const entrante = c.req.header("x-request-id");
  const requestId = entrante && ID_VALIDO.test(entrante) ? entrante : randomUUID();
  c.set("requestId", requestId);
  await next();
  c.res.headers.set("X-Request-Id", requestId);
  const ms = performance.now() - t0;
  const status = c.res.status;
  const url = new URL(c.req.url);
  registrar(status >= 500 ? "ERROR" : status >= 400 ? "WARNING" : "INFO", `${c.req.method} ${url.pathname} ${status} ${Math.round(ms)} ms`, {
    httpRequest: {
      requestMethod: c.req.method,
      requestUrl: url.pathname + url.search,
      status,
      latency: `${(ms / 1000).toFixed(3)}s`,
      userAgent: c.req.header("user-agent") ?? undefined,
      // Cloudflare pone la IP del cliente en CF-Connecting-IP (Cloud Run, en X-Forwarded-For).
      remoteIp: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || undefined,
      responseSize: c.res.headers.get("content-length") ?? undefined,
    },
    ...correlacion(c),
  });
};

/** Error no manejado: se registra con su stack en una entrada y se responde sin el mensaje interno. */
export function errorInterno(err: unknown, c: Context): Response {
  const e = err as Error;
  registrar("ERROR", e?.stack ?? String(err), {
    httpRequest: { requestMethod: c.req.method, requestUrl: new URL(c.req.url).pathname },
    ...correlacion(c),
  });
  return c.json({ error: "internal", requestId: c.get("requestId") ?? null }, 500);
}
