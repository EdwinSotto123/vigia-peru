/**
 * `fetch` para las llamadas largas al orquestador (/api/agent/analyze y /analyze/stream). Sólo
 * servidor.
 *
 * Node: el default de undici (5 min) corta el fetch al orquestador. Se sube a 60 min para
 * tolerar los reintentos del SDK de Gemini por 429 RESOURCE_EXHAUSTED. El `Agent` se crea al
 * primer uso y se comparte.
 *
 * Cloudflare Workers: no hay undici ni ese corte; va el `fetch` del runtime tal cual.
 */
import "server-only";
import type { Agent } from "undici";
import { EN_WORKERS } from "./entorno";

let despachador: Promise<Agent> | null = null;

export async function fetchLargo(url: string, init: RequestInit): Promise<Response> {
  if (EN_WORKERS) return fetch(url, init);
  despachador ??= import("undici").then(
    ({ Agent }) =>
      new Agent({
        headersTimeout: 3_600_000, // 60 min
        bodyTimeout: 3_600_000,
        connectTimeout: 30_000,
      }),
  );
  // `dispatcher` lo entiende el fetch de Node (undici); no está en los tipos de RequestInit.
  return fetch(url, { ...init, dispatcher: await despachador } as RequestInit);
}
