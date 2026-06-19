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
 * (no al orquestador ADK) y devuelve el análisis MÁS RECIENTE.
 */

const mem = new Map<string, any>();

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

export function getAnalyzedList(limit = 500): Promise<any> {
  if (listInflight) return listInflight;
  listInflight = fetch(`/api/agent/history?limit=${limit}`)
    .then((r) => r.json())
    .finally(() => { listInflight = null; });
  return listInflight;
}

/** Warm-up fire-and-forget (para prefetch on hover). No lanza. */
export function prefetchDossier(rawId: string): void {
  const key = keyOf(rawId);
  if (mem.has(key) || inflight.has(key)) return;
  getDossier(key).catch(() => {});
}
