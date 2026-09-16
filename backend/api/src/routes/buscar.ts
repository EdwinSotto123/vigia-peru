/**
 * Búsqueda global (⌘K / campo de la cabecera del dashboard).
 *
 *   GET /buscar?q=<texto>  → { q, contratos[], entidades[], zonas[], aportes[], alertas[] } (LIMIT 5 cada grupo)
 *
 * Reconoce: OCID (1249514 / ocds-dgv273-seacev3-1249514), código de alerta (OECE-1249514),
 * código de aporte (VIG-2026-00004), RUC (11 dígitos), nombre de entidad, nombre de zona
 * y texto libre del objeto del contrato (tsvector `texto_busqueda`, con `pg_trgm`/`unaccent`
 * para los nombres — ver 01_extensions.sql).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { pool } from "../lib/db.js";

export const buscarRouter = new Hono();

const cache = (c: Context, s: number) => c.header("Cache-Control", `public, s-maxage=${s}, stale-while-revalidate=60`);

buscarRouter.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return c.json({ q, contratos: [], entidades: [], zonas: [], aportes: [], alertas: [] });

  const like = `%${q.toLowerCase()}%`;
  const esCodigo = /^[\w.-]+$/.test(q) && /\d/.test(q);
  const esRuc = /^\d{11}$/.test(q);
  const esAporte = /^VIG-?\d{0,4}-?\d{0,5}$/i.test(q);

  const [contratos, entidades, zonas, aportes, alertas] = await Promise.all([
    // Contratos: por código/OCID exacto o por texto del objeto (+ nombre de entidad).
    pool.query(
      esCodigo
        ? `SELECT c.ocid, c.codigo, c.objeto AS titulo, e.nombre AS entidad, c.cuantia_referencial::float AS "montoPen", z.nombre AS zona
           FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
           LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid LEFT JOIN zonas z ON z.ubigeo = cz.ubigeo::text
           WHERE ocid_corto(c.ocid) = ocid_corto($1) OR c.codigo ILIKE $1 || '%' OR ocid_corto(c.ocid) LIKE ocid_corto($1) || '%'
           ORDER BY (ocid_corto(c.ocid) = ocid_corto($1)) DESC, c.fecha_convocatoria DESC NULLS LAST LIMIT 5`
        : `SELECT c.ocid, c.codigo, c.objeto AS titulo, e.nombre AS entidad, c.cuantia_referencial::float AS "montoPen", z.nombre AS zona
           FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
           LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid LEFT JOIN zonas z ON z.ubigeo = cz.ubigeo::text
           WHERE c.texto_busqueda @@ websearch_to_tsquery('spanish', $1)
           ORDER BY ts_rank(c.texto_busqueda, websearch_to_tsquery('spanish', $1)) DESC, c.fecha_convocatoria DESC NULLS LAST LIMIT 5`,
      [q]).catch(() => ({ rows: [] as any[] })),
    // Entidades: RUC exacto o nombre (sin tildes).
    pool.query(
      `SELECT e.ruc, e.nombre, e.tipo, e.region,
              (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc)::int AS contratos
       FROM entidades e
       WHERE ($2::boolean AND e.ruc = $1) OR (NOT $2::boolean AND immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent($3))
       ORDER BY contratos DESC, e.nombre LIMIT 5`, [q, esRuc, like]).catch(() => ({ rows: [] as any[] })),
    // Zonas: departamentos primero, luego provincias/distritos con cola.
    pool.query(
      `SELECT z.ubigeo, z.nombre, z.nivel, COALESCE(ze.total_cola, 0)::int AS "totalCola", COALESCE(ze.financiados, 0)::int AS financiados
       FROM zonas z LEFT JOIN zona_estado ze ON ze.ubigeo = z.ubigeo
       WHERE immutable_unaccent(lower(z.nombre)) LIKE immutable_unaccent($1)
       ORDER BY CASE z.nivel WHEN 'departamento' THEN 0 WHEN 'provincia' THEN 1 ELSE 2 END, "totalCola" DESC, z.nombre LIMIT 5`,
      [like]).catch(() => ({ rows: [] as any[] })),
    // Aportes (comprobantes públicos): solo por código.
    esAporte
      ? pool.query(
          `SELECT co.codigo, co.estado, co.contratos, z.nombre AS zona,
                  CASE WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo') ELSE 'Aliado no visible' END AS financiador
           FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo JOIN financiadores f ON f.id = co.financiador_id
           WHERE co.codigo ILIKE $1 || '%' AND co.estado IN ('pagada','en_proceso','procesada','pendiente_pago')
           ORDER BY co.codigo DESC LIMIT 5`, [q.toUpperCase()]).catch(() => ({ rows: [] as any[] }))
      : Promise.resolve({ rows: [] as any[] }),
    // Alertas publicadas: por código o por OCID (solo activas/confirmadas).
    esCodigo
      ? pool.query(
          `SELECT a.codigo, a.ocid, a.score, a.estado, a.objeto, a.region,
                  (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)::int AS banderas
           FROM alertas a
           WHERE alerta_publicada(a.estado) AND (a.codigo ILIKE '%' || $1 || '%' OR ocid_corto(a.ocid) = ocid_corto($1))
           ORDER BY a.analizado_en DESC NULLS LAST LIMIT 5`, [q]).catch(() => ({ rows: [] as any[] }))
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  cache(c, 30);
  return c.json({ q, contratos: contratos.rows, entidades: entidades.rows, zonas: zonas.rows, aportes: aportes.rows, alertas: alertas.rows });
});
