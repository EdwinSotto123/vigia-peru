import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * empleo.gobserva.cloud (Gobserva Empleo, 2026-11-01): las plazas CAS que el Estado publica en SERVIR
 * (servir_convocatoria, migración 93), ordenadas para quien busca trabajo. Sólo las que se pueden postular hoy (en Lima):
 * ya empezó su plazo y no terminó.
 *
 *   GET /empleo/resumen   la portada: cuántas hay abiertas, vacantes, sueldo mediano, cuántas cierran pronto, por región,
 *                         por nivel de estudios, por señal de Vigía, las entidades que más convocan, las que cierran
 *                         primero y las mejor pagadas.
 *   GET /empleo/plazas    la lista con filtros (texto, región, nivel de estudios, sueldo mínimo, años de experiencia,
 *                         cierre, señal) y sus facetas: cuántas hay en cada región y en cada nivel con los demás filtros.
 *   GET /empleo/sitemap   los avisos abiertos (para el sitemap del producto).
 *
 * La región sale de `ubicacion` («DEPARTAMENTO - PROVINCIA»): llega en mayúsculas sin tildes (mef_norm) y la URL la pide
 * en minúsculas con guiones («la-libertad»). El nivel de estudios se lee de `formacion` (texto libre): el MÁS BAJO que la
 * plaza acepta (secundaria, técnica, egresado o estudiante, bachiller, título, posgrado), o «sin_dato». La ficha de una
 * plaza es GET /plazas/:aviso (routes/planilla.ts).
 *
 * Sin datos personales: un aviso de SERVIR no los tiene; las señales salen sólo con su tipo.
 */
export const empleoRouter = new Hono();

const CACHE = cachePublico(900, { maxAge: 300, swr: 3600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "empleo", ttlMs: 600_000, staleMs: 1_800_000, max: 300 });

const HOY = `(now() AT TIME ZONE 'America/Lima')::date`;
const ABIERTA = `s.fecha_fin >= ${HOY} AND (s.fecha_inicio IS NULL OR s.fecha_inicio <= ${HOY})`;
const REGION = `NULLIF(mef_norm(split_part(s.ubicacion, ' - ', 1)), '')`;
/** El nivel MÁS BAJO que acepta la plaza: se busca de menor a mayor en su formación (fz.f = mef_norm(s.formacion)). */
const NIVEL = `CASE
  WHEN fz.f ~ '(SECUNDARIA|PRIMARIA)' THEN 'secundaria'
  WHEN fz.f ~ '(TECNIC|INSTITUTO|CETPRO)' THEN 'tecnica'
  WHEN fz.f ~ '(ESTUDIANTE|EGRESAD|ESTUDIOS UNIVERSITARIOS|UNIVERSITARIO INCOMPLETO)' THEN 'egresado'
  WHEN fz.f ~ 'BACHILLER' THEN 'bachiller'
  WHEN fz.f ~ '(TITULO|TITULAD|LICENCIAD|COLEGIA|PROFESIONAL|MEDICO|ABOGAD|INGENIER|CONTADOR|ENFERMER|OBSTETR|PSICOLOG|ARQUITECT|ECONOMISTA|NUTRICIONIST|ODONTOLOG|QUIMICO|BIOLOG)' THEN 'titulo'
  WHEN fz.f ~ '(MAESTR|MAGISTER|DOCTOR)' THEN 'posgrado'
  ELSE 'sin_dato' END`;
export const NIVELES_EMPLEO = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado", "sin_dato"] as const;
const SENALES = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "ya_hay_locadores", "gestion_saliente"] as const;

/** Las columnas de una plaza en la lista y en la portada (la ficha entera es GET /plazas/:aviso). */
const FILA = `s.aviso, s.titulo, s.entidad, s.entidad_ruc AS "entidadRuc", s.ubicacion, ${REGION} AS region, ${NIVEL} AS nivel,
  s.vacantes, s.remuneracion::float AS remuneracion, to_char(s.fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio",
  to_char(s.fecha_fin, 'YYYY-MM-DD') AS "fechaFin", s.exp_general::float AS "expGeneral", left(s.formacion, 240) AS formacion,
  (fz.f ~ 'COLEGIA') AS colegiatura, s.tipos, s.n_senales AS "nSenales"`;
const DESDE = `FROM servir_convocatoria s CROSS JOIN LATERAL (SELECT mef_norm(s.formacion) AS f) fz`;

// ─── GET /empleo/resumen ─────────────────────────────────────────────────────────────────────────
empleoRouter.get("/resumen", async (c) => {
  const cuerpo = await memo.obtener("resumen", async () => {
    const r = await pool.query(
      `WITH x AS MATERIALIZED (SELECT ${FILA}, s.ultima_vez ${DESDE} WHERE ${ABIERTA})
       SELECT (SELECT count(*) FROM x)::int AS abiertas,
              (SELECT COALESCE(sum(vacantes), 0) FROM x)::int AS vacantes,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) FROM x WHERE remuneracion > 0)::float AS "medianaSueldo",
              (SELECT count(*) FROM x WHERE "fechaFin"::date = ${HOY})::int AS "cierranHoy",
              (SELECT count(*) FROM x WHERE "fechaFin"::date <= ${HOY} + 2)::int AS "cierran2dias",
              (SELECT count(*) FROM x WHERE "fechaFin"::date <= ${HOY} + 7)::int AS "cierranSemana",
              (SELECT count(*) FROM x WHERE "fechaInicio"::date >= ${HOY} - 2)::int AS nuevas,
              (SELECT count(*) FROM x WHERE "expGeneral" <= 1)::int AS "hasta1Anio",
              (SELECT count(*) FROM x WHERE remuneracion >= 5000)::int AS "mas5000",
              (SELECT count(*) FROM x WHERE nivel IN ('secundaria', 'tecnica'))::int AS "sinUniversidad",
              (SELECT count(*) FROM x WHERE "nSenales" > 0)::int AS "conSenales",
              (SELECT count(DISTINCT COALESCE("entidadRuc", entidad)) FROM x)::int AS entidades,
              COALESCE((SELECT json_agg(r ORDER BY r.n DESC, r.clave) FROM (SELECT region AS clave, count(*)::int AS n, COALESCE(sum(vacantes), 0)::int AS vacantes,
                                    percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion)::float AS mediana
                                    FROM x WHERE region IS NOT NULL GROUP BY 1) r), '[]') AS "porRegion",
              COALESCE((SELECT json_agg(r ORDER BY r.n DESC) FROM (SELECT nivel AS clave, count(*)::int AS n,
                                    percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion)::float AS mediana FROM x GROUP BY 1) r), '[]') AS "porNivel",
              COALESCE((SELECT json_agg(r ORDER BY r.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM x, unnest(x.tipos) t GROUP BY 1) r), '[]') AS "porSenal",
              COALESCE((SELECT json_agg(r ORDER BY r.n DESC, r.entidad) FROM (SELECT entidad, "entidadRuc" AS ruc, count(*)::int AS n, COALESCE(sum(vacantes), 0)::int AS vacantes
                                    FROM x GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 8) r), '[]') AS entidades_top,
              COALESCE((SELECT json_agg(r ORDER BY r.pos) FROM (SELECT x.*, row_number() OVER (ORDER BY "fechaFin", remuneracion DESC NULLS LAST, aviso DESC) AS pos
                                    FROM x ORDER BY pos LIMIT 6) r), '[]') AS "cierranPronto",
              COALESCE((SELECT json_agg(r ORDER BY r.pos) FROM (SELECT x.*, row_number() OVER (ORDER BY remuneracion DESC NULLS LAST, "fechaFin", aviso DESC) AS pos
                                    FROM x ORDER BY pos LIMIT 6) r), '[]') AS "mejorPagadas",
              (SELECT to_char(max(ultima_vez) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD"T"HH24:MI') FROM servir_convocatoria) AS actualizado`,
    );
    const fila = r.rows[0] as Record<string, unknown>;
    const { entidades_top: entidadesTop, ...resto } = fila;
    // Sin la columna de orden (pos) ni la fecha de captura en cada plaza.
    const limpiar = (lista: unknown) => (Array.isArray(lista) ? lista.map(({ pos: _p, ultima_vez: _u, ...p }) => p) : []);
    return publicar({ ...resto, entidadesTop, cierranPronto: limpiar(fila.cierranPronto), mejorPagadas: limpiar(fila.mejorPagadas) });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empleo/plazas ──────────────────────────────────────────────────────────────────────────
const Lista = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  region: z.string().regex(/^[a-z-]{3,30}$/).optional(),
  nivel: z.enum(NIVELES_EMPLEO).optional(),
  sueldo: z.coerce.number().int().min(0).max(100000).optional(),
  exp: z.coerce.number().min(0).max(30).optional(),
  cierra: z.enum(["hoy", "2dias", "semana"]).optional(),
  senal: z.enum(SENALES).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  orden: z.enum(["cierre", "sueldo", "reciente", "vacantes"]).default("cierre"),
  page: z.coerce.number().int().min(1).max(300).default(1),
  size: z.coerce.number().int().min(1).max(30).default(12),
});
const ORDEN = {
  cierre: `"fechaFin", remuneracion DESC NULLS LAST, aviso DESC`,
  sueldo: `remuneracion DESC NULLS LAST, "fechaFin", aviso DESC`,
  reciente: `"fechaInicio" DESC NULLS LAST, aviso DESC`,
  vacantes: `vacantes DESC NULLS LAST, "fechaFin", aviso DESC`,
} as const;

empleoRouter.get("/plazas", async (c) => {
  const p = Lista.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`plazas:${JSON.stringify(q)}`, async () => {
    const conds = [ABIERTA];
    const vals: unknown[] = [];
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(concat_ws(' ', s.titulo, s.entidad, s.ubicacion, s.servicio, s.formacion)) LIKE $${vals.length}`);
    }
    if (q.sueldo) { vals.push(q.sueldo); conds.push(`s.remuneracion >= $${vals.length}`); }
    if (q.exp != null) { vals.push(q.exp); conds.push(`s.exp_general <= $${vals.length}`); }
    if (q.cierra) conds.push(q.cierra === "hoy" ? `s.fecha_fin = ${HOY}` : q.cierra === "2dias" ? `s.fecha_fin <= ${HOY} + 2` : `s.fecha_fin <= ${HOY} + 7`);
    if (q.senal) { vals.push([q.senal]); conds.push(`s.tipos @> $${vals.length}::text[]`); }
    if (q.entidad) { vals.push(q.entidad); conds.push(`s.entidad_ruc = $${vals.length}`); }
    vals.push(q.region ? q.region.replace(/-/g, " ").toUpperCase() : null);
    const rc = `($${vals.length}::text IS NULL OR region = $${vals.length})`;
    vals.push(q.nivel ?? null);
    const nc = `($${vals.length}::text IS NULL OR nivel = $${vals.length})`;
    const r = await pool.query(
      `WITH base AS MATERIALIZED (SELECT ${FILA} ${DESDE} WHERE ${conds.join(" AND ")})
       SELECT (SELECT count(*) FROM base WHERE ${rc} AND ${nc})::int AS total,
              (SELECT COALESCE(sum(vacantes), 0) FROM base WHERE ${rc} AND ${nc})::int AS vacantes,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) FROM base WHERE ${rc} AND ${nc} AND remuneracion > 0)::float AS "medianaSueldo",
              COALESCE((SELECT json_agg(f ORDER BY f.n DESC, f.clave) FROM (SELECT region AS clave, count(*)::int AS n FROM base WHERE region IS NOT NULL AND ${nc} GROUP BY 1) f), '[]') AS "porRegion",
              COALESCE((SELECT json_agg(f ORDER BY f.n DESC) FROM (SELECT nivel AS clave, count(*)::int AS n FROM base WHERE ${rc} GROUP BY 1) f), '[]') AS "porNivel",
              COALESCE((SELECT json_agg(d ORDER BY d.pos) FROM (
                SELECT b.*, row_number() OVER (ORDER BY ${ORDEN[q.orden]}) AS pos FROM base b WHERE ${rc} AND ${nc}
                 ORDER BY pos LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}) d), '[]') AS data`,
      vals,
    );
    const f = r.rows[0] as { total: number; vacantes: number; medianaSueldo: number | null; porRegion: unknown[]; porNivel: unknown[]; data: Record<string, unknown>[] };
    return publicar({
      total: f.total,
      page: q.page,
      size: q.size,
      vacantes: f.vacantes,
      medianaSueldo: f.medianaSueldo,
      facetas: { region: f.porRegion, nivel: f.porNivel },
      data: f.data.map(({ pos: _p, ...d }) => d),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empleo/sitemap ─────────────────────────────────────────────────────────────────────────
empleoRouter.get("/sitemap", async (c) => {
  const cuerpo = await memo.obtener("sitemap", async () => {
    const r = await pool.query(
      `SELECT s.aviso, to_char(COALESCE(s.fecha_inicio, s.primera_vez::date), 'YYYY-MM-DD') AS fecha
         FROM servir_convocatoria s WHERE ${ABIERTA} ORDER BY s.fecha_inicio DESC NULLS LAST, s.aviso DESC LIMIT 5000`,
    );
    return { data: r.rows };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
