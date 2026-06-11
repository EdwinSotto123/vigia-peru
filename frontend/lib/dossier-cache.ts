/**
 * Cache de dossiers en el cliente.
 *
 * Un análisis cacheado es **inmutable** (ya corrió el pipeline y se persistió),
 * así que no tiene sentido re-fetchearlo cada vez que el usuario entra al mismo
 * dossier. Guardamos:
 *   1. en memoria (Map de módulo) → revisita instantánea sin tocar la red.
 *   2. en sessionStorage          → sobrevive recargas de la pestaña.
 *
 * Esto reemplaza el `cache:"no-store"` + `useEffect` que re-fetcheaba 473 KB en
 * cada navegación. El fetch real va a /api/agent/history/[id], que ahora pega a
 * la API liviana (no al orquestador ADK).
 */

const mem = new Map<string, any>();

/** Normaliza el id a la llave de cache (quita prefijo OECE-, decodifica). */
function keyOf(rawId: string): string {
  return decodeURIComponent(rawId || "").replace(/^OECE-/i, "").trim();
}

function fromSession(key: string): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`dossier:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toSession(key: string, data: any): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`dossier:${key}`, JSON.stringify(data));
  } catch {
    // sessionStorage lleno o bloqueado → seguimos con cache en memoria.
  }
}

/** Devuelve el dossier de cache (memoria o sessionStorage) sin tocar la red. */
export function peekDossier(rawId: string): any | null {
  const key = keyOf(rawId);
  if (mem.has(key)) return mem.get(key);
  const s = fromSession(key);
  if (s) mem.set(key, s);
  return s;
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
    let lastErr: any = null;
    for (let i = 0; i < DELAYS.length; i++) {
      if (DELAYS[i]) await new Promise((r) => setTimeout(r, DELAYS[i]));
      const res = await fetch(`/api/agent/history/${encodeURIComponent(key)}`);
      const txt = await res.text();
      let data: any;
      try {
        data = JSON.parse(txt);
      } catch {
        lastErr = new Error(`Respuesta no-JSON (${res.status}). ${txt.slice(0, 160)}`);
        break;
      }
      const notFound = !res.ok || data?.error === "not_found";
      if (!notFound && !data?.error) {
        mem.set(key, data);
        toSession(key, data);
        return data;
      }
      lastErr = new Error(data?.detail || data?.error || `Error ${res.status}`);
      if (!notFound) break; // error real (no 404) → no reintentar
    }
    throw lastErr ?? new Error("not_found");
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

export function getAnalyzedList(limit = 50): Promise<any> {
  if (listInflight) return listInflight;
  listInflight = fetch(`/api/agent/history?limit=${limit}`)
    .then((r) => r.json())
    .finally(() => { listInflight = null; });
  return listInflight;
}

/** Warm-up fire-and-forget (para prefetch on hover). No lanza. */
export function prefetchDossier(rawId: string): void {
  const key = keyOf(rawId);
  if (mem.has(key) || fromSession(key) || inflight.has(key)) return;
  getDossier(key).catch(() => {});
}
