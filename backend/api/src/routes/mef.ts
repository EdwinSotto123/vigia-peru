import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { cachePublico } from "../lib/http.js";

/**
 * Presupuesto del MEF por departamento, desde la base. Lo carga el scraper `mef_presupuesto` (archivo
 * <año>-Gasto-Diario.zip → mef_ejecutora_anual → refrescar_mef_presupuesto(), migración 47). Antes el
 * frontend consultaba el portal del MEF en vivo, pero el MEF quitó `datastore_search_sql` y
 * `datastore_search` con filtros tarda 30-110 s. El de cada entidad viene en GET /entidades/:ruc (`mef`).
 */
export const mefRouter = new Hono();

// ─── GET /mef/region/:dept — con la forma de RegionBudgetSummary (frontend/lib/mef.ts) ─────────────
mefRouter.get("/region/:dept", async (c) => {
  const dept = decodeURIComponent(c.req.param("dept")).trim().toUpperCase();
  if (!/^[A-ZÑ ]{3,40}$/.test(dept)) return c.json({ error: "not_found" }, 404);
  const r = await pool.query(
    `SELECT departamento AS department, total_rows::int AS "totalRows", by_year AS "byYear",
            top_sectores AS "topSectores", top_pliegos AS "topPliegos", top_programas AS "topProgramas",
            top_genericas AS "topGenericas",
            (SELECT max(corte) FROM mef_ejecutora_anual) AS "fechaDescarga"
       FROM mef_region_budget WHERE departamento = $1`,
    [dept],
  );
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 86400 }));
  return c.json(r.rows[0]);
});
