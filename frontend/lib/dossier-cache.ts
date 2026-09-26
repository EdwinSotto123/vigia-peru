/**
 * Cache de dossiers en el cliente.
 *
 * Cache SOLO EN MEMORIA (Map de módulo) → revisita instantánea durante la
 * sesión SPA sin tocar la red. NO usamos sessionStorage a propósito: un dossier
 * puede REPROCESARSE (re-análisis con datos nuevos), y persistirlo en
 * sessionStorage hacía que, tras un reproceso, la pestaña mostrara data vieja
 * ("cambia al recargar"). Al ser solo memoria, una RECARGA re-fetchea fresco
 * (siempre la última corrida); la navegación in-app sigue cacheada (rápida).
 *
 * El fetch real va a /api/agent/history/[id], que pega a la API liviana
 * (no al orquestador ADK) y devuelve el análisis MÁS RECIENTE. La página del informe ya
 * llega armada del servidor (lib/dossier-servidor.ts): esto queda para reintentar en el
 * navegador cuando el servidor no pudo, y para la traza bajo demanda (`getTraza`).
 */

import { PUBLIC_API_BASE } from "./auditoria";
import { apiNueva } from "./capacidades";
import type { DatosTraza } from "./dossier-servidor";

export type { DatosTraza };

const mem = new Map<string, any>();

/**
 * Por qué no hay dossier. `not_found` = no hay análisis publicado para ese código;
 * `error` = la API o la red fallaron y conviene reintentar. Antes las dos cosas
 * se veían como "no se ha analizado todavía".
 */
export class DossierError extends Error {
  constructor(public tipo: "not_found" | "error", message: string) {
    super(message);
    this.name = "DossierError";
  }
}

/** Normaliza el id a la llave de cache (quita prefijo OECE-, decodifica). */
function keyOf(rawId: string): string {
  return decodeURIComponent(rawId || "").replace(/^OECE-/i, "").trim();
}

/** Devuelve el dossier de cache (solo memoria) sin tocar la red. */
export function peekDossier(rawId: string): any | null {
  const key = keyOf(rawId);
  return mem.has(key) ? mem.get(key) : null;
}

// Vuelos en curso, para deduplicar (hover + click no disparan dos fetches).
const inflight = new Map<string, Promise<any>>();

/**
 * Trae el dossier. Usa cache si existe. Si no, fetchea con un backoff corto
 * (el persist a Cloud SQL puede tardar 1-2s justo después de analizar; en
 * navegación normal el primer intento ya tiene la data).
 *
 * A propósito NO es abortable: el dato es inmutable y cachearlo siempre es útil,
 * así que dejamos que el fetch complete aunque el componente se desmonte (p.ej.
 * el doble-montaje de React StrictMode en dev). El caller decide si usa el
 * resultado con su propio flag de cancelación.
 */
export async function getDossier(rawId: string): Promise<any> {
  const key = keyOf(rawId);

  const cached = peekDossier(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const DELAYS = [0, 700, 1500]; // 3 intentos, ~2.2s peor caso antes de "not_found"
  const run = (async () => {
    let lastErr: DossierError | null = null;
    for (let i = 0; i < DELAYS.length; i++) {
      if (DELAYS[i]) await new Promise((r) => setTimeout(r, DELAYS[i]));
      let res: Response;
      try {
        res = await fetch(`/api/agent/history/${encodeURIComponent(key)}`);
      } catch (e) {
        lastErr = new DossierError("error", (e as Error)?.message || "sin conexión");
        break;
      }
      const txt = await res.text();
      let data: any;
      try {
        data = JSON.parse(txt);
      } catch {
        lastErr = new DossierError("error", `Respuesta ilegible (${res.status})`);
        break;
      }
      const notFound = res.status === 404 || data?.error === "not_found";
      if (res.ok && !data?.error) {
        mem.set(key, data);
        return data;
      }
      lastErr = new DossierError(notFound ? "not_found" : "error", data?.detail || data?.error || `Error ${res.status}`);
      if (!notFound) break; // error real (no 404) → no reintentar
    }
    throw lastErr ?? new DossierError("not_found", "not_found");
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

// ── Lista de análisis previos ──────────────────────────────────────
// La página de Convocatorias monta DOS componentes que piden la misma lista
// (autocomplete + "Análisis previos"). Deduplicamos el vuelo para que sea UNA
// sola request. NO cacheamos persistente: tras analizar algo nuevo, un re-montaje
// debe traer la lista fresca.
let listInflight: Promise<any> | null = null;

export function getAnalyzedList(limit = 500): Promise<any> {
  if (listInflight) return listInflight;
  listInflight = fetch(`/api/agent/history?limit=${limit}`)
    .then((r) => r.json())
    .finally(() => { listInflight = null; });
  return listInflight;
}

// ── Traza del análisis ("Cómo se hizo"), bajo demanda ─────────────────
// El informe llega sin la traza (~68 % del dossier): se pide recién al abrir su pestaña.
// Misma caché de memoria que el dossier y un solo vuelo por alerta.

const trazas = new Map<string, DatosTraza>();
const trazasEnVuelo = new Map<string, Promise<DatosTraza>>();

const claveTraza = (codigo: string | null, id: string) => (codigo || keyOf(id)).toUpperCase();

const aDatosTraza = (j: any): DatosTraza | null =>
  j && Array.isArray(j.agent_trace)
    ? { agent_trace: j.agent_trace, llm_metrics: j.llm_metrics ?? null, self_evals: j.self_evals ?? null }
    : null;

/** La traza ya bajada en esta sesión, sin tocar la red. */
export function peekTraza(codigo: string | null, id: string): DatosTraza | null {
  return trazas.get(claveTraza(codigo, id)) ?? null;
}

/**
 * La traza de un análisis: `GET /alertas/:codigo/traza` directo a la API (gzip y ETag los
 * pone la API). COMPAT-API-VIEJA: la API de prod no tiene `/traza` (404); entonces la saca
 * la ruta del frontend de `/alertas/:id/full` (`/api/agent/history/:id?traza=1`).
 */
export async function getTraza(codigo: string | null, id: string): Promise<DatosTraza> {
  const k = claveTraza(codigo, id);
  const ya = trazas.get(k);
  if (ya) return ya;
  const enVuelo = trazasEnVuelo.get(k);
  if (enVuelo) return enVuelo;
  const run = (async () => {
    // COMPAT-API-VIEJA: `/traza` sólo si la API es la nueva (lib/capacidades): a ciegas, la
    // API vieja respondía 404 y dejaba un error en la consola.
    if (codigo && (await apiNueva())) {
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/alertas/${encodeURIComponent(codigo)}/traza`);
        if (r.ok) {
          const d = aDatosTraza(await r.json());
          if (d) {
            trazas.set(k, d);
            return d;
          }
        }
      } catch {
        /* se intenta por la ruta del frontend */
      }
    }
    const r = await fetch(`/api/agent/history/${encodeURIComponent(keyOf(id || codigo || ""))}?traza=1`);
    let j: any = null;
    try {
      j = await r.json();
    } catch {
      /* cuerpo ilegible: se informa abajo */
    }
    const d = r.ok ? aDatosTraza(j) : null;
    if (!d) throw new DossierError(r.status === 404 ? "not_found" : "error", j?.detail || j?.error || `Error ${r.status}`);
    trazas.set(k, d);
    return d;
  })();
  trazasEnVuelo.set(k, run);
  try {
    return await run;
  } finally {
    trazasEnVuelo.delete(k);
  }
}

/** Warm-up fire-and-forget (para prefetch on hover). No lanza. */
export function prefetchDossier(rawId: string): void {
  const key = keyOf(rawId);
  if (mem.has(key) || inflight.has(key)) return;
  getDossier(key).catch(() => {});
}
