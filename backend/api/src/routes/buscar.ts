/**
 * Búsqueda global (⌘K / campo de la cabecera del dashboard).
 *
 *   GET /buscar?q=<texto>  → { q, contratos[], entidades[], zonas[], aportes[], alertas[], parcial } (LIMIT 5 cada grupo)
 *
 * Reconoce: OCID (1249514 / ocds-dgv273-seacev3-1249514), código de alerta (OECE-1249514),
 * código de aporte (VIG-2026-00004), RUC (11 dígitos), nombre de entidad, nombre de zona
 * y texto libre del objeto del contrato (tsvector `texto_busqueda`, con `pg_trgm`/`unaccent`
 * para los nombres — ver 01_extensions.sql).
 *
 * Fase 2 (auditoría C9): la rama de código es un UNION de ramas indexables — OCID exacto por PK,
 * prefijo de `upper(codigo)` y de `ocid_corto(ocid)` (índices text_pattern_ops de la migración 35),
 * cada una con tope — en vez de un OR con ILIKE que recorría convocatorias en cada tecla. Entidades
 * desde `entidad_stats` (contratos ya contados). Si un grupo falla, sale vacío y `parcial: true`
 * (antes el error se tragaba y parecía "sin resultados").
 */

import { Hono } from "hono";
import { OCID_CANDIDATOS, escaparLike, pool } from "../lib/db.js";
import { cachePublico } from "../lib/http.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { registrar } from "../lib/registro.js";
import { alertaPublica, convocatoriaNoDemo } from "../lib/publicacion.js";

export const buscarRouter = new Hono();

/**
 * Cuántos candidatos junta cada rama de prefijo antes de ordenar: un prefijo corto ("2026") puede traer
 * miles; la rama corta en el orden del índice y el exacto por PK siempre entra.
 */
const TOPE_RAMA = 100;

buscarRouter.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  c.header("Cache-Control", cachePublico(30, { swr: 60 }));
  if (q.length < 2) return c.json({ q, contratos: [], entidades: [], zonas: [], aportes: [], alertas: [], parcial: false });

  const like = `%${escaparLike(q.toLowerCase())}%`;
  const esCodigo = /^[\w.-]+$/.test(q) && /\d/.test(q);
  const esRuc = /^\d{11}$/.test(q);
  const esAporte = /^VIG-?\d{0,4}-?\d{0,5}$/i.test(q);
  const modelos = await hayModelosLectura();
  let parcial = false;
  const vacio = (grupo: string) => (e: unknown) => {
    parcial = true;
    registrar("WARNING", `[buscar] el grupo ${grupo} falló: ${(e as Error).message}`, { requestId: c.get("requestId") });
    return { rows: [] as any[] };
  };

  const COLS_CONTRATO = `c.ocid, c.codigo, c.objeto AS titulo, e.nombre AS entidad, c.cuantia_referencial::float AS "montoPen", z.nombre AS zona`;
  const [contratos, entidades, zonas, aportes, alertas] = await Promise.all([
    // Contratos: por código/OCID (exacto o prefijo) o por texto del objeto.
    esCodigo
      ? (modelos
        ? pool.query(
            `WITH cand AS (
               SELECT c.ocid FROM convocatorias c WHERE c.ocid = ANY(${OCID_CANDIDATOS("$1")}) AND ocid_corto(c.ocid) = ocid_corto($1)
               UNION (SELECT c.ocid FROM convocatorias c WHERE upper(c.codigo) LIKE $2 LIMIT ${TOPE_RAMA})
               UNION (SELECT c.ocid FROM convocatorias c WHERE ocid_corto(c.ocid) LIKE $3 LIMIT ${TOPE_RAMA}))
             SELECT ${COLS_CONTRATO}
               FROM cand JOIN convocatorias c ON c.ocid = cand.ocid
               LEFT JOIN entidades e ON e.ruc = c.entidad_ruc LEFT JOIN zonas z ON z.ubigeo = c.ubigeo_zona
              WHERE ${convocatoriaNoDemo("c")}
              ORDER BY (ocid_corto(c.ocid) = ocid_corto($1)) DESC, c.fecha_convocatoria DESC NULLS LAST, c.ocid LIMIT 5`,
            // ocid_corto() quita el prefijo "ocds-dgv273-seacev3-" (migración 12): el prefijo se arma igual acá.
            [q, `${escaparLike(q.toUpperCase())}%`, `${escaparLike(q.startsWith("ocds-dgv273-seacev3-") ? q.slice(20) : q)}%`])
        : pool.query(
            `SELECT ${COLS_CONTRATO}
               FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
               LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid LEFT JOIN zonas z ON z.ubigeo = cz.ubigeo::text
              WHERE (ocid_corto(c.ocid) = ocid_corto($1) OR c.codigo ILIKE $1 || '%' OR ocid_corto(c.ocid) LIKE ocid_corto($1) || '%')
                AND ${convocatoriaNoDemo("c")}
              ORDER BY (ocid_corto(c.ocid) = ocid_corto($1)) DESC, c.fecha_convocatoria DESC NULLS LAST LIMIT 5`, [q])
      ).catch(vacio("contratos"))
      : pool.query(
          `SELECT ${COLS_CONTRATO}
             FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
             LEFT JOIN zonas z ON z.ubigeo = ${modelos ? "c.ubigeo_zona" : "(SELECT cz.ubigeo::text FROM convocatoria_zona cz WHERE cz.ocid = c.ocid)"}
            WHERE c.texto_busqueda @@ websearch_to_tsquery('spanish', $1) AND ${convocatoriaNoDemo("c")}
            ORDER BY ts_rank(c.texto_busqueda, websearch_to_tsquery('spanish', $1)) DESC, c.fecha_convocatoria DESC NULLS LAST, c.ocid LIMIT 5`,
          [q]).catch(vacio("contratos")),
    // Entidades: RUC exacto o nombre (sin tildes), con sus contratos ya contados.
    (modelos
      ? pool.query(
          `SELECT es.ruc, es.nombre, es.tipo, es.region, es.contratos
             FROM entidad_stats es
            WHERE ($2::boolean AND es.ruc = $1) OR (NOT $2::boolean AND es.nombre_norm LIKE immutable_unaccent($3))
            ORDER BY es.contratos DESC, es.nombre, es.ruc LIMIT 5`, [q, esRuc, like])
      : pool.query(
          `SELECT e.ruc, e.nombre, e.tipo, e.region,
                  (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos
             FROM entidades e
            WHERE ($2::boolean AND e.ruc = $1) OR (NOT $2::boolean AND immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent($3))
            ORDER BY contratos DESC, e.nombre LIMIT 5`, [q, esRuc, like])
    ).catch(vacio("entidades")),
    // Zonas: departamentos primero, luego provincias/distritos con cola.
    pool.query(
      `SELECT z.ubigeo, z.nombre, z.nivel, COALESCE(ze.total_cola, 0)::int AS "totalCola", COALESCE(ze.financiados, 0)::int AS financiados
       FROM zonas z LEFT JOIN zona_estado ze ON ze.ubigeo = z.ubigeo
       WHERE immutable_unaccent(lower(z.nombre)) LIKE immutable_unaccent($1)
       ORDER BY CASE z.nivel WHEN 'departamento' THEN 0 WHEN 'provincia' THEN 1 ELSE 2 END, "totalCola" DESC, z.nombre LIMIT 5`,
      [like]).catch(vacio("zonas")),
    // Aportes (comprobantes públicos): solo por código.
    esAporte
      ? pool.query(
          `SELECT co.codigo, co.estado, co.contratos, z.nombre AS zona,
                  CASE WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo') ELSE 'Aliado no visible' END AS financiador
           FROM contribuciones co JOIN zonas z ON z.ubigeo = co.ubigeo JOIN financiadores f ON f.id = co.financiador_id
           WHERE co.codigo ILIKE $1 AND co.estado IN ('pagada','en_proceso','procesada','pendiente_pago')
           ORDER BY co.codigo DESC LIMIT 5`, [`${escaparLike(q.toUpperCase())}%`]).catch(vacio("aportes"))
      : Promise.resolve({ rows: [] as any[] }),
    // Alertas publicadas: por código o por OCID (solo activas/confirmadas, nunca las semillas `ALT-…`).
    esCodigo
      ? pool.query(
          `SELECT a.codigo, a.ocid, a.score, a.estado, a.objeto, a.region,
                  (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)::int AS banderas
           FROM alertas a
           WHERE ${alertaPublica("a")} AND (a.codigo ILIKE $2 OR (a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto($1)))
           ORDER BY a.analizado_en DESC NULLS LAST, a.id LIMIT 5`, [q, like]).catch(vacio("alertas"))
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  return c.json({ q, contratos: contratos.rows, entidades: entidades.rows, zonas: zonas.rows, aportes: aportes.rows, alertas: alertas.rows, parcial });
});
