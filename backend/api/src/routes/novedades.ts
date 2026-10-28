import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { DATASET_SANCIONADOS } from "../lib/fuentes.js";

/**
 * GET /novedades?dias=7 — lo nuevo (fase 6 del plan del 2026-10-27): los contratos con antecedentes graves de los últimos
 * días (la buena pro de esa fecha), las sanciones nuevas del Tribunal de Contrataciones y los informes nuevos de la
 * Contraloría. Cada uno con su enlace a la ficha y a la fuente. De las sanciones, sólo empresas (una persona natural
 * sancionada no se nombra aquí); de los contratos, el nombre del ganador sólo si es una empresa (RUC 20).
 */
export const novedadesRouter = new Hono();

const CACHE = cachePublico(1800, { maxAge: 300, swr: 7200 });
const memo = new Memo<Record<string, unknown>>({ nombre: "novedades", ttlMs: 1_800_000, staleMs: 3_600_000, max: 8 });
const Q = z.object({ dias: z.coerce.number().int().min(1).max(31).default(7) });

novedadesRouter.get("/", async (c) => {
  const p = Q.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { dias } = p.data;
  const cuerpo = await memo.obtener(String(dias), async () => {
    // Las buenas pro llegan con atraso (CONOSCE, una vez por semana): la ventana es la de los últimos días CON datos, y se dice.
    const ult = await pool
      .query<{ f: string | null }>(`SELECT to_char(max(fecha_buena_pro), 'YYYY-MM-DD') AS f FROM casos_cruce WHERE fecha_buena_pro <= current_date`)
      .then((r) => r.rows[0]?.f ?? null)
      .catch(() => null);
    const [contratos, sanciones, informes] = await Promise.all([
      pool.query(
        `SELECT k.ocid, k.ruc, k.proveedor, k.entidad, k.entidad_ruc AS "entidadRuc", k.tipo_contratacion AS tipo, left(k.objeto, 200) AS objeto,
                to_char(k.fecha_buena_pro, 'YYYY-MM-DD') AS fecha, k.monto::float AS monto, k.tipos, k.n_alta AS "nAlta"
           FROM casos_cruce k
          WHERE k.fecha_buena_pro > COALESCE($2::date, current_date) - $1::int AND k.fecha_buena_pro <= COALESCE($2::date, current_date)
            AND k.severidad = 'alta'
          ORDER BY k.n_alta DESC, k.monto DESC NULLS LAST LIMIT 150`, [dias, ult]).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT s.id, s.ruc, s.razon_social AS nombre, s.tipo, s.resolucion, to_char(s.fecha_resolucion, 'YYYY-MM-DD') AS fecha,
                to_char(s.fecha_desde, 'YYYY-MM-DD') AS desde, to_char(s.fecha_hasta, 'YYYY-MM-DD') AS hasta, s.monto_multa_soles::float AS multa
           FROM osce_sancionados s
          WHERE s.fecha_resolucion >= current_date - 30 AND s.fecha_resolucion <= current_date
            AND NOT COALESCE(s.es_persona_natural, false) AND s.ruc ~ '^20\\d{9}$'
          ORDER BY s.fecha_resolucion DESC LIMIT 150`).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT i.codigo, i.numero, i.titulo, i.entidad_nombre AS entidad, i.entidad_ruc AS "entidadRuc", i.responsabilidades,
                to_char(i.fecha_emision, 'YYYY-MM-DD') AS fecha, COALESCE(i.url_pdf, i.url_resumen) AS url
           FROM informes_control i
          WHERE i.fecha_emision >= current_date - 30 AND i.fecha_emision <= current_date
          ORDER BY i.fecha_emision DESC LIMIT 150`).catch(() => ({ rows: [] })),
    ]);
    return {
      dias,
      // La semana de contratos que se muestra: hasta el último día con buenas pro cargadas.
      contratosHasta: ult,
      contratos: contratos.rows.map((r) => ({ ...r, ruc: /^20\d{9}$/.test(r.ruc) ? r.ruc : null, proveedor: /^20\d{9}$/.test(r.ruc) ? r.proveedor : null })),
      sanciones: sanciones.rows,
      informes: informes.rows,
      fuentes: { sanciones: DATASET_SANCIONADOS },
    };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
