/**
 * Helper compartido para leer el cache de MEF pre-fetcheado por
 * `scripts/fetch_mef_budget.py`. Usado por:
 *  - app/api/mef/region/[dept]/route.ts
 *  - app/(dashboard)/region/[id]/page.tsx (server-side prefetch)
 *
 * La idea: SIEMPRE preferí el JSON estático antes que pegarle al portal MEF,
 * que tarda 60-120 s con cualquier departamento mediano.
 */

import fs from "node:fs/promises";
import path from "node:path";
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
}

async function loadCache(): Promise<Record<string, RegionBudgetSummary>> {
  if (cachedFile && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedFile;
  }
  try {
    const p = path.join(process.cwd(), "public", "mef-budget.json");
    const raw = await fs.readFile(p, "utf-8");
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
    return cache[dept];
  }

  // 2. Fallback live (lento)
  try {
    return await fetchRegionBudget(dept);
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
    const p = path.join(process.cwd(), "public", "mef-entities.json");
    const raw = await fs.readFile(p, "utf-8");
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
 *      `scripts/fetch_mef_entities.py`)
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

  // 2. Live (con cache en memoria 1h adentro de fetchMefBudget)
  return await fetchMefBudget(keyword);
}
