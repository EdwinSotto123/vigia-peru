import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * Planilla (migración 92) y plazas CAS (migración 93).
 *
 *   GET /planilla[?entidad=|dep=] el personal que la entidad publica en su Portal de Transparencia, con sus señales
 *                                 (también recibe órdenes, gana el doble que su cargo, apellidos de una autoridad o de un
 *                                 directivo, candidato del que gobierna, fue locador antes). Paginado, con su resumen.
 *   GET /plazas[?entidad=|dep=]   las plazas CAS que publicó en SERVIR, con sus señales (pide experiencia en la propia
 *                                 entidad, paga mucho y pide poco, plazo corto, sueldo alto, ya hay locadores).
 *
 * Privacidad (docs/PRIVACIDAD.md): el PTE no trae DNI. El nombre sale con el apellido materno tapado acá mismo (no
 * lleva RUC 10 para que publicar() la reconozca); publicar() tapa además a quienes nombran las señales.
 */
export const planillaRouter = new Hono();
export const plazasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "planilla", ttlMs: 600_000, staleMs: 600_000, max: 400 });

export const TIPOS_PLANILLA = ["tambien_ordenes", "candidato_gobierna", "brecha_cargo", "apellidos_autoridad", "apellidos_directivo", "antes_locador", "pago_extraordinario"] as const;
export const TIPOS_PLAZA = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "sueldo_alto", "ya_hay_locadores"] as const;
const SEV: Record<string, number> = { alta: 3, media: 2, baja: 1 };

const Alcance = {
  entidad: z.string().regex(/^\d{11}$/).optional(),
  dep: z.string().regex(/^\d{2}$/).optional(),
  severidad: z.enum(["alta", "media", "baja", "con", "sin"]).optional(),
  // El buscador (migraciones 103 y 105): nombre (paterno y nombres), cargo, dependencia y entidad en la planilla; título,
  // entidad y lugar en las plazas.
  q: z.string().trim().min(2).max(80).optional(),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  size: z.coerce.number().int().min(0).max(50).default(20),
};

const leer = <T extends z.ZodRawShape>(c: Parameters<typeof parametros>[0], forma: T) =>
  z.object(forma).safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));

function sevCond(s: string | undefined, conds: string[], vals: unknown[], t: string) {
  if (s === "con") conds.push(`${t}.n_senales > 0`);
  else if (s === "sin") conds.push(`${t}.n_senales = 0`);
  else if (s) { vals.push(SEV[s]); conds.push(`${t}.sev = $${vals.length}`); }
}

// ─── GET /planilla ──────────────────────────────────────────────────────────────────────────────
const ListaPlanilla = {
  ...Alcance,
  senal: z.enum(TIPOS_PLANILLA).optional(),
  regimen: z.coerce.number().int().min(1).max(9).optional(),
  // Sólo las filas con un posible error de carga del Estado (migración 102).
  dudoso: z.enum(["si"]).optional(),
  orden: z.enum(["senales", "sueldo", "meses"]).default("senales"),
};

/** Las expresiones indexadas de planilla_persona: cargo, oficina y entidad (migración 103); paterno y nombres (105). */
const TEXTO_PLANILLA = `mef_norm(COALESCE(p.cargo, '') || ' ' || COALESCE(p.dependencia, '') || ' ' || COALESCE(p.entidad, ''))`;
// Servidores públicos: el PTE publica su nombre. Nunca el materno, que la API tapa (buscarlo diría quién lo lleva).
const NOMBRE_PLANILLA = `mef_norm(COALESCE(p.paterno, '') || ' ' || COALESCE(p.nombres, ''))`;
// "sueldo" ordena por el sueldo base (migración 98): el total del mes trae liquidaciones y retiros.
const ORDEN_PLANILLA = { senales: "p.sev DESC, p.n_senales DESC, p.base DESC NULLS LAST", sueldo: "p.base DESC NULLS LAST", meses: "p.meses DESC, p.base DESC NULLS LAST" };

planillaRouter.get("/", async (c) => {
  const parsed = leer(c, ListaPlanilla);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(`planilla:${JSON.stringify(q)}`, async () => {
    const alc: string[] = ["TRUE"];
    const vals: unknown[] = [];
    if (q.entidad) { vals.push(q.entidad); alc.push(`p.entidad_ruc = $${vals.length}`); }
    if (q.dep) { vals.push(q.dep); alc.push(`p.dep = $${vals.length}`); }
    const donde = `WHERE ${alc.join(" AND ")}`;
    // Un alcance simple (país, región o entidad) ya viene contado en planilla_resumen (migración 92).
    const clave = q.entidad && q.dep ? null : q.entidad ? `ent:${q.entidad}` : q.dep ? `dep:${q.dep}` : "pais";
    const resumenP = clave
      ? pool.query(`SELECT r.resumen AS j FROM planilla_resumen r WHERE r.alcance = $1`, [clave])
          .then((r) => ({ rows: [r.rows[0]?.j ?? { personas: 0, totalMes: 0, conSenales: 0, alta: 0, media: 0, ultimoMes: null, porSenal: [], porRegimen: [] }] }))
      : pool.query(
      `WITH s AS MATERIALIZED (SELECT p.total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes FROM planilla_persona p ${donde})
       SELECT (SELECT count(*) FROM s)::int AS personas,
              (SELECT COALESCE(sum(total), 0) FROM s)::float AS "totalMes",
              (SELECT count(*) FROM s WHERE n_senales > 0)::int AS "conSenales",
              (SELECT count(*) FROM s WHERE sev = 3)::int AS alta,
              (SELECT count(*) FROM s WHERE sev = 2)::int AS media,
              (SELECT to_char(max(ultimo_mes), 'YYYY-MM') FROM s) AS "ultimoMes",
              COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM s, unnest(s.tipos) t GROUP BY t) x), '[]') AS "porSenal",
              COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT regimen, count(*)::int AS n FROM s GROUP BY regimen) x), '[]') AS "porRegimen"`,
      vals);
    if (q.size === 0) return publicar({ total: 0, page: 1, size: 0, data: [], resumen: (await resumenP).rows[0] });
    const conds = [...alc];
    const v2 = [...vals];
    if (q.senal) { v2.push([q.senal]); conds.push(`p.tipos @> $${v2.length}::text[]`); }
    if (q.regimen) { v2.push(q.regimen); conds.push(`p.regimen = $${v2.length}`); }
    if (q.dudoso) conds.push(`p.dudoso IS NOT NULL`);
    for (const w of palabrasBusqueda(q.q)) { v2.push(`%${w}%`); conds.push(`(${NOMBRE_PLANILLA} LIKE $${v2.length} OR ${TEXTO_PLANILLA} LIKE $${v2.length})`); }
    sevCond(q.severidad, conds, v2, "p");
    const [filas, res] = await Promise.all([
      pool.query(
        `SELECT p.entidad_ruc AS "entidadRuc", p.entidad, p.paterno, p.nombres, p.regimen, p.cargo, p.dependencia, p.total::float AS total,
                p.base::float AS base, p.extra::float AS extra, p.dudoso,
                p.meses, to_char(p.primer_mes, 'YYYY-MM') AS "primerMes", to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes",
                p.senales, p.n_senales AS "nSenales", p.codigo, p.nombre_norm AS "_nn", count(*) OVER ()::int AS n
           FROM planilla_persona p WHERE ${conds.join(" AND ")}
          ORDER BY ${ORDEN_PLANILLA[q.orden]}, p.nombre_norm
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, v2),
      resumenP,
    ]);
    // Lo que cobró cada mes cargado (línea de tiempo de sueldos): así se ve si un monto raro es de un solo mes (un pago
    // acumulado, un error de carga) o su sueldo de siempre. Una consulta para las filas de la página, por el índice del
    // nombre; nombre_norm (con el materno) nunca sale de la API.
    const historia = new Map<string, unknown[]>();
    if (filas.rows.length) {
      const h = await pool.query<{ e: string; nn: string; mes: string; base: number | null; extra: number; total: number | null; dudoso: boolean; filas: number }>(
        `SELECT p.entidad_ruc AS e, p.nombre_norm AS nn, to_char(make_date(p.anio, p.mes, 1), 'YYYY-MM') AS mes,
                sum(CASE WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
                         WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END)::float AS base,
                sum(COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0))::float AS extra,
                sum(p.total)::float AS total,
                bool_or(motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) IS NOT NULL) AS dudoso,
                count(*)::int AS filas
           FROM planilla_pte p
           JOIN unnest($1::text[], $2::text[]) AS t(e, nn) ON t.e = p.entidad_ruc AND t.nn = p.nombre_norm
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        [filas.rows.map((f) => f.entidadRuc), filas.rows.map((f) => f._nn)]);
      for (const r of h.rows) {
        const k = `${r.e}|${r.nn}`;
        const l = historia.get(k) ?? [];
        l.push({ mes: r.mes, base: r.base, extra: r.extra, total: r.total, dudoso: r.dudoso, filas: r.filas });
        historia.set(k, l);
      }
    }
    const data = filas.rows.map(({ n: _n, _nn, paterno, nombres, ...f }) => ({
      ...f,
      // El apellido materno, tapado (docs/PRIVACIDAD.md): nunca sale de la API.
      nombre: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" "),
      historia: historia.get(`${f.entidadRuc}|${_nn}`) ?? [],
    }));
    return publicar({ total: filas.rows[0]?.n ?? 0, page: q.page, size: q.size, data, resumen: res.rows[0] });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /plazas ────────────────────────────────────────────────────────────────────────────────
const ListaPlazas = {
  ...Alcance,
  senal: z.enum(TIPOS_PLAZA).optional(),
  orden: z.enum(["senales", "reciente", "sueldo"]).default("senales"),
};
const ORDEN_PLAZAS = { senales: "s.sev DESC, s.n_senales DESC, s.fecha_inicio DESC NULLS LAST", reciente: "s.fecha_inicio DESC NULLS LAST", sueldo: "s.remuneracion DESC NULLS LAST" };

plazasRouter.get("/", async (c) => {
  const parsed = leer(c, ListaPlazas);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(`plazas:${JSON.stringify(q)}`, async () => {
    const alc: string[] = ["TRUE"];
    const vals: unknown[] = [];
    if (q.entidad) { vals.push(q.entidad); alc.push(`s.entidad_ruc = $${vals.length}`); }
    if (q.dep) { vals.push(q.dep); alc.push(`left(e.ubigeo, 2) = $${vals.length}`); }
    const desde = `FROM servir_convocatoria s LEFT JOIN entidades e ON e.ruc = s.entidad_ruc`;
    const resumenP = pool.query(
      `WITH x AS MATERIALIZED (SELECT s.vacantes, s.remuneracion, s.n_senales, s.sev, s.tipos, s.fecha_inicio ${desde} WHERE ${alc.join(" AND ")})
       SELECT (SELECT count(*) FROM x)::int AS plazas, (SELECT COALESCE(sum(vacantes), 0) FROM x)::int AS vacantes,
              (SELECT count(*) FROM x WHERE n_senales > 0)::int AS "conSenales",
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) FROM x WHERE remuneracion > 0)::float AS "medianaSueldo",
              (SELECT to_char(min(fecha_inicio), 'YYYY-MM-DD') FROM x) AS desde,
              COALESCE((SELECT json_agg(y ORDER BY y.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM x, unnest(x.tipos) t GROUP BY t) y), '[]') AS "porSenal"`,
      vals);
    if (q.size === 0) return publicar({ total: 0, page: 1, size: 0, data: [], resumen: (await resumenP).rows[0] });
    const conds = [...alc];
    const v2 = [...vals];
    if (q.senal) { v2.push([q.senal]); conds.push(`s.tipos @> $${v2.length}::text[]`); }
    for (const w of palabrasBusqueda(q.q)) {
      v2.push(`%${w}%`);
      conds.push(`mef_norm(COALESCE(s.titulo, '') || ' ' || COALESCE(s.entidad, '') || ' ' || COALESCE(s.ubicacion, '') || ' ' || COALESCE(s.servicio, '')) LIKE $${v2.length}`);
    }
    sevCond(q.severidad, conds, v2, "s");
    const [filas, res] = await Promise.all([
      pool.query(
        `SELECT s.aviso, s.titulo, s.entidad, s.entidad_ruc AS "entidadRuc", s.ubicacion, s.numero, s.vacantes, s.remuneracion::float AS remuneracion,
                to_char(s.fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio", to_char(s.fecha_fin, 'YYYY-MM-DD') AS "fechaFin", s.experiencia,
                s.formacion, s.especializacion, s.conocimiento, s.servicio, s.exp_general::float AS "expGeneral", s.detalle_url AS "detalleUrl",
                s.senales, s.n_senales AS "nSenales", count(*) OVER ()::int AS n
           ${desde} WHERE ${conds.join(" AND ")}
          ORDER BY ${ORDEN_PLAZAS[q.orden]}, s.aviso DESC
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, v2),
      resumenP,
    ]);
    return publicar({ total: filas.rows[0]?.n ?? 0, page: q.page, size: q.size, data: filas.rows.map(({ n: _n, ...f }) => f), resumen: res.rows[0] });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
