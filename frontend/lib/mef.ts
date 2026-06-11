/**
 * Cliente para la API de Datos Abiertos del MEF (CKAN).
 *
 * Endpoint base: https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/
 *
 * Recurso principal — `comparativo_gastos_2022_2026.csv`:
 *   resource_id = "510bae6d-3d37-4fb2-af35-a40ce01715f4"
 *   8 millones de filas con PIA / PIM / Certificado / Comprometido / Devengado / Girado
 *   por (Pliego × Ejecutora × Meta × Específica de gasto × Año) para 2022-2026.
 *
 * Notas:
 *   - Los campos numéricos vienen como strings → hay que hacer `::numeric` en SQL.
 *   - El JSON envuelve `records` al nivel raíz (no en `result.records` como CKAN estándar).
 *   - El campo de éxito está MAL ESCRITO en la API: `"sucess"` no `"success"`.
 */

export const MEF_BASE =
  "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1";

export const MEF_RESOURCE_GASTOS = "510bae6d-3d37-4fb2-af35-a40ce01715f4";

export const MEF_YEARS = [2022, 2023, 2024, 2025, 2026] as const;
export type MefYear = (typeof MEF_YEARS)[number];

export interface MefBudgetRow {
  year: MefYear;
  pia: number;
  pim: number;
  certificado: number;
  comprometido: number;
  devengado: number;
  girado: number;
}

export interface MefBudgetSummary {
  query: string;
  matchedPliegos: string[]; // top 5 PLIEGO_NOMBRE distintos que matchearon
  totalRows: number;
  byYear: MefBudgetRow[];
}

export type MefBudgetResult =
  | { kind: "ok"; data: MefBudgetSummary }
  | { kind: "empty"; query: string }   // MEF respondió pero no había registros
  | { kind: "timeout"; query: string } // MEF tardó demasiado / abortado
  | { kind: "error"; query: string; message: string };

interface MefSqlResponse {
  records: Record<string, string | number>[];
  sucess?: string; // [sic]
}

async function mefSqlQuery<T = Record<string, string>>(
  sql: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T[]> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const url = `${MEF_BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": "vigia-peru/0.1" },
        signal: ac.signal,
      });
      clearTimeout(t);
      if (res.status === 500 || res.status === 502 || res.status === 503) {
        // Reintentable
        const txt = await res.text().catch(() => "");
        lastErr = new Error(`MEF API ${res.status} ${txt.slice(0, 100)}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new Error(`MEF API ${res.status}`);
      }
      const data = (await res.json()) as MefSqlResponse;
      return (data.records ?? []) as T[];
    } catch (e) {
      lastErr = e;
      if (attempt < retries && (e as Error)?.name !== "AbortError") {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      console.error("[MEF] SQL failed final:", (e as Error).message);
      console.error("[MEF] SQL was:", sql.slice(0, 180) + "…");
      throw e;
    }
  }
  throw lastErr;
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── In-memory cache para queries de entidad (TTL 1h) ───────────────
// Vive en el módulo (server-side singleton). Sobrevive entre requests dentro
// del mismo proceso de Node. No persiste entre deploys — pero al cabo de
// minutos del demo, las entidades visitadas quedan calientes.
const ENTITY_CACHE = new Map<string, { result: MefBudgetResult; expires: number }>();
const ENTITY_CACHE_TTL = 60 * 60 * 1000; // 1 hora

function cacheKey(keyword: string, field: string): string {
  return `${field}::${keyword.trim().toUpperCase()}`;
}

/**
 * Pide el resumen presupuestal de un pliego/ejecutora identificado por keyword.
 * Suma todas las metas/específicas/rubros del pliego para cada año.
 *
 * Devuelve un `MefBudgetResult` discriminado para distinguir:
 *   - "ok"      → datos válidos
 *   - "empty"   → MEF respondió 200 OK pero sin registros (entidad no existe en el dataset)
 *   - "timeout" → la API tardó más de timeoutMs · típico en LIKE sobre 8M filas
 *   - "error"   → otro fallo (red, 500, etc.)
 *
 * Resultados positivos y "empty" se cachean 1h en memoria (server-side).
 * Resultados de "timeout"/"error" no se cachean (queremos reintentar).
 */
export async function fetchMefBudget(
  keyword: string,
  opts: { searchIn?: "PLIEGO_NOMBRE" | "EJECUTORA_NOMBRE" } = {},
): Promise<MefBudgetResult> {
  const field = opts.searchIn ?? "PLIEGO_NOMBRE";
  const kw = keyword.trim().toUpperCase().replace(/'/g, "''");
  if (!kw) return { kind: "empty", query: keyword };

  // Cache hit?
  const key = cacheKey(kw, field);
  const cached = ENTITY_CACHE.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  // 1. Agrega por año — solo 4 campos clave para minimizar URL
  const sumExpr = MEF_YEARS.map((y) =>
    [
      `SUM("PIA_${y}"::numeric) AS pia_${y}`,
      `SUM("PIM_${y}"::numeric) AS pim_${y}`,
      `SUM("DEVENGADO_${y}"::numeric) AS dev_${y}`,
      `SUM("GIRADO_${y}"::numeric) AS gir_${y}`,
    ].join(", "),
  ).join(", ");

  const totalsSql = `
    SELECT
      COUNT(*) AS total_rows,
      ${sumExpr}
    FROM "${MEF_RESOURCE_GASTOS}"
    WHERE "${field}" LIKE '%${kw}%'
  `.replace(/\s+/g, " ");

  // 2. Lista los PLIEGO_NOMBRE distintos que matchearon (para mostrar al usuario)
  const pliegosSql = `
    SELECT DISTINCT "${field}" AS nombre
    FROM "${MEF_RESOURCE_GASTOS}"
    WHERE "${field}" LIKE '%${kw}%'
    LIMIT 8
  `.replace(/\s+/g, " ");

  // LIKE en 8M filas es lento → bump timeout a 28s. Sólo 1 reintento para no
  // ahorcar al usuario en 90 s.
  const queryOpts = { timeoutMs: 28_000, retries: 1 };

  let result: MefBudgetResult;
  try {
    const [totals, pliegos] = await Promise.all([
      mefSqlQuery<Record<string, string>>(totalsSql, queryOpts),
      mefSqlQuery<{ nombre: string }>(pliegosSql, queryOpts),
    ]);

    if (!totals.length || num(totals[0].total_rows) === 0) {
      result = { kind: "empty", query: keyword };
    } else {
      const row = totals[0];
      const byYear: MefBudgetRow[] = MEF_YEARS.map((y) => ({
        year: y,
        pia: num(row[`pia_${y}`]),
        pim: num(row[`pim_${y}`]),
        certificado: 0,
        comprometido: 0,
        devengado: num(row[`dev_${y}`]),
        girado: num(row[`gir_${y}`]),
      }));
      result = {
        kind: "ok",
        data: {
          query: keyword,
          matchedPliegos: pliegos.map((p) => p.nombre).filter(Boolean),
          totalRows: num(row.total_rows),
          byYear,
        },
      };
    }

    // Cache solo resultados "estables" (ok/empty)
    ENTITY_CACHE.set(key, { result, expires: Date.now() + ENTITY_CACHE_TTL });
    return result;
  } catch (e) {
    const err = e as Error;
    const isTimeout =
      err.name === "AbortError" || /aborted|timeout/i.test(err.message);
    console.error("[MEF entity] fetch failed:", err.message);
    return isTimeout
      ? { kind: "timeout", query: keyword }
      : { kind: "error", query: keyword, message: err.message };
  }
}

// ─── Region-level (todo lo que se ejecuta EN un departamento) ────────────

export interface BreakdownRow {
  nombre: string;
  pim: number;
  devengado: number;
  pia: number;
  ejecPct: number;
}

export interface RegionBudgetSummary {
  department: string;
  totalRows: number;
  byYear: MefBudgetRow[];
  topSectores: BreakdownRow[];
  topPliegos: BreakdownRow[];
  topProgramas: BreakdownRow[];
  topGenericas?: BreakdownRow[];
}

const TOP_LIMIT = 6;

async function fetchBreakdown(
  dept: string,
  field: "SECTOR_NOMBRE" | "PLIEGO_NOMBRE" | "PROGRAMA_PPTO_NOMBRE" | "GENERICA_NOMBRE",
  year: number,
): Promise<BreakdownRow[]> {
  const sql = `
    SELECT
      "${field}" AS nombre,
      SUM("PIA_${year}"::numeric) AS pia,
      SUM("PIM_${year}"::numeric) AS pim,
      SUM("DEVENGADO_${year}"::numeric) AS dev
    FROM "${MEF_RESOURCE_GASTOS}"
    WHERE "DEPARTAMENTO_EJECUTORA_NOMBRE" = '${dept.replace(/'/g, "''")}'
    GROUP BY "${field}"
    ORDER BY pim DESC
    LIMIT ${TOP_LIMIT}
  `.replace(/\s+/g, " ");

  const records = await mefSqlQuery<{
    nombre: string;
    pia: string;
    pim: string;
    dev: string;
  }>(sql);
  return records
    .filter((r) => r.nombre && num(r.pim) > 0)
    .map((r) => {
      const pim = num(r.pim);
      const devengado = num(r.dev);
      return {
        nombre: r.nombre,
        pim,
        devengado,
        pia: num(r.pia),
        ejecPct: pim > 0 ? (devengado / pim) * 100 : 0,
      };
    });
}

/** Una sola consulta de totales para un año puntual. SQL pequeño → menos riesgo de timeout en MEF. */
async function fetchYearTotals(
  dept: string,
  year: number,
): Promise<{ rows: number; pia: number; pim: number; dev: number; gir: number } | null> {
  const sql = `
    SELECT
      COUNT(*) AS rows,
      SUM("PIA_${year}"::numeric) AS pia,
      SUM("PIM_${year}"::numeric) AS pim,
      SUM("DEVENGADO_${year}"::numeric) AS dev,
      SUM("GIRADO_${year}"::numeric) AS gir
    FROM "${MEF_RESOURCE_GASTOS}"
    WHERE "DEPARTAMENTO_EJECUTORA_NOMBRE" = '${dept.replace(/'/g, "''")}'
  `.replace(/\s+/g, " ");
  const records = await mefSqlQuery<Record<string, string>>(sql);
  if (!records.length) return null;
  return {
    rows: num(records[0].rows),
    pia: num(records[0].pia),
    pim: num(records[0].pim),
    dev: num(records[0].dev),
    gir: num(records[0].gir),
  };
}

/**
 * Resumen presupuestal por DEPARTAMENTO (campo DEPARTAMENTO_EJECUTORA_NOMBRE).
 * Splittea por año para evitar timeouts en MEF (el 500 que daban antes era por
 * queries demasiado grandes — agregando 5 años × 4 SUM × millones de filas en
 * un solo statement). Año actual es crítico; los anteriores son best-effort.
 */
export async function fetchRegionBudget(
  department: string,
): Promise<RegionBudgetSummary | null> {
  const dept = department.trim().toUpperCase();
  if (!dept) return null;
  const currentYear = MEF_YEARS[MEF_YEARS.length - 1];

  // 1. Año actual: TOTALS crítico (debe responder o abortamos)
  let currentTotals;
  try {
    currentTotals = await fetchYearTotals(dept, currentYear);
  } catch (e) {
    console.error("[MEF] current-year totals failed");
    return null;
  }
  if (!currentTotals || currentTotals.rows === 0) {
    return {
      department: dept,
      totalRows: 0,
      byYear: [],
      topSectores: [],
      topPliegos: [],
      topProgramas: [],
    };
  }

  // 2. Año actual: breakdowns + años anteriores (best effort, en paralelo)
  const historicYears = MEF_YEARS.filter((y) => y !== currentYear);
  const results = await Promise.allSettled([
    fetchBreakdown(dept, "SECTOR_NOMBRE", currentYear),
    fetchBreakdown(dept, "PLIEGO_NOMBRE", currentYear),
    fetchBreakdown(dept, "PROGRAMA_PPTO_NOMBRE", currentYear),
    ...historicYears.map((y) => fetchYearTotals(dept, y)),
  ]);

  const [sectRes, pliRes, progRes, ...historicResults] = results;

  // Construye byYear con lo que tengamos
  const yearMap = new Map<number, { pia: number; pim: number; dev: number; gir: number }>();
  yearMap.set(currentYear, {
    pia: currentTotals.pia,
    pim: currentTotals.pim,
    dev: currentTotals.dev,
    gir: currentTotals.gir,
  });
  historicYears.forEach((y, i) => {
    const r = historicResults[i];
    if (r.status === "fulfilled" && r.value) {
      yearMap.set(y, { pia: r.value.pia, pim: r.value.pim, dev: r.value.dev, gir: r.value.gir });
    } else {
      yearMap.set(y, { pia: 0, pim: 0, dev: 0, gir: 0 });
    }
  });

  const byYear: MefBudgetRow[] = MEF_YEARS.map((y) => {
    const v = yearMap.get(y)!;
    return {
      year: y,
      pia: v.pia,
      pim: v.pim,
      certificado: 0,
      comprometido: 0,
      devengado: v.dev,
      girado: v.gir,
    };
  });

  return {
    department: dept,
    totalRows: currentTotals.rows,
    byYear,
    topSectores: sectRes.status === "fulfilled" ? sectRes.value : [],
    topPliegos: pliRes.status === "fulfilled" ? pliRes.value : [],
    topProgramas: progRes.status === "fulfilled" ? progRes.value : [],
  };
}

/**
 * % de ejecución del año = Devengado / PIM × 100.
 * Si PIM=0 devuelve 0.
 */
export function ejecucionPct(row: MefBudgetRow): number {
  if (row.pim === 0) return 0;
  return (row.devengado / row.pim) * 100;
}

/**
 * Formatea soles compactos (S/. 4.25M).
 */
export function formatPEN(v: number): string {
  if (!v) return "S/. 0";
  if (v >= 1_000_000_000) return `S/. ${(v / 1_000_000_000).toFixed(2)} B`;
  if (v >= 1_000_000) return `S/. ${(v / 1_000_000).toFixed(2)} M`;
  if (v >= 1_000) return `S/. ${(v / 1_000).toFixed(0)} K`;
  return `S/. ${v.toLocaleString("es-PE")}`;
}
