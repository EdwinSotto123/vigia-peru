import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, publicar } from "../lib/privacidad.js";

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

export const TIPOS_PLANILLA = ["tambien_ordenes", "candidato_gobierna", "brecha_cargo", "apellidos_autoridad", "apellidos_directivo", "antes_locador"] as const;
export const TIPOS_PLAZA = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "sueldo_alto", "ya_hay_locadores"] as const;
const SEV: Record<string, number> = { alta: 3, media: 2, baja: 1 };

const Alcance = {
  entidad: z.string().regex(/^\d{11}$/).optional(),
  dep: z.string().regex(/^\d{2}$/).optional(),
  severidad: z.enum(["alta", "media", "baja", "con", "sin"]).optional(),
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
  orden: z.enum(["senales", "sueldo", "meses"]).default("senales"),
};
const ORDEN_PLANILLA = { senales: "p.sev DESC, p.n_senales DESC, p.total DESC NULLS LAST", sueldo: "p.total DESC NULLS LAST", meses: "p.meses DESC, p.total DESC NULLS LAST" };

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
    sevCond(q.severidad, conds, v2, "p");
    const [filas, res] = await Promise.all([
      pool.query(
        `SELECT p.entidad_ruc AS "entidadRuc", p.entidad, p.paterno, p.nombres, p.regimen, p.cargo, p.dependencia, p.total::float AS total,
                p.meses, to_char(p.primer_mes, 'YYYY-MM') AS "primerMes", to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes",
                p.senales, p.n_senales AS "nSenales", p.codigo, count(*) OVER ()::int AS n
           FROM planilla_persona p WHERE ${conds.join(" AND ")}
          ORDER BY ${ORDEN_PLANILLA[q.orden]}, p.nombre_norm
          LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, v2),
      resumenP,
    ]);
    const data = filas.rows.map(({ n: _n, paterno, nombres, ...f }) => ({
      ...f,
      // El apellido materno, tapado (docs/PRIVACIDAD.md): nunca sale de la API.
      nombre: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" "),
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
