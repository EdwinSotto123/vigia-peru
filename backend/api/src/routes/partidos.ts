/**
 * Partidos políticos y contratos (migración 41).
 *
 * Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó: el gobierno
 * regional, la municipalidad provincial o la distrital la gobierna, en cada período (2015 a 2018,
 * 2019 a 2022, 2023 a 2026), quien ganó esa elección (JNE). Ver backend/db/migrations/41_aporte_por_partido.sql.
 *
 *   GET /partidos/periodos            los períodos y el que gobierna hoy
 *   GET /partidos/ranking?anio=2022   los partidos de ese período, con sus contratos, lo leído y lo que falta.
 *                                     Filtros y paginación (lib/rankingPartidos.ts): region, q, conCola, orden, limit, offset;
 *                                     responde también `total` (cuántos partidos cumplen, sin paginar)
 *   GET /partidos/:clave?anio=2022    un partido: totales, contratos por mes, sus entidades y sus regiones; y desde la
 *                                     migración 65, `historia` (sus procesos de CONOSCE: totales, por mes, por objeto) y
 *                                     `gobiernos`: TODOS los que ganó en el período, con sus procesos y contratos
 *   GET /partidos/:clave/procesos     todos sus procesos adjudicados del período (CONOSCE), paginados y filtrables:
 *                                     anio, nivel, region, ubigeo, q, objeto, orden (fecha|monto), page, size
 *
 * Lo que dice y lo que no: se asocia al GANADOR de la elección. Una vacancia, una revocatoria o un
 * reemplazo dentro del período no se registra. Una señal es para revisar, nunca una acusación: acá no
 * hay juicio sobre ningún partido, hay conteos de contratos de gobiernos que ganó.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { publicar } from "../lib/privacidad.js";
import { LECTURAS, casoLectura, lecturaSql } from "../lib/lectura.js";
import { Memo, responderJson, type Serializado } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { CONTEOS, RankingQuery, claveRanking, consultaGobiernos, consultaRanking } from "../lib/rankingPartidos.js";

export const partidosRouter = new Hono();

export const PERIODOS_GOBIERNO = [
  { anio: 2014, desde: "2015-01-01", hasta: "2018-12-31" },
  { anio: 2018, desde: "2019-01-01", hasta: "2022-12-31" },
  { anio: 2022, desde: "2023-01-01", hasta: "2026-12-31" },
] as const;

const Anio = z.coerce.number().int().refine((n) => PERIODOS_GOBIERNO.some((p) => p.anio === n), "período inválido");
const DetalleQuery = z.object({ anio: Anio.default(2022) });

const memo = new Memo<Serializado>({ nombre: "partidos:ranking", ttlMs: 60_000, staleMs: 60_000, max: 300 });
const detalleMemo = new Memo<Record<string, unknown> | null>({ nombre: "partidos:detalle", ttlMs: 60_000, staleMs: 60_000, max: 300 });

partidosRouter.get("/periodos", (c) => {
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600 }));
  const hoy = new Date().toISOString().slice(0, 10);
  return c.json({ data: PERIODOS_GOBIERNO.map((p) => ({ ...p, vigente: p.desde <= hoy && hoy <= p.hasta })) });
});

partidosRouter.get("/ranking", async (c) => {
  const parsed = RankingQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const p = parsed.data;
  return responderJson(c, memo, claveRanking(p), async () => {
    const lista = consultaRanking(p);
    const cuenta = consultaRanking(p, true);
    const [r, t] = await Promise.all([pool.query(lista.sql, lista.vals), pool.query<{ total: number }>(cuenta.sql, cuenta.vals)]);
    const claves = r.rows.map((x) => x.clave as string);
    const gobiernos = new Map<string, { regional: number; provincial: number; distrital: number }>();
    if (claves.length) {
      const g = consultaGobiernos(claves, p.anio, p.region);
      const gr = await pool.query<{ clave: string; nivel: string; n: number }>(g.sql, g.vals);
      for (const x of gr.rows) {
        const m = gobiernos.get(x.clave) ?? { regional: 0, provincial: 0, distrital: 0 };
        m[x.nivel as "regional"] = x.n;
        gobiernos.set(x.clave, m);
      }
    }
    const periodo = PERIODOS_GOBIERNO.find((x) => x.anio === p.anio)!;
    return {
      anio: p.anio, desde: periodo.desde, hasta: periodo.hasta,
      region: p.region ?? null, total: t.rows[0]?.total ?? 0, limit: p.limit ?? null, offset: p.offset ?? 0,
      data: r.rows.map((x) => ({ ...x, gobiernos: gobiernos.get(x.clave) ?? { regional: 0, provincial: 0, distrital: 0 } })),
    };
  }, cachePublico(300, { maxAge: 60, swr: 3600 }));
});

// ─── GET /partidos/:clave/procesos — todos sus procesos adjudicados del período (CONOSCE, migración 65) ─
const ProcesosQuery = z.object({
  anio: Anio.default(2022),
  nivel: z.enum(["regional", "provincial", "distrital"]).optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  q: z.string().trim().min(3).max(80).optional(),
  objeto: z.string().max(40).optional(),
  orden: z.enum(["fecha", "monto"]).default("fecha"),
  // Las mismas tres preguntas que la lista de contratos: sólo responden los procesos que están en la base de Vigía
  // (los que tienen ocid, ~la mitad; el resto no se leyó ni se cruzó).
  lectura: z.enum(LECTURAS).optional(),
  riesgo: z.enum(["alto", "medio", "bajo"]).optional(),
  cruces: z.string().max(40).regex(/^[a-z_]+$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
type PreguntaLectura = "lectura" | "riesgo" | "cruces";
const procesosMemo = new Memo<Record<string, unknown>>({ nombre: "partidos:procesos", ttlMs: 120_000, staleMs: 120_000, max: 500 });

partidosRouter.get("/:clave/procesos", async (c) => {
  const clave = c.req.param("clave");
  if (!/^[a-z0-9-]{1,80}$/.test(clave)) return c.json({ error: "not_found" }, 404);
  // Cadenas vacías de la URL ("?nivel=") son "sin filtro".
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = ProcesosQuery.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await procesosMemo.obtener(`procesos:${clave}:${JSON.stringify(q)}`, async () => {
    // Las condiciones con sus parámetros; `sin` deja fuera esas preguntas (para contar cada una sin su propio filtro).
    const armar = (sin: PreguntaLectura[] = []) => {
      const vals: unknown[] = [clave, q.anio];
      const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
      const conds = ["pp.org_clave = $1", "pp.anio_eleccion = $2"];
      if (q.nivel) conds.push(`pp.nivel = ${add(q.nivel)}`);
      if (q.region) conds.push(`left(pp.gobierno_ubigeo, 2) = ${add(q.region)}`);
      if (q.ubigeo) conds.push(`pp.gobierno_ubigeo = ${add(q.ubigeo)}`);
      if (q.objeto) conds.push(`pp.objeto = ${add(q.objeto)}`);
      if (q.q) {
        // Objeto, nomenclatura, entidad y ganador; el nombre de una persona natural (RUC 10) no se busca (como en casos_cruce).
        conds.push(`mef_norm(coalesce(pp.descripcion, '') || ' ' || coalesce(pp.nomenclatura, '') || ' ' || coalesce(pp.entidad, '') || ' ' ||
                    CASE WHEN pp.ruc_proveedor LIKE '10%' THEN '' ELSE coalesce(pp.proveedor, '') END) LIKE '%' || mef_norm(${add(q.q)}) || '%'`);
      }
      if (q.lectura && !sin.includes("lectura")) {
        conds.push(`EXISTS (SELECT 1 FROM contrato_estado ce WHERE ce.ocid = pp.ocid AND ${lecturaSql(q.lectura, "ce.")})`);
      }
      if (q.riesgo && !sin.includes("riesgo")) {
        conds.push(`EXISTS (SELECT 1 FROM contrato_estado ce WHERE ce.ocid = pp.ocid AND ce.riesgo = ${add(q.riesgo)})`);
      }
      if (q.cruces && !sin.includes("cruces")) {
        const k = q.cruces === "alta" ? " AND k.n_alta > 0" : q.cruces === "con" ? "" : ` AND ${add(q.cruces)} = ANY(k.tipos)`;
        conds.push(`EXISTS (SELECT 1 FROM casos_cruce k WHERE k.ocid = pp.ocid${k})`);
      }
      return { where: conds.join(" AND "), vals };
    };
    const { where, vals } = armar();
    // Conteos de los desplegables: lectura y riesgo son la misma pregunta (se cuentan sin las dos); antecedentes, sin el suyo.
    const fL = armar(["lectura", "riesgo"]);
    const fC = armar(["cruces"]);
    const orden = q.orden === "monto" ? "pp.monto_adjudicado_pen DESC NULLS LAST, pp.fecha_convocatoria DESC" : "pp.fecha_convocatoria DESC, pp.monto_adjudicado_pen DESC NULLS LAST";
    const [filas, total, lecturas, cruces] = await Promise.all([
      pool.query(
        `SELECT pp.codigo_convocatoria AS codigo, pp.nomenclatura, pp.descripcion, pp.objeto, pp.tipo_proceso AS "tipoProceso",
                to_char(pp.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, pp.entidad, pp.entidad_ruc AS "entidadRuc", pp.nivel,
                z.nombre AS lugar, pp.items, pp.monto_referencial::float AS "montoReferencial", pp.monto_adjudicado::float AS "montoAdjudicado",
                pp.moneda, pp.proveedores, pp.proveedor, pp.ruc_proveedor AS "rucProveedor", pp.ocid
           FROM partido_proceso pp LEFT JOIN zonas z ON z.ubigeo = pp.gobierno_ubigeo
          WHERE ${where} ORDER BY ${orden}, pp.codigo_convocatoria
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals),
      pool.query(`SELECT count(*)::int AS n, COALESCE(sum(pp.monto_adjudicado_pen), 0)::float AS monto FROM partido_proceso pp WHERE ${where}`, vals),
      pool.query(
        `SELECT ${casoLectura("ce.")} AS k, ce.riesgo, count(*)::int AS n
           FROM partido_proceso pp JOIN contrato_estado ce ON ce.ocid = pp.ocid
          WHERE ${fL.where} GROUP BY 1, 2`, fL.vals),
      // Los distintos por GROUP BY (hash), como el resumen de contratos.
      pool.query(
        `WITH k AS MATERIALIZED (SELECT k.ocid, k.n_alta, k.tipos FROM partido_proceso pp JOIN casos_cruce k ON k.ocid = pp.ocid WHERE ${fC.where}),
              o AS (SELECT k.ocid, bool_or(k.n_alta > 0) AS alta FROM k GROUP BY 1),
              t AS (SELECT x.t, count(*)::int AS n FROM (SELECT k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2) x GROUP BY 1)
         SELECT (SELECT count(*)::int FROM o) AS con, (SELECT count(*)::int FROM o WHERE alta) AS alta,
                (SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb) FROM t) AS tipos`, fC.vals),
    ]);
    const porLectura: Record<string, number> = {};
    const porRiesgo: Record<string, number> = {};
    for (const r of lecturas.rows) {
      porLectura[r.k] = (porLectura[r.k] ?? 0) + r.n;
      if (["alto", "medio", "bajo"].includes(r.riesgo)) porRiesgo[r.riesgo] = (porRiesgo[r.riesgo] ?? 0) + r.n;
    }
    // El ganador puede ser una persona natural: publicar() la reconoce por su RUC 10 y tapa su nombre.
    return publicar({
      total: total.rows[0].n, montoAdjudicadoPen: total.rows[0].monto, page: q.page, size: q.size, data: filas.rows,
      // Conteos de "¿Lo leyó Vigía?", "Riesgo" y "Antecedentes" (sólo los procesos que están en la base de Vigía).
      facetas: { porLectura, porRiesgo, porCruces: cruces.rows[0] },
    });
  });
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(cuerpo);
});

partidosRouter.get("/:clave", async (c) => {
  const clave = c.req.param("clave");
  if (!/^[a-z0-9-]{1,80}$/.test(clave)) return c.json({ error: "not_found" }, 404);
  const parsed = DetalleQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { anio } = parsed.data;
  const cuerpo = await detalleMemo.obtener(`detalle:${clave}:${anio}`, async () => {
    const [org, tot, meses, entidades, regiones, historia, historiaMes, historiaObjeto, gobiernos] = await Promise.all([
      pool.query(
        `SELECT org_clave AS clave, max(org_nombre) AS nombre, max(org_tipo) AS tipo,
                count(*) FILTER (WHERE nivel = 'regional')::int AS regional,
                count(*) FILTER (WHERE nivel = 'provincial')::int AS provincial,
                count(*) FILTER (WHERE nivel = 'distrital')::int AS distrital
           FROM gobierno_periodo WHERE org_clave = $1 AND anio_eleccion = $2 GROUP BY org_clave`, [clave, anio]),
      // Del resumen por región (migración 78), sumado: lo mismo que CONTEOS sobre contrato_partido × contrato_estado.
      pool.query(
        `SELECT COALESCE(sum(contratos), 0)::int AS contratos, COALESCE(sum(leidos), 0)::int AS leidos,
                COALESCE(sum(con_senales), 0)::int AS "conSenales", COALESCE(sum(en_cola), 0)::int AS "enCola",
                COALESCE(sum(documentos_listos), 0)::int AS "documentosListos", COALESCE(sum(monto_pen), 0)::float AS "montoPen"
           FROM partido_resumen_vigia WHERE org_clave = $1 AND anio_eleccion = $2`, [clave, anio]),
      // Mes a mes, ya calculado (migración 80).
      pool.query(
        `SELECT mes, contratos, leidos, con_senales AS "conSenales"
           FROM partido_resumen_mes WHERE org_clave = $1 AND anio_eleccion = $2 AND contratos > 0 ORDER BY mes`, [clave, anio]),
      pool.query(
        `SELECT e.ruc, e.nombre, cp.nivel, z.nombre AS lugar, cp.autoridad, ${CONTEOS}
           FROM contrato_partido cp
           JOIN contrato_estado ce ON ce.ocid = cp.ocid
           JOIN entidades e ON e.ruc = cp.entidad_ruc
           LEFT JOIN zonas z ON z.ubigeo = cp.gobierno_ubigeo
          WHERE cp.org_clave = $1 AND cp.anio_eleccion = $2
          GROUP BY e.ruc, e.nombre, cp.nivel, z.nombre, cp.autoridad
          ORDER BY count(*) DESC, e.nombre LIMIT 15`, [clave, anio]),
      pool.query(
        `SELECT left(cp.gobierno_ubigeo, 2) AS ubigeo, z.nombre, ${CONTEOS}
           FROM contrato_partido cp
           JOIN contrato_estado ce ON ce.ocid = cp.ocid
           LEFT JOIN zonas z ON z.ubigeo = left(cp.gobierno_ubigeo, 2)
          WHERE cp.org_clave = $1 AND cp.anio_eleccion = $2
          GROUP BY 1, 2 ORDER BY count(*) DESC`, [clave, anio]),
      // CONOSCE (migración 65): sus procesos adjudicados en el período, aunque no estén en la base de Vigía.
      // Ya calculados (migración 79): con count DISTINCT sobre las filas de partido_proceso tardaba 4,6 s en un partido
      // grande y las demás consultas se quedaban sin conexión. Siempre una fila (en cero si no tiene procesos).
      pool.query(
        `SELECT COALESCE(t.procesos, 0) AS procesos, COALESCE(t.monto_pen, 0)::float AS "montoAdjudicadoPen",
                COALESCE(t.entidades, 0) AS entidades, COALESCE(t.proveedores, 0) AS proveedores,
                COALESCE(t.gobiernos, 0) AS "gobiernosConProcesos",
                to_char(t.desde, 'YYYY-MM-DD') AS desde, to_char(t.hasta, 'YYYY-MM-DD') AS hasta
           FROM (SELECT 1) x LEFT JOIN partido_resumen_total t ON t.org_clave = $1 AND t.anio_eleccion = $2`, [clave, anio]),
      pool.query(
        `SELECT mes, procesos, monto_pen::float AS "montoAdjudicadoPen"
           FROM partido_resumen_mes WHERE org_clave = $1 AND anio_eleccion = $2 AND procesos > 0 ORDER BY mes`, [clave, anio]),
      pool.query(
        // Ya calculado (migración 81): contarlo de partido_proceso tardaba hasta 11 s en frío en un partido grande.
        `SELECT objeto, procesos, monto_pen::float AS "montoAdjudicadoPen"
           FROM partido_resumen_objeto WHERE org_clave = $1 AND anio_eleccion = $2 ORDER BY monto_pen DESC`, [clave, anio]),
      // TODOS sus gobiernos del período (antes, las 15 entidades con más contratos), con lo de las dos fuentes y la
      // entidad que abre cada uno: la de más procesos de ese gobierno (en un gobierno regional, casi siempre la sede).
      pool.query(
        // Sus procesos, contratos y entidad principal por gobierno, ya calculados (migración 81).
        `WITH g AS (SELECT nivel, ubigeo, autoridad FROM gobierno_periodo WHERE org_clave = $1 AND anio_eleccion = $2)
         SELECT g.nivel, g.ubigeo, g.autoridad, z.nombre AS lugar,
                CASE WHEN g.nivel = 'distrital' THEN (SELECT zp.nombre FROM zonas zp WHERE zp.ubigeo = left(g.ubigeo, 4)) END AS provincia,
                (SELECT zd.nombre FROM zonas zd WHERE zd.ubigeo = left(g.ubigeo, 2)) AS region,
                COALESCE(r.procesos, 0) AS procesos, COALESCE(r.monto_pen, 0)::float AS "montoAdjudicadoPen",
                COALESCE(r.contratos, 0) AS contratos, COALESCE(r.leidos, 0) AS leidos, COALESCE(r.con_senales, 0) AS "conSenales",
                COALESCE(r.ruc_principal, (SELECT eg.ruc FROM entidad_gobierno_amplia eg WHERE eg.nivel = g.nivel AND eg.ubigeo = g.ubigeo LIMIT 1)) AS ruc
           FROM g
           LEFT JOIN zonas z ON z.ubigeo = g.ubigeo
           LEFT JOIN partido_resumen_gobierno r ON r.org_clave = $1 AND r.anio_eleccion = $2 AND r.nivel = g.nivel AND r.ubigeo = g.ubigeo
          ORDER BY CASE g.nivel WHEN 'regional' THEN 0 WHEN 'provincial' THEN 1 ELSE 2 END, COALESCE(r.monto_pen, 0) DESC, z.nombre`,
        [clave, anio]),
    ]);
    if (!org.rows.length) return null;
    const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === anio)!;
    return {
      anio, desde: periodo.desde, hasta: periodo.hasta,
      partido: { clave: org.rows[0].clave, nombre: org.rows[0].nombre, tipo: org.rows[0].tipo,
                 gobiernos: { regional: org.rows[0].regional, provincial: org.rows[0].provincial, distrital: org.rows[0].distrital } },
      totales: tot.rows[0], porMes: meses.rows, entidades: entidades.rows, regiones: regiones.rows,
      historia: { ...historia.rows[0], porMes: historiaMes.rows, porObjeto: historiaObjeto.rows },
      gobiernos: gobiernos.rows,
    };
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(cuerpo);
});
