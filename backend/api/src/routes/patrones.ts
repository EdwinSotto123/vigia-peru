/**
 * Patrones para quien investiga (migración 276):
 *
 *   GET /patrones?alcance=entidad|proveedor&ruc=&regla=&page=&size=
 *       Señales de los agentes que se REPITEN. Por entidad: la señal está en una parte de sus contratos leídos que es
 *       el doble de la del país (y al menos el 40 %). Por proveedor: la misma señal de proceso en 3 o más contratos y
 *       2 o más entidades. Cada patrón trae hasta 8 contratos de ejemplo.
 *   GET /patrones/acompanantes?ruc=&solo=fuertes&page=&size=
 *       Postores de relleno: empresas que casi nunca ganan y dedican sus postulaciones a acompañar a un mismo ganador.
 *       Con `ruc`, los de esa empresa (como ganadora y como acompañante); sin él, los pares más fuertes del país.
 *
 * Todo sale de señales y postulaciones ya públicas, sólo de empresas (RUC 20). Un patrón es un motivo para mirar, no una
 * acusación.
 */
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";

export const patronesRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "patrones", ttlMs: 900_000, staleMs: 3_600_000, max: 400 });

const Lista = z.object({
  alcance: z.enum(["entidad", "proveedor"]).default("entidad"),
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  regla: z.string().trim().regex(/^[a-z_0-9]{3,60}$/).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/", async (c) => {
  const p = Lista.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`lista:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [q.alcance];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds = ["alcance = $1"];
    if (q.ruc) conds.push(`ruc = ${add(q.ruc)}`);
    if (q.regla) conds.push(`regla = ${add(q.regla)}`);
    const donde = conds.join(" AND ");
    const [filas, total, reglas] = await Promise.all([
      pool.query(
        `SELECT ruc, nombre, regla, casos, leidos, entidades, tasa::float AS tasa, tasa_pais::float AS "tasaPais", veces::float AS veces,
                monto::float AS monto, ejemplos, to_char(refrescado_at, 'YYYY-MM-DD') AS "calculadoEl"
           FROM patron_agentes WHERE ${donde}
          ORDER BY veces DESC, casos DESC, ruc LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM patron_agentes WHERE ${donde}`, vals.slice(0, vals.length - 2)),
      pool.query(`SELECT regla, count(*)::int AS n FROM patron_agentes WHERE alcance = $1 GROUP BY 1 ORDER BY 2 DESC`, [q.alcance]),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, page: q.page, size: q.size, porRegla: reglas.rows, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

const Acompanantes = z.object({
  ruc: z.string().regex(/^20\d{9}$/).optional(),
  solo: z.enum(["fuertes", "todos"]).default("fuertes"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

patronesRouter.get("/acompanantes", async (c) => {
  const p = Acompanantes.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`acomp:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [];
    const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const conds: string[] = [];
    if (q.ruc) conds.push(`(ruc_ganador = ${add(q.ruc)} OR ruc_acompanante = $${vals.length})`);
    if (q.solo === "fuertes" && !q.ruc) conds.push("fuerte");
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const n = vals.length;
    const [filas, total] = await Promise.all([
      pool.query(
        `SELECT ruc_ganador AS "rucGanador", ganador, ruc_acompanante AS "rucAcompanante", acompanante, juntos, entidades,
                postulo AS "postulacionesDelAcompanante", gano AS "ganadasDelAcompanante", parte::float AS parte,
                to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, vinculo, fuerte
           FROM postor_acompanante ${donde}
          ORDER BY fuerte DESC, (vinculo IS NOT NULL) DESC, juntos DESC, ruc_ganador LIMIT ${add(q.size)} OFFSET ${add((q.page - 1) * q.size)}`, vals),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM postor_acompanante ${donde}`, vals.slice(0, n)),
    ]);
    return publicar({ total: total.rows[0]?.n ?? 0, page: q.page, size: q.size, data: filas.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
