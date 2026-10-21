import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { PERIODOS_GOBIERNO } from "./partidos.js";

/**
 * Corrupción (migración 90, docs/CORRUPCION.md): lo que el Estado ya investigó o juzgó, para la sección "Casos de
 * corrupción" del Inicio de una entidad, una región y un partido. Dos fuentes que NUNCA se suman entre sí:
 *   · Contraloría: informes de control con responsabilidad PRESUNTA (penal, civil, administrativa). No son condenas.
 *   · Procuraduría Anticorrupción: casos por sede; "en ejecución de sentencia" = sentencia firme (lo comprobado).
 * Los títulos pasan por publicar(): pueden nombrar instituciones con nombre de persona. Los PDF (que sí nombran a los
 * funcionarios) se enlazan, no se copian. Se cargan una vez al mes: caché larga.
 */
export const corrupcionRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 600, swr: 86400 });
const ULTIMOS = 20;

/** Conteos por tipo de responsabilidad de un conjunto de informes (la condición va sobre `ic`). */
const CONTEOS = `count(*)::int AS total,
                 count(*) FILTER (WHERE 'penal' = ANY (ic.responsabilidades))::int AS penal,
                 count(*) FILTER (WHERE 'civil' = ANY (ic.responsabilidades))::int AS civil,
                 count(*) FILTER (WHERE ic.responsabilidades && ARRAY['administrativa_entidad', 'administrativa_pas'])::int AS administrativa,
                 COALESCE(sum(ic.funcionarios), 0)::int AS funcionarios,
                 to_char(min(COALESCE(ic.fecha_emision, ic.fecha_publicacion)), 'YYYY-MM-DD') AS desde,
                 to_char(max(COALESCE(ic.fecha_emision, ic.fecha_publicacion)), 'YYYY-MM-DD') AS hasta`;

const FILA = `ic.numero, ic.titulo, to_char(COALESCE(ic.fecha_emision, ic.fecha_publicacion), 'YYYY-MM-DD') AS fecha,
              ic.responsabilidades, ic.funcionarios, ic.url_pdf AS "urlPdf", ic.entidad_nombre AS entidad, ic.entidad_ruc AS "entidadRuc"`;
const ORDEN = `COALESCE(ic.fecha_emision, ic.fecha_publicacion) DESC NULLS LAST, ic.codigo DESC`;

/** Lo de la Procuraduría para un departamento (el último corte), o null. */
async function procuraduria(ubigeo2: string | null) {
  if (!ubigeo2) return null;
  const r = await pool.query(`SELECT corrupcion_resumen_region($1) -> 'procuraduria' AS p`, [ubigeo2]);
  return r.rows[0]?.p ?? null;
}

// ─── GET /corrupcion/entidad/:ruc ───────────────────────────────────────────────────────────────
corrupcionRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const [conteos, ultimos, ent] = await Promise.all([
    pool.query(`SELECT ${CONTEOS} FROM informes_control ic WHERE ic.entidad_ruc = $1`, [ruc]),
    pool.query(`SELECT ${FILA} FROM informes_control ic WHERE ic.entidad_ruc = $1 ORDER BY ${ORDEN} LIMIT ${ULTIMOS}`, [ruc]),
    pool.query(`SELECT left(ubigeo, 2) AS dep FROM entidades WHERE ruc = $1`, [ruc]),
  ]);
  const dep = ent.rows[0]?.dep ?? null;
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ informes: { ...conteos.rows[0], ultimos: ultimos.rows }, departamento: dep, procuraduria: await procuraduria(dep) }));
});

// ─── GET /corrupcion/region/:ubigeo (departamento: los 2 primeros dígitos) ─────────────────────
corrupcionRouter.get("/region/:ubigeo", async (c) => {
  const u = c.req.param("ubigeo");
  if (!/^\d{2}(\d{2}(\d{2})?)?$/.test(u)) return c.json({ error: "not_found" }, 404);
  const dep = u.slice(0, 2);
  const [conteos, ultimos] = await Promise.all([
    pool.query(`SELECT ${CONTEOS}, count(DISTINCT ic.entidad_ruc)::int AS entidades FROM informes_control ic WHERE ic.ubigeo LIKE $1`, [`${u}%`]),
    pool.query(`SELECT ${FILA} FROM informes_control ic WHERE ic.ubigeo LIKE $1 ORDER BY ${ORDEN} LIMIT ${ULTIMOS}`, [`${u}%`]),
  ]);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ informes: { ...conteos.rows[0], ultimos: ultimos.rows }, departamento: dep, procuraduria: await procuraduria(dep) }));
});

// ─── GET /corrupcion/partido/:clave?anio= ──────────────────────────────────────────────────────
// Informes de control de las entidades que el partido gobernó, emitidos durante ese mandato. No los atribuye a sus
// autoridades: la Contraloría no lo dice en el buscador (el PDF nombra a cada funcionario, de carrera o de confianza).
corrupcionRouter.get("/partido/:clave", async (c) => {
  const clave = c.req.param("clave");
  if (!/^[a-z0-9-]{1,80}$/.test(clave)) return c.json({ error: "not_found" }, 404);
  const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === Number(c.req.query("anio") ?? 2022)) ?? PERIODOS_GOBIERNO[2];
  const deLas = `ic.entidad_ruc IN (SELECT DISTINCT pp.entidad_ruc FROM partido_proceso pp WHERE pp.org_clave = $1 AND pp.anio_eleccion = $2)
                 AND COALESCE(ic.fecha_emision, ic.fecha_publicacion) BETWEEN $3::date AND $4::date`;
  const vals = [clave, periodo.anio, periodo.desde, periodo.hasta];
  const [conteos, ultimos] = await Promise.all([
    pool.query(`SELECT ${CONTEOS}, count(DISTINCT ic.entidad_ruc)::int AS entidades FROM informes_control ic WHERE ${deLas}`, vals),
    pool.query(`SELECT ${FILA} FROM informes_control ic WHERE ${deLas} ORDER BY ${ORDEN} LIMIT ${ULTIMOS}`, vals),
  ]);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ anio: periodo.anio, desde: periodo.desde, hasta: periodo.hasta, informes: { ...conteos.rows[0], ultimos: ultimos.rows } }));
});
