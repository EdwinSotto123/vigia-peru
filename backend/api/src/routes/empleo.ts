import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";
import { PARTES_FORMACION, SUGERIDOS_SQL, clavePuesto, condicionesCalce, leerCarreras, puestoDeTitulo } from "../lib/calceEmpleo.js";
import { huellaPlaza, resumirPlaza, textoPlaza, type PlazaParaResumen } from "../lib/resumenPlaza.js";
import { procesarBases, relayDe, type ResultadoBases } from "../lib/basesPlaza.js";
import { TOPE_HAIKU_DIA, TOPE_LECTURAS_DIA, guardarBases, guardarError, haikuHoy, leidasHoy } from "../lib/empleoRecolector.js";
import { limiteLectura } from "../lib/antibots.js";
import { registrar } from "../lib/registro.js";

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
 *   GET /empleo/calce     la app (onboarding y «Para ti»): con las palabras del perfil, cuántas plazas calzan con cada
 *                         una y con alguna, y la página de las que calzan.
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
/** Los niveles de estudio que alguien puede tener, de menor a mayor («sin_dato» es de la plaza, no de la persona). */
const NIVELES_PERSONA = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado"] as const;
/** «tengo título» → las plazas que piden secundaria, técnica, egresado, bachiller o título: el suyo y los de abajo. */
const nivelesHasta = (n: (typeof NIVELES_PERSONA)[number]) => NIVELES_PERSONA.slice(0, NIVELES_PERSONA.indexOf(n) + 1);
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
  /** Los estudios de quien busca: las plazas cuyo nivel mínimo es el suyo o uno menor (las alertas y «Tus estudios»). */
  tengo: z.enum(NIVELES_PERSONA).optional(),
  sueldo: z.coerce.number().int().min(0).max(100000).optional(),
  exp: z.coerce.number().min(0).max(30).optional(),
  cierra: z.enum(["hoy", "2dias", "semana"]).optional(),
  senal: z.enum(SENALES).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  /**
   * El perfil de la app, como en /empleo/calce: carreras (grupos «|», variantes «;») y puestos («|»). Sólo lo usan las
   * alertas de «Mi perfil» y su CSV (filasPlazas): calzan como en «Para ti», no como texto suelto.
   */
  carreras: z.string().max(600).optional(),
  palabras: z.string().max(600).optional(),
  /** «calce»: las más afines primero (sólo con `carreras` o `palabras`; sin ellas, como «cierre»). */
  orden: z.enum(["cierre", "sueldo", "reciente", "vacantes", "calce"]).default("cierre"),
  page: z.coerce.number().int().min(1).max(300).default(1),
  size: z.coerce.number().int().min(1).max(30).default(12),
});
const ORDEN = {
  cierre: `"fechaFin", remuneracion DESC NULLS LAST, aviso DESC`,
  sueldo: `remuneracion DESC NULLS LAST, "fechaFin", aviso DESC`,
  reciente: `"fechaInicio" DESC NULLS LAST, aviso DESC`,
  vacantes: `vacantes DESC NULLS LAST, "fechaFin", aviso DESC`,
} as const;

type FiltrosPlazas = z.infer<typeof Lista>;

/**
 * Las condiciones de una búsqueda de plazas (las usan la lista, las alertas y el CSV de lib/gobservaAlertas.ts). La
 * región y el nivel se calculan en la consulta: van aparte (`rc`, `nc`) para filtrar sobre la base ya armada. Con
 * `nuevasDesde`, sólo las plazas que aparecieron (o abrieron) después de ese momento: lo nuevo para una alerta.
 */
function condicionesPlazas(q: FiltrosPlazas, nuevasDesde?: Date) {
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
  if (nuevasDesde) { vals.push(nuevasDesde.toISOString()); conds.push(`GREATEST(s.primera_vez, s.fecha_inicio::timestamptz) > $${vals.length}::timestamptz`); }
  vals.push(q.region ? q.region.replace(/-/g, " ").toUpperCase() : null);
  const rc = `($${vals.length}::text IS NULL OR region = $${vals.length})`;
  vals.push(q.nivel ?? null);
  let nc = `($${vals.length}::text IS NULL OR nivel = $${vals.length})`;
  if (q.tengo) {
    vals.push([...nivelesHasta(q.tengo)]);
    nc = `(${nc} AND nivel = ANY($${vals.length}::text[]))`;
  }
  return { conds, vals, rc, nc };
}

/** Los filtros de una alerta o de una descarga, validados como los de la lista (lo que no sirve, se descarta). */
export function filtrosPlazas(f: Record<string, unknown>): FiltrosPlazas | null {
  const p = Lista.safeParse(Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== "" && v != null && k !== "page" && k !== "size")));
  return p.success ? p.data : null;
}

/** Los puestos de un perfil («|»), sin repetir y hasta 10 (como /empleo/calce). */
const puestosDe = (t: string | undefined) => [...new Set((t ?? "").split("|").map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 10);

/**
 * Las plazas de una búsqueda, hasta `limite` (para alertas y CSV): las columnas de la lista, ya publicables. Con el
 * perfil de la app (`carreras`, `palabras`), sólo las que calzan con él y las más afines primero (lib/calceEmpleo.ts):
 * una alerta de Arquitectura no avisa «Analista en arquitectura Java», que pide Ingeniería de sistemas.
 */
export async function filasPlazas(q: FiltrosPlazas, limite: number, nuevasDesde?: Date): Promise<Record<string, unknown>[]> {
  const { conds, vals, rc, nc } = condicionesPlazas(q, nuevasDesde);
  const orden = nuevasDesde ? ORDEN.reciente : ORDEN[q.orden === "calce" ? "cierre" : q.orden];
  const tope = Math.max(1, Math.min(5000, Math.floor(limite)));
  const carreras = leerCarreras(q.carreras);
  const puestos = puestosDe(q.palabras);
  if (!carreras.length && !puestos.length) {
    const r = await pool.query(
      `WITH base AS MATERIALIZED (SELECT ${FILA} ${DESDE} WHERE ${conds.join(" AND ")})
       SELECT * FROM base WHERE ${rc} AND ${nc} ORDER BY ${orden} LIMIT ${tope}`,
      vals,
    );
    return publicar(r.rows) as Record<string, unknown>[];
  }
  const k = condicionesCalce({ carreras, puestos, otros: [] }, vals);
  const r = await pool.query(
    `WITH base AS MATERIALIZED (SELECT ${FILA}, mef_norm(s.formacion) AS fo, mef_norm(s.titulo) AS ti, ${PARTES_FORMACION} AS es
                                  ${DESDE} WHERE ${conds.join(" AND ")})
     SELECT * FROM (SELECT base.*, ${k.puntaje} AS puntaje FROM base WHERE ${rc} AND ${nc} AND ${k.calza}) cz
      ORDER BY puntaje DESC, ${orden} LIMIT ${tope}`,
    vals,
  );
  return publicar(r.rows.map(({ fo: _f, ti: _t, es: _e, puntaje: _p, ...d }) => d)) as Record<string, unknown>[];
}

empleoRouter.get("/plazas", async (c) => {
  const p = Lista.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`plazas:${JSON.stringify(q)}`, async () => {
    const { conds, vals, rc, nc } = condicionesPlazas(q);
    // «Para ti» es un filtro de la lista (2026-11-08, el usuario: «Para ti no tiene sentido, puede ser un botón de
    // filtro»): con la carrera y los puestos del perfil, sólo las plazas que calzan (lib/calceEmpleo.ts), las más afines
    // primero con «calce», y el porqué de cada una (`motivo`), como en /empleo/calce.
    const carreras = leerCarreras(q.carreras);
    const puestos = puestosDe(q.palabras);
    const k = carreras.length || puestos.length ? condicionesCalce({ carreras, puestos, otros: [] }, vals) : null;
    const orden = q.orden === "calce" ? (k ? `puntaje DESC, ${ORDEN.cierre}` : ORDEN.cierre) : ORDEN[q.orden];
    const base = k
      ? `base0 AS MATERIALIZED (SELECT ${FILA}, mef_norm(s.formacion) AS fo, mef_norm(s.titulo) AS ti, ${PARTES_FORMACION} AS es
                                ${DESDE} WHERE ${conds.join(" AND ")}),
         base AS MATERIALIZED (SELECT base0.*, ${k.puntaje} AS puntaje, ${k.motivo} FROM base0 WHERE ${k.calza})`
      : `base AS MATERIALIZED (SELECT ${FILA} ${DESDE} WHERE ${conds.join(" AND ")})`;
    const r = await pool.query(
      `WITH ${base}
       SELECT (SELECT count(*) FROM base WHERE ${rc} AND ${nc})::int AS total,
              (SELECT COALESCE(sum(vacantes), 0) FROM base WHERE ${rc} AND ${nc})::int AS vacantes,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) FROM base WHERE ${rc} AND ${nc} AND remuneracion > 0)::float AS "medianaSueldo",
              COALESCE((SELECT json_agg(f ORDER BY f.n DESC, f.clave) FROM (SELECT region AS clave, count(*)::int AS n FROM base WHERE region IS NOT NULL AND ${nc} GROUP BY 1) f), '[]') AS "porRegion",
              COALESCE((SELECT json_agg(f ORDER BY f.n DESC) FROM (SELECT nivel AS clave, count(*)::int AS n FROM base WHERE ${rc} GROUP BY 1) f), '[]') AS "porNivel",
              COALESCE((SELECT json_agg(d ORDER BY d.pos) FROM (
                SELECT b.*, row_number() OVER (ORDER BY ${orden}) AS pos FROM base b WHERE ${rc} AND ${nc}
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
      data: f.data.map(({ pos: _p, fo: _f, ti: _t, es: _e, puntaje: _s, mc, mp, ...d }) =>
        k
          ? {
              ...d,
              motivo: {
                carreras: carreras.filter((_, i) => (mc as boolean[] | null)?.[i]).map((v) => v[0]),
                puestos: puestos.filter((_, i) => (mp as boolean[] | null)?.[i]),
              },
            }
          : d,
      ),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empleo/calce ───────────────────────────────────────────────────────────────────────────
const Calce = z.object({
  /** Carreras: grupos por «|», variantes por «;» («arquitectura;arquitecto|ingeniería civil»). */
  carreras: z.string().max(600).optional(),
  /** Puestos del perfil, por «|». */
  palabras: z.string().max(600).optional(),
  /** Puestos sugeridos que sólo se cuentan. */
  otras: z.string().max(600).optional(),
  /** Sólo las que tienen este puesto en el título (el filtro de «Para ti»). */
  puesto: z.string().trim().max(40).optional(),
  /** Carreras que sólo se cuentan (las fichas de la entrevista), con el mismo formato que `carreras`. */
  contar: z.string().max(1500).optional(),
  /** «1»: también los puestos para sugerir (los títulos reales de las plazas de tu carrera). */
  sugerir: z.enum(["1"]).optional(),
  region: Lista.shape.region,
  tengo: Lista.shape.tengo,
  sueldo: Lista.shape.sueldo,
  exp: Lista.shape.exp,
  orden: z.enum(["calce", "cierre", "sueldo", "reciente"]).catch("calce").default("calce"),
  page: z.coerce.number().int().min(1).max(100).catch(1).default(1),
  size: z.coerce.number().int().min(1).max(30).catch(3).default(3),
});

/**
 * La app de Empleo (2026-11-08): la entrevista y «Para ti». Con la carrera (que se busca en la FORMACIÓN que pide la
 * plaza), los puestos (en el TÍTULO, como palabra entera) y los filtros (región, estudios, sueldo mínimo, experiencia),
 * cuántas plazas abiertas calzan, cuántas con cada carrera y con cada puesto, y la página de las que calzan: primero las
 * que piden su carrera y tienen uno de sus puestos, después por cierre (lib/calceEmpleo.ts). UNA consulta por respuesta.
 */
empleoRouter.get("/calce", async (c) => {
  const p = Calce.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const q = p.data;
  const separar = (t: string | undefined) => (t ?? "").split("|").map((x) => x.trim().slice(0, 40)).filter(Boolean);
  const carreras = leerCarreras(q.carreras);
  const puestos = puestosDe(q.palabras);
  const otros = [...new Set(separar(q.otras))].filter((w) => !puestos.includes(w)).slice(0, 12);
  const contar = leerCarreras(q.contar, 20);
  const cuerpo = await memo.obtener(`calce2:${JSON.stringify([q, carreras, puestos, otros, contar])}`, async () => {
    if (!carreras.length && !puestos.length && !otros.length && !contar.length && !q.sugerir)
      return { total: 0, porCarrera: [], otrasCarreras: [], porPalabra: [], sugeridos: [], page: q.page, size: q.size, data: [] };
    const filtros: FiltrosPlazas = { region: q.region, tengo: q.tengo, sueldo: q.sueldo, exp: q.exp, orden: "cierre", page: 1, size: 12 };
    const { conds, vals, rc, nc } = condicionesPlazas(filtros);
    const k = condicionesCalce({ carreras, puestos, otros }, vals);
    const kc = condicionesCalce({ carreras: contar, puestos: [], otros: [] }, vals);
    const solo = q.puesto ? condicionesCalce({ carreras: [], puestos: [], otros: [q.puesto] }, vals).porPuesto[0] : null;
    const deCarrera = k.carrera ?? "true";
    const orden = q.orden === "calce" ? `puntaje DESC, ${ORDEN.cierre}` : ORDEN[q.orden];
    const r = await pool.query(
      `WITH base AS MATERIALIZED (SELECT ${FILA}, mef_norm(s.formacion) AS fo, mef_norm(s.titulo) AS ti, ${PARTES_FORMACION} AS es
                                    ${DESDE} WHERE ${conds.join(" AND ")}),
            b AS MATERIALIZED (SELECT * FROM base WHERE ${rc} AND ${nc}),
            cz AS MATERIALIZED (SELECT b.*, ${k.puntaje} AS puntaje, ${k.motivo} FROM b WHERE ${k.calza}${solo ? ` AND (${solo})` : ""})
       SELECT (SELECT count(*) FROM cz)::int AS total,
              ${k.porCarrera.map((x, i) => `(SELECT count(*) FROM b WHERE ${x})::int AS c${i}`).concat("0 AS c_").join(", ")},
              ${kc.porCarrera.map((x, i) => `(SELECT count(*) FROM b WHERE ${x})::int AS o${i}`).concat("0 AS o_").join(", ")},
              ${k.porPuesto.map((x, i) => `(SELECT count(*) FROM b WHERE (${deCarrera}) AND ${x})::int AS p${i}`).concat("0 AS p_").join(", ")},
              ${q.sugerir ? `(SELECT COALESCE(json_agg(g), '[]') FROM (${SUGERIDOS_SQL(`b WHERE ${deCarrera}`)}) g)` : `'[]'::json`} AS sugeridos,
              COALESCE((SELECT json_agg(d ORDER BY d.pos) FROM (
                SELECT cz.*, row_number() OVER (ORDER BY ${orden}) AS pos FROM cz
                 ORDER BY pos LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}) d), '[]') AS data`,
      vals,
    );
    const f = r.rows[0] as Record<string, unknown> & { total: number; data: Record<string, unknown>[]; sugeridos: { t: string; n: number }[] };
    // Los sugeridos como puestos legibles, sin repetir («enfermera» y «enfermero» son uno) ni los que ya tienes.
    const vistos = new Set(puestos.map(clavePuesto));
    const sugeridos: { puesto: string; n: number }[] = [];
    for (const g of f.sugeridos ?? []) {
      const puesto = puestoDeTitulo(g.t);
      const clave = clavePuesto(puesto);
      if (puesto.length < 4 || !clave || vistos.has(clave)) continue;
      vistos.add(clave);
      sugeridos.push({ puesto, n: g.n });
    }
    return publicar({
      total: f.total,
      porCarrera: carreras.map((variantes, i) => ({ variantes, n: (f[`c${i}`] as number) ?? 0 })),
      otrasCarreras: contar.map((variantes, i) => ({ variantes, n: (f[`o${i}`] as number) ?? 0 })),
      porPalabra: [...puestos, ...otros].map((palabra, i) => ({ palabra, n: (f[`p${i}`] as number) ?? 0 })),
      sugeridos: sugeridos.slice(0, 10),
      page: q.page,
      size: q.size,
      // Por qué calza cada una: las carreras (su primera variante) y los puestos tuyos que tiene.
      data: f.data.map(({ pos: _p, fo: _f, ti: _t, es: _e, puntaje: _s, mc, mp, ...d }) => ({
        ...d,
        motivo: {
          carreras: carreras.filter((_, i) => (mc as boolean[] | null)?.[i]).map((v) => v[0]),
          puestos: puestos.filter((_, i) => (mp as boolean[] | null)?.[i]),
        },
      })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /empleo/plazas/:aviso/resumen ───────────────────────────────────────────────────────────

/**
 * «Lo esencial» de una plaza (migración 270, lib/resumenPlaza.ts): el guardado si la plaza no cambió; si no, Haiku lo
 * arma (sólo para plazas abiertas: las cerradas casi no se miran) y queda guardado. Con el límite de lecturas por IP.
 */
const generando = new Map<number, Promise<unknown>>();
empleoRouter.get("/plazas/:aviso/resumen", limiteLectura, async (c) => {
  const aviso = Number.parseInt(c.req.param("aviso"), 10);
  if (!Number.isInteger(aviso) || aviso <= 0) return c.json({ error: "no_encontrado" }, 404);
  const fila = (await pool.query<PlazaParaResumen & { abierta: boolean }>(
    `SELECT aviso, titulo, entidad, ubicacion, numero, vacantes, remuneracion::float AS remuneracion, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
            experiencia, formacion, especializacion, conocimiento, competencias, (fecha_fin >= ${HOY}) AS abierta
       FROM servir_convocatoria WHERE aviso = $1`, [aviso])).rows[0];
  if (!fila) return c.json({ error: "no_encontrado" }, 404);
  const huella = huellaPlaza(fila);
  const guardado = (await pool.query<{ resumen: unknown; huella: string }>(`SELECT resumen, huella FROM servir_resumen WHERE aviso = $1`, [aviso])).rows[0];
  c.header("Cache-Control", "public, max-age=600, s-maxage=3600");
  if (guardado && (guardado.huella === huella || !fila.abierta)) return c.json({ aviso, resumen: guardado.resumen });
  if (!fila.abierta) return c.json({ error: "cerrada", detail: "Esta plaza ya cerró." }, 404);
  // Dos pedidos a la vez de la misma plaza esperan el mismo resumen (no se paga dos veces).
  let tarea = generando.get(aviso);
  if (!tarea) {
    tarea = resumirPlaza(c.env as Parameters<typeof resumirPlaza>[0], fila)
      .then(async (resumen) => {
        await pool.query(
          `INSERT INTO servir_resumen (aviso, huella, resumen, modelo) VALUES ($1, $2, $3::jsonb, 'claude-haiku-5-5')
           ON CONFLICT (aviso) DO UPDATE SET huella = EXCLUDED.huella, resumen = EXCLUDED.resumen, modelo = EXCLUDED.modelo, creado_at = now()`,
          [aviso, huella, JSON.stringify(resumen)]);
        return resumen;
      })
      .finally(() => generando.delete(aviso));
    generando.set(aviso, tarea);
  }
  try {
    return c.json({ aviso, resumen: await tarea });
  } catch (e) {
    registrar("WARNING", `[empleo] sin resumen de la plaza ${aviso}: ${(e as Error).message.slice(0, 80)}`);
    c.header("Cache-Control", "no-store");
    return c.json({ error: "sin_resumen", detail: "No pudimos armar el resumen ahora." }, 503);
  }
});

// ─── GET /empleo/plazas/:aviso/bases ─────────────────────────────────────────────────────────────

/**
 * Las bases de la plaza, buscadas en la web de la entidad y leídas por Haiku (lib/basesPlaza.ts, columnas `bases*` de
 * servir_resumen). Lo guardado vale: con lectura, siempre; encontradas sin lectura, 6 horas; no encontradas, 3 días;
 * error, 2 horas. Sólo se buscan para plazas abiertas. Dos pedidos a la vez de la misma plaza esperan la misma búsqueda.
 */
const buscandoBases = new Map<number, Promise<ResultadoBases>>();
empleoRouter.get("/plazas/:aviso/bases", limiteLectura, async (c) => {
  const aviso = Number.parseInt(c.req.param("aviso"), 10);
  if (!Number.isInteger(aviso) || aviso <= 0) return c.json({ error: "no_encontrado" }, 404);
  const fila = (await pool.query<PlazaParaResumen & { detalle_url: string | null; fecha_inicio: string | null; abierta: boolean }>(
    `SELECT aviso, titulo, entidad, ubicacion, numero, vacantes, remuneracion::float AS remuneracion, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
            to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, detalle_url,
            experiencia, formacion, especializacion, conocimiento, competencias, (fecha_fin >= ${HOY}) AS abierta
       FROM servir_convocatoria WHERE aviso = $1`, [aviso])).rows[0];
  if (!fila) return c.json({ error: "no_encontrado" }, 404);
  const guardado = (await pool.query<{ bases: Omit<ResultadoBases, "estado"> | null; bases_estado: string; bases_at: string; vigente: boolean }>(
    `SELECT bases, bases_estado, bases_at,
            CASE WHEN bases_estado = 'encontradas' AND jsonb_typeof(bases->'lectura') = 'object' THEN true
                 WHEN bases_estado = 'encontradas' THEN bases_at > now() - interval '6 hours'
                 WHEN bases_estado = 'no_encontradas' THEN bases_at > now() - interval '3 days'
                 WHEN bases_estado = 'error' THEN bases_at > now() - interval '2 hours'
                 ELSE false END AS vigente
       FROM servir_resumen WHERE aviso = $1 AND bases_estado IS NOT NULL`, [aviso])).rows[0];
  const responder = (estado: string, b: Partial<ResultadoBases> | null, buscado: string | null) =>
    c.json({
      aviso,
      estado,
      pagina: b?.pagina ?? null,
      documentos: (b?.documentos ?? []).map((d) => ({ titulo: d.titulo, url: d.url, copia: d.clave ? `/empleo/bases/${d.clave}` : null, leido: !!d.leido })),
      lectura: b?.lectura ?? null,
      sin_lectura: b?.sin_lectura ?? null,
      buscado_at: buscado,
    });
  if (guardado && (guardado.vigente || !fila.abierta)) {
    c.header("Cache-Control", "public, max-age=600, s-maxage=3600");
    return responder(guardado.bases_estado, guardado.bases, guardado.bases_at);
  }
  if (!fila.abierta) {
    c.header("Cache-Control", "public, max-age=600, s-maxage=3600");
    return responder("cerrada", null, null);
  }
  let tarea = buscandoBases.get(aviso);
  if (!tarea) {
    tarea = (async () => {
      const [leidas, haiku] = await Promise.all([leidasHoy(), haikuHoy()]);
      const r = await procesarBases(c.env as Parameters<typeof procesarBases>[0], { ...fila, datosServir: textoPlaza(fila) }, {
        puedeLeer: leidas < TOPE_LECTURAS_DIA,
        // Las escaneadas: Haiku, si alguien abrió la ficha y queda tope del día.
        puedeHaiku: haiku < TOPE_HAIKU_DIA,
        relay: relayDe(c.env as Parameters<typeof relayDe>[0]),
      });
      if (r.tokens) registrar("INFO", `[empleo] bases de la plaza ${aviso}: ${r.estado} (${r.modelo ?? "sin modelo"}), ${r.tokens.entrada} tokens de entrada y ${r.tokens.salida} de salida`);
      // servir_resumen y, además, la fuente, los documentos y los eventos (lib/empleoRecolector.ts, migración 271).
      await guardarBases(fila, r);
      return r;
    })().finally(() => buscandoBases.delete(aviso));
    buscandoBases.set(aviso, tarea);
  }
  try {
    const r = await tarea;
    c.header("Cache-Control", r.lectura || r.estado === "no_encontradas" ? "public, max-age=600, s-maxage=3600" : "no-store");
    return responder(r.estado, r, new Date().toISOString());
  } catch (e) {
    registrar("WARNING", `[empleo] sin bases de la plaza ${aviso}: ${(e as Error).message.slice(0, 120)}`);
    await guardarError(fila, (e as Error).message).catch(() => undefined);
    c.header("Cache-Control", "no-store");
    return c.json({ error: "sin_bases", detail: "No pudimos buscar las bases ahora." }, 503);
  }
});

// ─── GET /empleo/practicas y /empleo/practicas/:id (migración 271) ───────────────────────────────
/**
 * Las prácticas preprofesionales y profesionales de Talento Perú (servir_practica, src/fuentes/servir_practicas.ts del
 * Worker de scrapers): la lista con filtros (texto, región, modalidad) y la ficha. El id es corto y estable: los 16
 * primeros hex del md5 de la clave (entidad + número + año + título + unidad). La subvención menor a S/ 300 es un error de
 * tipeo de la entidad (se publicó «S/ 001.00»): sale como sin dato.
 */
const MODALIDADES_PRACTICA = ["practica_pre", "practica_pro"] as const;
const ListaPracticas = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  region: z.string().regex(/^[a-z-]{3,30}$/).optional(),
  modalidad: z.enum(MODALIDADES_PRACTICA).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
const REGION_PRACTICA = `NULLIF(mef_norm(split_part(p.ubicacion, ' - ', 1)), '')`;
const FILA_PRACTICA = `left(md5(p.clave), 16) AS id, p.titulo, p.entidad, p.modalidad, p.tipo_modalidad AS "tipoModalidad", p.ubicacion,
  ${REGION_PRACTICA} AS region, p.numero, p.vacantes, CASE WHEN p.subvencion >= 300 THEN p.subvencion::float END AS subvencion,
  p.duracion_meses AS "duracionMeses", p.jornada_horas::float AS "jornadaHoras", to_char(p.fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio",
  to_char(p.fecha_fin, 'YYYY-MM-DD') AS "fechaFin", p.unidad_organica AS "unidadOrganica", p.requerimientos`;
const PRACTICA_ABIERTA = `p.fecha_fin >= ${HOY}`;

empleoRouter.get("/practicas", async (c) => {
  const p = ListaPracticas.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!p.success) return c.json({ error: "invalid_query", issues: p.error.issues }, 400);
  const f = p.data;
  const cuerpo = await memo.obtener(`practicas:${JSON.stringify(f)}`, async () => {
    const vals: unknown[] = [];
    const poner = (v: unknown) => {
      vals.push(v);
      return `$${vals.length}`;
    };
    const texto = f.q
      ? `mef_norm(concat_ws(' ', p.titulo, p.entidad, p.unidad_organica, p.requerimientos::text)) LIKE '%' || mef_norm(${poner(f.q)}) || '%'`
      : "true";
    const region = f.region ? `p.reg = mef_norm(replace(${poner(f.region)}, '-', ' '))` : "true";
    const modalidad = f.modalidad ? `p.modalidad = ${poner(f.modalidad)}` : "true";
    const r = await pool.query(
      `WITH base AS MATERIALIZED (SELECT p.*, ${REGION_PRACTICA} AS reg FROM servir_practica p WHERE ${PRACTICA_ABIERTA} AND ${texto}),
            pagina AS (
              SELECT ${FILA_PRACTICA}, count(*) OVER () AS total FROM base p
               WHERE ${region} AND ${modalidad}
               ORDER BY p.fecha_fin, p.subvencion DESC NULLS LAST, p.clave
               LIMIT ${poner(f.size)} OFFSET ${poner((f.page - 1) * f.size)})
       SELECT COALESCE((SELECT json_agg(x) FROM pagina x), '[]') AS data,
              COALESCE((SELECT max(total) FROM pagina), 0)::int AS total,
              COALESCE((SELECT json_agg(m ORDER BY m.n DESC) FROM (SELECT p.modalidad AS clave, count(*)::int AS n FROM base p WHERE ${region} GROUP BY 1) m), '[]') AS "porModalidad",
              COALESCE((SELECT json_agg(g ORDER BY g.n DESC, g.clave) FROM (SELECT p.reg AS clave, count(*)::int AS n FROM base p WHERE ${modalidad} AND p.reg IS NOT NULL GROUP BY 1) g), '[]') AS "porRegion",
              (SELECT to_char(max(ultima_vez) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD"T"HH24:MI') FROM servir_practica) AS actualizado`,
      vals,
    );
    const fila = r.rows[0] as { data: Record<string, unknown>[]; total: number };
    return publicar({ ...fila, data: fila.data.map(({ total: _t, ...x }) => x), page: f.page, size: f.size });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

empleoRouter.get("/practicas/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: "no_encontrado" }, 404);
  const r = await pool.query(
    `SELECT ${FILA_PRACTICA}, p.direccion, p.actividades, p.conocimientos, p.beneficios, p.cronograma, p.correo, p.web,
            p.detalle_url AS "detalleUrl", (${PRACTICA_ABIERTA}) AS abierta
       FROM servir_practica p WHERE left(md5(p.clave), 16) = $1`, [id]);
  if (!r.rows[0]) return c.json({ error: "no_encontrado" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(publicar(r.rows[0]));
});

// ─── GET /empleo/bases/:clave: la copia que guardamos del PDF (R2) ───────────────────────────────
type BucketLectura = { get(key: string): Promise<{ body: ReadableStream | null } | null> };
empleoRouter.get("/bases/:clave", limiteLectura, async (c) => {
  const clave = c.req.param("clave");
  if (!/^[0-9a-f]{24}$/.test(clave)) return c.json({ error: "no_encontrado" }, 404);
  const bucket = (c.env as { DOCUMENTOS?: BucketLectura } | undefined)?.DOCUMENTOS;
  const obj = bucket ? await bucket.get(`servir/bases/${clave}.pdf`) : null;
  if (!obj?.body) return c.json({ error: "no_encontrado" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bases-${clave.slice(0, 8)}.pdf"`,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
