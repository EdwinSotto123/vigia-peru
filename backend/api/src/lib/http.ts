/**
 * Cabeceras de caché de la API, en un solo lugar.
 *
 * Firebase Hosting va delante (reenvía `/v1/**` a este servicio) y su CDN respeta `s-maxage`:
 *   · público y cacheable → `public, max-age=<navegador>, s-maxage=<CDN>[, stale-while-revalidate=…]`.
 *     `max-age` es chico (≤ 60 s): lo que el navegador reusa sin preguntar.
 *   · en vivo (el tablero sondea cada 5 s) → `max-age=0`: el navegador siempre revalida (con el
 *     ETag, 304 sin cuerpo) y el CDN absorbe la ráfaga unos segundos.
 *   · personal o del panel admin → `private, no-store`: ni el navegador ni el CDN lo guardan.
 */

import type { Context } from "hono";
import { z } from "zod";

export const SIN_CACHE = "private, no-store";

/** `public, max-age=…, s-maxage=…[, stale-while-revalidate=…]`. Por defecto max-age = min(s-maxage, 60). */
export function cachePublico(sMaxAge: number, opts: { maxAge?: number; swr?: number } = {}): string {
  const maxAge = opts.maxAge ?? Math.min(sMaxAge, 60);
  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}${opts.swr ? `, stale-while-revalidate=${opts.swr}` : ""}`;
}

/** Pone `Cache-Control` público (ver `cachePublico`). */
export const conCache = (c: Context, sMaxAge: number, opts?: { maxAge?: number; swr?: number }) =>
  c.header("Cache-Control", cachePublico(sMaxAge, opts));

/** Parámetros de la URL como objeto plano (para zod). */
export const parametros = (c: Context) => Object.fromEntries(new URL(c.req.url).searchParams);

/** Fecha `YYYY-MM-DD` que existe en el calendario (un 2026-02-30 pasaba el regex y la base respondía 500). */
export const fechaIso = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, { message: "fecha inválida" });
