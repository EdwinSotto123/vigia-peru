/**
 * El informe de un contrato armado en el SERVIDOR del frontend: lo usan la página
 * /app/convocatoria/[id] (server component) y la ruta /api/agent/history/[ocid].
 *
 * Antes la página era un client component: HTML vacío → ~370 KB de JS → ~360 KB de JSON →
 * recién ahí la cabecera. Ahora la cabecera, las cifras, el veredicto y las señales llegan
 * en el HTML, y el informe viaja SIN la traza de los agentes (~68 % del dossier), que se
 * pide al abrir "Cómo se hizo" (`/alertas/:id/traza`, ver lib/dossier-cache.ts `getTraza`).
 *
 * Sin la traza, "qué agentes corrieron" (la cabecera y el veredicto lo necesitan) sale de
 * `traza_resumen` (eventos, agentes, herramientas: unos cientos de bytes) y el perfil del
 * pipeline de `perfil`. Si la API los manda, se usan; si no, se sacan acá, en el servidor.
 *
 * Sin nada de cliente: nunca importar desde acá un módulo "use client".
 */

import { adaptLoadedToUi, perfilDeTraza } from "./dossier-adaptar";
import { esAlertaDemo } from "./semillas";
import { resumenTrazaValido, resumirTraza, type ResumenTraza } from "@/components/convocatoria/dossier";
import type { ApiResult } from "@/components/convocatoria/types";

export const API_DOSSIER =
  process.env.VIGIA_API_URL || process.env.NEXT_PUBLIC_VIGIA_API_URL || "https://vigia-peru-api-36169102688.us-central1.run.app";

/** Segundos que el informe queda en la caché de datos de Next: un dossier se puede reprocesar. */
const REVALIDAR_S = 30;

/** El id tal como llega en la URL → la clave con que se busca (sin el prefijo OECE-). */
export function claveDossier(raw: string | null | undefined): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ya venía decodificado, o trae un % suelto: se usa tal cual */
  }
  return s.replace(/^OECE-/i, "").trim().slice(0, 160);
}

/** El id legible para los mensajes de la página (con su prefijo, como lo escribió quien enlazó). */
export function idLegible(raw: string | null | undefined): string {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* tal cual */
  }
  return s.trim().slice(0, 160);
}

/**
 * Lo que la API devuelve pero no es un dossier: las 10 alertas de demo `ALT-2026-00xx`
 * sembradas en la base (lib/semillas.ts), sin registro OCDS ni fecha de análisis.
 */
export function noEsDossier(loaded: any): boolean {
  return !loaded || !!loaded.error || esAlertaDemo({ codigo: loaded.alerta_codigo }) || (!loaded.ocds_payload && !loaded.analizado_en);
}

/** La traza, con lo que la acompaña en la pestaña "Cómo se hizo". */
export interface DatosTraza {
  agent_trace: any[];
  llm_metrics: any;
  self_evals: any;
}

export function extraerTraza(loaded: any): DatosTraza {
  return {
    agent_trace: Array.isArray(loaded?.agent_trace) ? loaded.agent_trace : [],
    llm_metrics: loaded?.llm_metrics ?? null,
    self_evals: loaded?.self_evals ?? null,
  };
}

/** La traza de una alerta, servidor a servidor, sólo para resumirla (al navegador no viaja). */
async function trazaParaResumir(codigo: string): Promise<any[] | null> {
  try {
    const r = await fetch(`${API_DOSSIER}/alertas/${encodeURIComponent(codigo)}/traza`, {
      next: { revalidate: REVALIDAR_S * 2, tags: [`dossier:${claveDossier(codigo)}`] },
      signal: AbortSignal.timeout(15_000),
    } as RequestInit);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.agent_trace) ? j.agent_trace : null;
  } catch {
    return null;
  }
}

/**
 * La respuesta de `/alertas/:id/full` → el informe listo para <ResultadoView>, sin traza,
 * métricas ni autoevaluación (se piden al abrir "Cómo se hizo").
 *
 * COMPAT-API-VIEJA: la API de prod ignora `?sinTraza=1` y manda la traza entera; acá se
 * resume y se descarta. Con la API nueva la traza no viene: si tampoco viene `traza_resumen`,
 * se pide `/alertas/:id/traza` desde el servidor para resumirla.
 */
export async function armarDossier(loaded: any, clave: string): Promise<ApiResult> {
  const traza: any[] | null = Array.isArray(loaded?.agent_trace) && loaded.agent_trace.length > 0 ? loaded.agent_trace : null;
  let resumen: ResumenTraza | null = resumenTrazaValido(loaded?.traza_resumen) ?? (traza ? resumirTraza(traza) : null);
  let perfil: string | null = (typeof loaded?.perfil === "string" && loaded.perfil) || (traza ? perfilDeTraza(traza) : null);
  if (!traza && !resumen) {
    const t = await trazaParaResumir(loaded?.alerta_codigo || clave);
    if (t) {
      resumen = resumirTraza(t);
      perfil = perfil ?? perfilDeTraza(t);
    }
  }
  const ui = adaptLoadedToUi({ ...loaded, agent_trace: [], llm_metrics: null, self_evals: null, perfil, traza_resumen: resumen }) as ApiResult;
  // La traza quedó afuera a propósito: la pestaña "Cómo se hizo" la pide aparte.
  return { ...ui, traza_perezosa: true };
}

export type CargaDossier =
  | { estado: "ok"; result: ApiResult }
  | { estado: "not_found"; demo: boolean }
  | { estado: "error"; mensaje: string };

/**
 * El informe para la página: `/alertas/:id/full?sinTraza=1` en la caché de datos de Next
 * (30 s, etiqueta `dossier:<clave>` para poder invalidarlo al persistir un análisis nuevo).
 * Next sólo guarda las respuestas 200: un 404 del lapso entre analizar y persistir no queda
 * pegado en la caché.
 */
export async function cargarDossier(raw: string): Promise<CargaDossier> {
  const clave = claveDossier(raw);
  if (!clave) return { estado: "not_found", demo: false };
  if (esAlertaDemo({ codigo: clave })) return { estado: "not_found", demo: true };
  let r: Response;
  try {
    r = await fetch(`${API_DOSSIER}/alertas/${encodeURIComponent(clave)}/full?sinTraza=1`, {
      next: { revalidate: REVALIDAR_S, tags: [`dossier:${clave}`] },
      signal: AbortSignal.timeout(20_000),
    } as RequestInit);
  } catch (e) {
    return { estado: "error", mensaje: (e as Error)?.name === "TimeoutError" ? "El servidor tardó demasiado" : "Sin conexión con el servidor" };
  }
  if (r.status === 404) return { estado: "not_found", demo: false };
  if (!r.ok) return { estado: "error", mensaje: `Error ${r.status} del servidor` };
  let loaded: any;
  try {
    loaded = await r.json();
  } catch {
    return { estado: "error", mensaje: "Respuesta ilegible del servidor" };
  }
  if (noEsDossier(loaded)) return { estado: "not_found", demo: esAlertaDemo({ codigo: loaded?.alerta_codigo }) };
  try {
    return { estado: "ok", result: await armarDossier(loaded, clave) };
  } catch (e) {
    return { estado: "error", mensaje: (e as Error)?.message || "No se pudo armar el informe" };
  }
}
