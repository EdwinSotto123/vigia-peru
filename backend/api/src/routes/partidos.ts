/**
 * Partidos políticos y contratos (migración 41).
 *
 * Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó: el gobierno
 * regional, la municipalidad provincial o la distrital la gobierna, en cada período (2015 a 2018,
 * 2019 a 2022, 2023 a 2026), quien ganó esa elección (JNE). Ver backend/db/migrations/41_aporte_por_partido.sql.
 *
 *   GET /partidos/periodos            los períodos y el que gobierna hoy
 *   GET /partidos/ranking?anio=2022   los partidos de ese período, con sus contratos, lo leído y lo que falta
 *   GET /partidos/:clave?anio=2022    un partido: totales, contratos por mes, sus entidades y sus regiones
 *
 * Lo que dice y lo que no: se asocia al GANADOR de la elección. Una vacancia, una revocatoria o un
 * reemplazo dentro del período no se registra. Una señal es para revisar, nunca una acusación: acá no
 * hay juicio sobre ningún partido, hay conteos de contratos de gobiernos que ganó.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo, responderJson, type Serializado } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";

export const partidosRouter = new Hono();

export const PERIODOS_GOBIERNO = [
  { anio: 2014, desde: "2015-01-01", hasta: "2018-12-31" },
  { anio: 2018, desde: "2019-01-01", hasta: "2022-12-31" },
  { anio: 2022, desde: "2023-01-01", hasta: "2026-12-31" },
] as const;

const Anio = z.coerce.number().int().refine((n) => PERIODOS_GOBIERNO.some((p) => p.anio === n), "período inválido");
const RankingQuery = z.object({ anio: Anio.default(2022) });
const DetalleQuery = z.object({ anio: Anio.default(2022) });

const memo = new Memo<Serializado>({ nombre: "partidos:ranking", ttlMs: 60_000, staleMs: 60_000, max: 10 });
const detalleMemo = new Memo<Record<string, unknown> | null>({ nombre: "partidos:detalle", ttlMs: 60_000, staleMs: 60_000, max: 300 });

/** Los mismos conteos que `/contratos/geo`: leído = procesado; señal = riesgo alto o medio; en cola = sin analizar y en cola. */
const CONTEOS = `count(*)::int AS contratos,
  count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int AS leidos,
  count(*) FILTER (WHERE ce.riesgo IN ('alto','medio'))::int AS "conSenales",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'en_cola')::int AS "enCola",
  count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'documentos_listos')::int AS "documentosListos",
  COALESCE(sum(ce.monto), 0)::float AS "montoPen"`;

partidosRouter.get("/periodos", (c) => {
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600 }));
  const hoy = new Date().toISOString().slice(0, 10);
  return c.json({ data: PERIODOS_GOBIERNO.map((p) => ({ ...p, vigente: p.desde <= hoy && hoy <= p.hasta })) });
});

partidosRouter.get("/ranking", async (c) => {
  const parsed = RankingQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { anio } = parsed.data;
  return responderJson(c, memo, `ranking:${anio}`, async () => {
    const r = await pool.query(
      `SELECT cp.org_clave AS clave, max(cp.org_nombre) AS nombre, max(cp.org_tipo) AS tipo,
              count(DISTINCT cp.nivel || ':' || cp.gobierno_ubigeo)::int AS "gobiernosConContratos",
              ${CONTEOS}
         FROM contrato_partido cp
         JOIN contrato_estado ce ON ce.ocid = cp.ocid
        WHERE cp.anio_eleccion = $1
        GROUP BY cp.org_clave
        ORDER BY count(*) DESC, cp.org_clave`, [anio]);
    const g = await pool.query<{ clave: string; nivel: string; n: number }>(
      `SELECT org_clave AS clave, nivel, count(*)::int AS n FROM gobierno_periodo WHERE anio_eleccion = $1 GROUP BY 1, 2`, [anio]);
    const gobiernos = new Map<string, { regional: number; provincial: number; distrital: number }>();
    for (const x of g.rows) {
      const m = gobiernos.get(x.clave) ?? { regional: 0, provincial: 0, distrital: 0 };
      m[x.nivel as "regional"] = x.n;
      gobiernos.set(x.clave, m);
    }
    const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === anio)!;
    return {
      anio, desde: periodo.desde, hasta: periodo.hasta,
      data: r.rows.map((x) => ({ ...x, gobiernos: gobiernos.get(x.clave) ?? { regional: 0, provincial: 0, distrital: 0 } })),
    };
  }, cachePublico(120, { maxAge: 60, swr: 60 }));
});

partidosRouter.get("/:clave", async (c) => {
  const clave = c.req.param("clave");
  if (!/^[a-z0-9-]{1,80}$/.test(clave)) return c.json({ error: "not_found" }, 404);
  const parsed = DetalleQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { anio } = parsed.data;
  const cuerpo = await detalleMemo.obtener(`detalle:${clave}:${anio}`, async () => {
    const [org, tot, meses, entidades, regiones] = await Promise.all([
      pool.query(
        `SELECT org_clave AS clave, max(org_nombre) AS nombre, max(org_tipo) AS tipo,
                count(*) FILTER (WHERE nivel = 'regional')::int AS regional,
                count(*) FILTER (WHERE nivel = 'provincial')::int AS provincial,
                count(*) FILTER (WHERE nivel = 'distrital')::int AS distrital
           FROM gobierno_periodo WHERE org_clave = $1 AND anio_eleccion = $2 GROUP BY org_clave`, [clave, anio]),
      pool.query(
        `SELECT ${CONTEOS} FROM contrato_partido cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
          WHERE cp.org_clave = $1 AND cp.anio_eleccion = $2`, [clave, anio]),
      pool.query(
        `SELECT to_char(date_trunc('month', cp.fecha_convocatoria), 'YYYY-MM') AS mes,
                count(*)::int AS contratos,
                count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int AS leidos,
                count(*) FILTER (WHERE ce.riesgo IN ('alto','medio'))::int AS "conSenales"
           FROM contrato_partido cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
          WHERE cp.org_clave = $1 AND cp.anio_eleccion = $2
          GROUP BY 1 ORDER BY 1`, [clave, anio]),
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
    ]);
    if (!org.rows.length) return null;
    const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === anio)!;
    return {
      anio, desde: periodo.desde, hasta: periodo.hasta,
      partido: { clave: org.rows[0].clave, nombre: org.rows[0].nombre, tipo: org.rows[0].tipo,
                 gobiernos: { regional: org.rows[0].regional, provincial: org.rows[0].provincial, distrital: org.rows[0].distrital } },
      totales: tot.rows[0], porMes: meses.rows, entidades: entidades.rows, regiones: regiones.rows,
    };
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json(cuerpo);
});
