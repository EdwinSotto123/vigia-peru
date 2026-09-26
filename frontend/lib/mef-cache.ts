/**
 * Helper compartido para leer el cache de MEF pre-fetcheado por
 * `backend/scripts/fetch_mef_budget.py`. Usado por:
 *  - app/api/mef/region/[dept]/route.ts
 *  - components/EjecucionPresupuestal.tsx (ficha de entidad)
 *
 * La idea: SIEMPRE preferir el JSON estático antes que pegarle al portal MEF,
 * que tarda 60-120 s con cualquier departamento mediano.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { EN_WORKERS, leerAssetPublico } from "./entorno";
import {
  fetchRegionBudget,
  fetchMefBudget,
  type RegionBudgetSummary,
  type MefBudgetResult,
  type MefBudgetRow,
} from "./mef";

let cachedFile: Record<string, RegionBudgetSummary> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 2_000;

let cachedEntities: Record<string, EntityCacheEntry> | null = null;
let entitiesLoadedAt = 0;

interface EntityCacheEntry {
  ruc: string;
  nombre: string;
  keyword: string;
  kind: "ok" | "partial" | "failed";
  totalRows: number;
  matchedPliegos: string[];
  byYear: MefBudgetRow[];
  fetchedAt?: string;
}

/**
 * Fecha de descarga de una entrada del cache. Los JSON de hoy no la traen
 * (`fetch_mef_budget.py` no la escribe), así que devuelve `null` y la interfaz
 * dice "sin fecha registrada". No se usa la fecha del archivo: en un clon
 * nuevo es la del checkout, y en Cloud Run (buildpacks) es 1980. Sería otra
 * fecha falsa como el "Datos al <hoy>" que había antes.
 */
function fechaDe(entry: unknown): string | null {
  const e = entry as { fetchedAt?: unknown; fechaDescarga?: unknown } | null;
  const f = e?.fetchedAt ?? e?.fechaDescarga;
  return typeof f === "string" && !Number.isNaN(new Date(f).getTime()) ? f : null;
}

/** Un JSON de `public/`: del disco en Node; en Cloudflare Workers (sin disco), de los assets. */
async function leerPublico(nombre: string): Promise<string> {
  if (EN_WORKERS) {
    const texto = await leerAssetPublico(nombre);
    if (texto === null) throw new Error(`${nombre} no está en los assets`);
    return texto;
  }
  return fs.readFile(path.join(process.cwd(), "public", nombre), "utf-8");
}

async function loadCache(): Promise<Record<string, RegionBudgetSummary>> {
  if (cachedFile && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedFile;
  }
  try {
    const raw = await leerPublico("mef-budget.json");
    cachedFile = JSON.parse(raw);
    cacheLoadedAt = Date.now();
    return cachedFile ?? {};
  } catch (e) {
    // JSON parcial mientras corre el script → devolvé lo último que tenías
    if (cachedFile) return cachedFile;
    cachedFile = {};
    cacheLoadedAt = Date.now();
    return {};
  }
}

/**
 * Trae el presupuesto regional: cache primero, live como fallback.
 * Devuelve `null` si ni cache ni live tienen data.
 */
export async function getRegionBudget(
  mefDept: string,
): Promise<RegionBudgetSummary | null> {
  const dept = mefDept.toUpperCase();

  // 1. Cache estático
  const cache = await loadCache();
  if (cache[dept] && cache[dept].totalRows > 0) {
    return { ...cache[dept], fechaDescarga: fechaDe(cache[dept]) };
  }

  // 2. Fallback live (lento): se descargó recién.
  try {
    const vivo = await fetchRegionBudget(dept);
    return vivo ? { ...vivo, fechaDescarga: new Date().toISOString() } : null;
  } catch (e) {
    console.error("[mef-cache] live fallback failed for", dept, e);
    return null;
  }
}

// ─── Entity cache ──────────────────────────────────────────────

async function loadEntities(): Promise<Record<string, EntityCacheEntry>> {
  if (cachedEntities && Date.now() - entitiesLoadedAt < CACHE_TTL_MS) {
    return cachedEntities;
  }
  try {
    const raw = await leerPublico("mef-entities.json");
    cachedEntities = JSON.parse(raw);
    entitiesLoadedAt = Date.now();
    return cachedEntities ?? {};
  } catch (e) {
    if (cachedEntities) return cachedEntities;
    cachedEntities = {};
    entitiesLoadedAt = Date.now();
    return {};
  }
}

/**
 * Trae el presupuesto de una entidad. Estrategia:
 *   1. Si pasaste RUC: busca en `mef-entities.json` (pre-fetcheado por
 *      `backend/scripts/fetch_mef_entities.py`)
 *   2. Si el cache devuelve "ok" o "partial" con data → devuelvo eso
 *   3. Fallback: `fetchMefBudget(keyword)` live (con cache en memoria, ver
 *      lib/mef.ts)
 */
export async function getEntityBudget(
  keyword: string,
  ruc?: string,
): Promise<MefBudgetResult> {
  // 1. Cache por RUC
  if (ruc) {
    const entities = await loadEntities();
    const entry = entities[ruc];
    if (entry) {
      // Caso A: cache dice "ok" o "partial" con data → la devolvemos
      if (entry.kind !== "failed" && entry.totalRows > 0) {
        return {
          kind: "ok",
          data: {
            query: entry.keyword || keyword,
            matchedPliegos: entry.matchedPliegos,
            totalRows: entry.totalRows,
            byYear: entry.byYear,
            fechaDescarga: fechaDe(entry),
          },
        };
      }
      // Caso B: cache dice 0 rows (el keyword no matchea ningún PLIEGO_NOMBRE)
      // → devolvemos "empty" sin pegarle a MEF (sería el mismo resultado y caro)
      if (entry.kind === "partial" || entry.kind === "ok") {
        return { kind: "empty", query: entry.keyword || keyword };
      }
      // Caso C: kind === "failed" → cayó en script; intentamos live
    }
  }

  // 2. Live (con cache en memoria 1h adentro de fetchMefBudget): la fecha es la de ahora
  //    como mucho una hora atrás; se dice "descargado hoy" sin inventar la hora.
  const vivo = await fetchMefBudget(keyword);
  return vivo.kind === "ok" ? { ...vivo, data: { ...vivo.data, fechaDescarga: vivo.data.fechaDescarga ?? new Date().toISOString() } } : vivo;
}
