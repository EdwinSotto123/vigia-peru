/**
 * Presupuesto del MEF para la web, leído de la API de Vigía (la base), no del portal del MEF.
 *
 * Desde octubre de 2026 el MEF quitó `datastore_search_sql` y vació el recurso comparativo 2022-2026: la
 * consulta en vivo que hacía lib/mef.ts siempre fallaba (≈ 600 errores al día en los logs del frontend). El
 * dato ahora lo carga el scraper `mef_presupuesto` (archivo <año>-Gasto-Diario.zip del MEF, semanal →
 * mef_region_budget y mef_entity_budget) y la API lo sirve:
 *  - región:  GET /mef/region/:dept   (app/api/mef/region/[dept]/route.ts → PresupuestoRegional)
 *  - entidad: GET /entidades/:ruc → `mef` (components/EjecucionPresupuestal.tsx)
 * Si la API no responde, la región cae al JSON estático de public/ (copia de mayo de 2026) como último
 * recurso. No queda ninguna consulta en vivo al MEF.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { EN_WORKERS, leerAssetPublico } from "./entorno";
import { ApiError, getEntidad, getMefRegion } from "./api-client";
import type { MefBudgetResult, MefBudgetRow, OrigenMef, RegionBudgetSummary } from "./mef";

/** Un JSON de `public/`: del disco en Node; en Cloudflare Workers (sin disco), de los assets. */
async function leerPublico(nombre: string): Promise<string> {
  if (EN_WORKERS) {
    const texto = await leerAssetPublico(nombre);
    if (texto === null) throw new Error(`${nombre} no está en los assets`);
    return texto;
  }
  return fs.readFile(path.join(process.cwd(), "public", nombre), "utf-8");
}

/** Presupuesto de un departamento: la API primero; si la API falla, la copia estática (vieja). */
export async function getRegionBudget(mefDept: string): Promise<RegionBudgetSummary | null> {
  const dept = mefDept.toUpperCase();
  try {
    return await getMefRegion(dept);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    console.error("[mef-cache] API /mef/region falló para", dept, (e as Error).message);
  }
  try {
    const cache = JSON.parse(await leerPublico("mef-budget.json")) as Record<string, RegionBudgetSummary>;
    return cache[dept]?.totalRows ? { ...cache[dept], fechaDescarga: null } : null;
  } catch {
    return null;
  }
}

interface FilaMefEntidad {
  keyword: string | null;
  total_rows: number | string | null;
  by_year: MefBudgetRow[] | null;
  matched_pliegos: string[] | null;
  kind: string;
  last_refreshed: string | null;
  /** Fecha del archivo del MEF de su último año (la API la agrega desde mef_ejecutora_anual o mef_opds_etes_anual). */
  corte?: string | null;
  /** Migración 152: 'siaf' | 'opds' | 'etes', y el último año que el MEF publica de ese archivo. */
  origen?: OrigenMef | null;
  ultimoAnioMef?: number | null;
}

/** Un monto de by_year: en las ETE certificado, comprometido y girado vienen en null (no los publican). */
const monto = (v: unknown) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : 0);

/**
 * Presupuesto de una entidad: la fila `mef` de GET /entidades/:ruc (unidad ejecutora cruzada por ubigeo, por su
 * nombre o, en los gobiernos regionales que no se identifican, el pliego entero; ver las migraciones 47 y 62).
 * Sin fila → "empty".
 */
export async function getEntityBudget(keyword: string, ruc?: string): Promise<MefBudgetResult> {
  if (!ruc) return { kind: "empty", query: keyword };
  let fila: FilaMefEntidad | null = null;
  try {
    fila = ((await getEntidad(ruc))?.mef ?? null) as FilaMefEntidad | null;
  } catch (e) {
    return { kind: "error", query: keyword, message: (e as Error).message };
  }
  if (!fila || fila.kind !== "ok" || !fila.by_year?.length) return { kind: "empty", query: keyword };
  // `keyword` dice cómo cruzó: "ubigeo 080101", "ejecutora REGION CUSCO-SEDE CENTRAL", "nombre …" o "pliego GOBIERNO …".
  const [como, ...resto] = (fila.keyword ?? "").split(" ");
  const cruce = (["ubigeo", "ejecutora", "nombre", "pliego"] as const).find((c) => c === como) ?? null;
  return {
    kind: "ok",
    data: {
      query: fila.keyword ?? keyword,
      cruce,
      pliego: cruce === "pliego" ? resto.join(" ") : null,
      matchedPliegos: fila.matched_pliegos ?? [],
      totalRows: Number(fila.total_rows ?? 0),
      byYear: fila.by_year.map((r) => ({
        year: Number(r.year), pia: monto(r.pia), pim: monto(r.pim), certificado: monto(r.certificado),
        comprometido: monto(r.comprometido), devengado: monto(r.devengado), girado: monto(r.girado),
      })),
      fechaDescarga: fila.corte ?? fila.last_refreshed,
      origen: fila.origen ?? "siaf",
      ultimoAnioMef: fila.ultimoAnioMef ?? null,
    },
  };
}
