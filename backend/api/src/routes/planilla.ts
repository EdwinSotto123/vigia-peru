import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";
import { PARIENTE_LOCADOR, funcionariosConPariente, type FuncionariosConPariente } from "./entidades.js";

/**
 * Planilla (migración 92) y plazas CAS (migración 93).
 *
 *   GET /planilla[?entidad=|dep=] el personal que la entidad publica en su Portal de Transparencia, con sus señales
 *                                 (también recibe órdenes, gana el doble que su cargo, apellidos de una autoridad o de un
 *                                 directivo, candidato del que gobierna, fue locador antes). Paginado, con su resumen.
 *   GET /planilla/ficha/:codigo   la ficha de una persona de la planilla (migración 107): sus datos, señales con detalle,
 *                                 lo que cobró cada mes cargado y la misma persona en la planilla de otras entidades.
 *   GET /planilla/mensual?entidad= la planilla de la entidad mes a mes (personas, sueldos, quiénes entraron y salieron) y
 *                                 los cambios de gobierno de esos meses (migración 182).
 *   GET /plazas[?entidad=|dep=]   las plazas CAS que publicó en SERVIR, con sus señales (pide experiencia en la propia
 *                                 entidad, paga mucho y pide poco, plazo corto, ya hay locadores).
 *
 * Privacidad (docs/PRIVACIDAD.md): el PTE no trae DNI. El nombre sale con el apellido materno tapado acá mismo (no
 * lleva RUC 10 para que publicar() la reconozca); publicar() tapa además a quienes nombran las señales.
 */
export const planillaRouter = new Hono();
export const plazasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "planilla", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const fichaMemo = new Memo<Record<string, unknown> | null>({ nombre: "planilla:ficha", ttlMs: 600_000, staleMs: 600_000, max: 400 });

export const TIPOS_PLANILLA = ["tambien_ordenes", "pariente_locador", "pariente_planilla", "familiar_en_planilla", "doble_planilla", "socio_proveedor", "financio_campana", "candidato_gobierna", "aporte_gobierna", "brecha_cargo", "ascenso_expres", "apellidos_autoridad", "apellidos_directivo", "antes_locador", "pago_extraordinario", "es_autoridad"] as const;
// Sin `sueldo_alto`: no se calcula desde la migración 95 (el tipo de servicio es muy amplio para comparar sueldos), y un
// filtro que nunca encuentra nada no se ofrece.
export const TIPOS_PLAZA = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "ya_hay_locadores", "gestion_saliente"] as const;
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

/** Las opciones de un tramo de `tramos` como enum de zod. */
const enumDe = <T extends Record<string, string>>(tramos: T) => z.enum(Object.keys(tramos) as [keyof T & string, ...(keyof T & string)[]]);
/** Cuántas filas caen en cada tramo (`{grupo: {opción: n}}`), en una pasada; `extra`, una condición que va con todas. */
const conteoTramos = (tramos: Record<string, Record<string, string>>, extra = "TRUE") =>
  `jsonb_build_object(${Object.entries(tramos)
    .map(([t, opciones]) => `'${t}', jsonb_build_object(${Object.entries(opciones).map(([v, cond]) => `'${v}', count(*) FILTER (WHERE ${extra} AND ${cond})`).join(", ")})`)
    .join(", ")})`;

function sevCond(s: string | undefined, conds: string[], vals: unknown[], t: string) {
  if (s === "con") conds.push(`${t}.n_senales > 0`);
  else if (s === "sin") conds.push(`${t}.n_senales = 0`);
  else if (s) { vals.push(SEV[s]); conds.push(`${t}.sev = $${vals.length}`); }
}

// ─── GET /planilla ──────────────────────────────────────────────────────────────────────────────
/**
 * El sueldo del último mes (`base`: remuneraciones y honorarios, sin gratificaciones ni liquidaciones; migración 98), por
 * tramos. Un sueldo con posible error de carga del Estado no cae en ninguno: va aparte de toda comparación (`SIN_DUDA`).
 */
export const TRAMOS_PLANILLA = {
  sueldo: {
    menos3: `p.base < 3000`,
    "3a5": `p.base >= 3000 AND p.base < 5000`,
    "5a10": `p.base >= 5000 AND p.base < 10000`,
    "10a20": `p.base >= 10000 AND p.base < 20000`,
    mas20: `p.base >= 20000`,
  },
} as const;
const SIN_DUDA = `p.dudoso IS NULL`;

/**
 * Cuántos meses lleva en la planilla desde que se carga (enero de 2025; migración 92): no es su antigüedad en el Estado,
 * sino lo que se ve en los datos.
 */
export const TRAMOS_ANTIGUEDAD = {
  antiguedad: {
    "1": `p.meses = 1`,
    "2a6": `p.meses BETWEEN 2 AND 6`,
    "7a12": `p.meses BETWEEN 7 AND 12`,
    "13mas": `p.meses >= 13`,
  },
} as const;

/** Un cargo de jefatura (jefe, director, gerente, coordinador, administrador…), como en el ascenso exprés (migración 182). */
export const JEFATURA = String.raw`mef_norm(p.cargo) ~ '\m(JEFE|JEFA|DIRECTOR|DIRECTORA|GERENTE|SUBGERENTE|SUB GERENTE|COORDINADOR|COORDINADORA|ADMINISTRADOR|ADMINISTRADORA|SECRETARIO GENERAL|SECRETARIA GENERAL|SUBDIRECTOR|SUBDIRECTORA|PROCURADOR|PROCURADORA)\M'`;

/** La oficina o el cargo como se agrupan: en mayúsculas y con los espacios juntos (el PTE los escribe de varias formas). */
const NORMAL = (col: string) => `regexp_replace(upper(btrim(${col})), '\\s+', ' ', 'g')`;

/**
 * La persona de la planilla (alias `t`) declaró en su DJI a un pariente que es locador de su misma entidad (el lado del
 * funcionario del nepotismo, como la ficha de planilla): con los pares ya calculados, una búsqueda por la llave
 * (entidad, nombre); sin ellos, fila por fila.
 */
export const conPariente = (t: string, pares: FuncionariosConPariente | null, p: (v: unknown) => string) =>
  pares
    ? `(${t}.entidad_ruc, ${t}.nombre_norm) IN (SELECT x.e, x.d FROM unnest(${p(pares.entidades)}::text[], ${p(pares.declarantes)}::text[]) AS x(e, d))`
    : `EXISTS (SELECT 1 FROM dji_vinculos v WHERE v.entidad_ruc = ${t}.entidad_ruc AND v.declarante_norm = ${t}.nombre_norm AND ${PARIENTE_LOCADOR})`;

export const ListaPlanilla = {
  ...Alcance,
  senal: z.enum(TIPOS_PLANILLA).optional(),
  regimen: z.coerce.number().int().min(1).max(9).optional(),
  // Sólo las filas con un posible error de carga del Estado (migración 102).
  dudoso: z.enum(["si"]).optional(),
  sueldo: enumDe(TRAMOS_PLANILLA.sueldo).optional(),
  // La oficina y el cargo (como `NORMAL`), dentro de una entidad: en el país o una región serían decenas de miles.
  oficina: z.string().trim().min(2).max(200).optional(),
  cargo: z.string().trim().min(2).max(200).optional(),
  // Declaró a un pariente que es locador de su entidad.
  pariente: z.enum(["si"]).optional(),
  // Un cargo de jefatura, y cuántos meses lleva en la planilla cargada.
  jefatura: z.enum(["si"]).optional(),
  antiguedad: enumDe(TRAMOS_ANTIGUEDAD.antiguedad).optional(),
  orden: z.enum(["senales", "sueldo", "meses"]).default("senales"),
};
type ListaPlanillaQ = z.infer<z.ZodObject<typeof ListaPlanilla>>;

/** Los filtros de la lista dentro del alcance (`conds` y `vals` ya traen el alcance). */
export function filtrosPlanilla(q: ListaPlanillaQ, conds: string[], vals: unknown[], pares: FuncionariosConPariente | null) {
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (q.senal) conds.push(`p.tipos @> ${p([q.senal])}::text[]`);
  if (q.regimen) conds.push(`p.regimen = ${p(q.regimen)}`);
  if (q.dudoso) conds.push(`p.dudoso IS NOT NULL`);
  if (q.sueldo) conds.push(`${SIN_DUDA} AND ${TRAMOS_PLANILLA.sueldo[q.sueldo]}`);
  if (q.entidad && q.oficina) conds.push(`${NORMAL("p.dependencia")} = ${p(q.oficina)}`);
  if (q.entidad && q.cargo) conds.push(`${NORMAL("p.cargo")} = ${p(q.cargo)}`);
  if (q.pariente) conds.push(conPariente("p", pares, p));
  if (q.jefatura) conds.push(JEFATURA);
  if (q.antiguedad) conds.push(TRAMOS_ANTIGUEDAD.antiguedad[q.antiguedad]);
  for (const w of palabrasBusqueda(q.q)) { const v = p(`%${w}%`); conds.push(`(${NOMBRE_PLANILLA} LIKE ${v} OR ${TEXTO_PLANILLA} LIKE ${v})`); }
  sevCond(q.severidad, conds, vals, "p");
}

const facetasPlanillaMemo = new Memo<Record<string, unknown>>({ nombre: "planilla:facetas", ttlMs: 600_000, staleMs: 3_600_000, max: 400 });

/**
 * Las opciones de los filtros que dependen del alcance, guardadas por alcance (como el resumen, no miran los demás
 * filtros): cuántos declararon a un pariente locador; y en una entidad, sus oficinas y cargos (los 500 con más personas;
 * los demás se encuentran con el buscador) y cuántos caen en cada tramo de sueldo. En el país o una región los tramos van
 * sin número: contarlos recorre las 640 mil filas (3 s).
 */
async function facetasPlanilla(q: ListaPlanillaQ, alc: string[], vals: unknown[], paresP: Promise<FuncionariosConPariente | null>) {
  const pares = await paresP;
  return facetasPlanillaMemo.obtener(JSON.stringify({ entidad: q.entidad, dep: q.dep, pares: !!pares }), async () => {
    const v = [...vals];
    const p = (x: unknown) => { v.push(x); return `$${v.length}`; };
    const pariente = conPariente("p", pares, p);
    const donde = alc.join(" AND ");
    const grupo = (col: string) =>
      pool.query<{ valor: string; n: number }>(
        `SELECT ${NORMAL(`p.${col}`)} AS valor, count(*)::int AS n FROM planilla_persona p
          WHERE ${donde} AND p.${col} IS NOT NULL AND btrim(p.${col}) <> '' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 500`, vals);
    const [conPar, oficinas, cargos, tramos] = await Promise.all([
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM planilla_persona p WHERE ${donde} AND ${pariente}`, v),
      q.entidad ? grupo("dependencia") : null,
      q.entidad ? grupo("cargo") : null,
      q.entidad
        ? pool.query<{ t: Record<string, Record<string, number>>; a: Record<string, Record<string, number>>; jefes: number }>(
            `SELECT ${conteoTramos(TRAMOS_PLANILLA, SIN_DUDA)} AS t, ${conteoTramos(TRAMOS_ANTIGUEDAD)} AS a,
                    count(*) FILTER (WHERE ${JEFATURA})::int AS jefes
               FROM planilla_persona p WHERE ${donde}`, vals)
        : null,
    ]);
    const tr = tramos?.rows[0];
    return {
      pariente: conPar.rows[0]?.n ?? 0, oficinas: oficinas?.rows ?? null, cargos: cargos?.rows ?? null,
      tramos: tr ? { ...tr.t, ...tr.a } : null, jefatura: tr?.jefes ?? null,
    };
  });
}

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
    // Los pares funcionario × entidad del indicio (calculados una vez): la lista sólo los espera si filtra por él.
    const paresP = funcionariosConPariente();
    const conds = [...alc];
    const v2 = [...vals];
    filtrosPlanilla(q, conds, v2, q.pariente ? await paresP : null);
    // La página va sola (con LIMIT) y el total aparte, como en /personas: con count(*) OVER () se ordenaban las 640 mil
    // filas del país para devolver 20. Sin filtros, el total es el del resumen; con filtros, con plazo propio (en el país
    // recorre la tabla: 0,2 s con la caché caliente, más de 10 s en frío). Si declaró a un pariente locador se mira sólo
    // en las filas de la página. Sin las facetas, la lista sigue (los filtros van sin números).
    const [filas, res, cuenta, facetas] = await Promise.all([
      pool.query(
        `WITH pag AS (
           SELECT p.* FROM planilla_persona p WHERE ${conds.join(" AND ")}
            ORDER BY ${ORDEN_PLANILLA[q.orden]}, p.nombre_norm
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT p.entidad_ruc AS "entidadRuc", p.entidad, p.paterno, p.nombres, p.regimen, p.cargo, p.dependencia, p.total::float AS total,
                p.base::float AS base, p.extra::float AS extra, p.dudoso,
                p.meses, to_char(p.primer_mes, 'YYYY-MM') AS "primerMes", to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes",
                p.senales, p.n_senales AS "nSenales", p.codigo, p.ficha, p.nombre_norm AS "_nn",
                ${conPariente("p", null, () => "")} AS "parienteLocador"
           FROM pag p ORDER BY ${ORDEN_PLANILLA[q.orden]}, p.nombre_norm`, v2),
      resumenP,
      conds.length > alc.length ? consultaConPlazo<{ n: number }>(`SELECT count(*)::int AS n FROM planilla_persona p WHERE ${conds.join(" AND ")}`, v2, 25_000) : null,
      facetasPlanilla(q, alc, vals, paresP).catch((e) => { console.warn(`[planilla] facetas: ${(e as Error).message}`); return null; }),
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
    const data = filas.rows.map(({ _nn, paterno, nombres, ...f }) => ({
      ...f,
      // El apellido materno, tapado (docs/PRIVACIDAD.md): nunca sale de la API.
      nombre: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" "),
      historia: historia.get(`${f.entidadRuc}|${_nn}`) ?? [],
    }));
    const total = cuenta ? cuenta.rows[0]?.n ?? 0 : (res.rows[0] as { personas?: number } | undefined)?.personas ?? 0;
    return publicar({ total, page: q.page, size: q.size, data, resumen: res.rows[0], facetas });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /planilla/ficha/:codigo ────────────────────────────────────────────────────────────────
const FICHA = /^[0-9a-f]{12}$/;

/** Lo que cobró cada mes cargado una persona en una entidad (la misma suma que la línea de tiempo de la lista). */
const HISTORIA_SQL = `SELECT to_char(make_date(p.anio, p.mes, 1), 'YYYY-MM') AS mes,
       sum(CASE WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
                WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END)::float AS base,
       sum(COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0))::float AS extra,
       sum(p.total)::float AS total,
       bool_or(motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) IS NOT NULL) AS dudoso,
       count(*)::int AS filas, max(p.cargo) AS cargo
  FROM planilla_pte p WHERE p.entidad_ruc = $1 AND p.nombre_norm = $2
 GROUP BY 1 ORDER BY 1`;

planillaRouter.get("/ficha/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!FICHA.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(codigo, async () => {
    const r = await pool.query(
      `SELECT p.entidad_ruc AS "entidadRuc", p.entidad, p.paterno, p.nombres, p.regimen, p.cargo, p.dependencia, p.total::float AS total,
              p.base::float AS base, p.extra::float AS extra, p.dudoso, p.meses, to_char(p.primer_mes, 'YYYY-MM') AS "primerMes",
              to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes", p.senales, p.n_senales AS "nSenales", p.codigo, p.ficha, p.dep,
              z.nombre AS "depNombre", p.nombre_norm AS "_nn"
         FROM planilla_persona p LEFT JOIN zonas z ON z.ubigeo = p.dep
        WHERE p.ficha = $1`, [codigo]);
    const f = r.rows[0];
    if (!f) return null;
    const [historia, otras, nepotismo] = await Promise.all([
      pool.query(HISTORIA_SQL, [f.entidadRuc, f._nn]),
      // El mismo nombre completo (con el materno) en la planilla de otra entidad: suele ser la misma persona.
      pool.query(
        `SELECT p.entidad_ruc AS "entidadRuc", p.entidad, p.cargo, p.regimen, p.base::float AS base, to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes",
                p.n_senales AS "nSenales", p.ficha
           FROM planilla_persona p WHERE p.nombre_norm = $1 AND p.entidad_ruc <> $2 ORDER BY p.ultimo_mes DESC, p.base DESC NULLS LAST LIMIT 50`,
        [f._nn, f.entidadRuc]),
      // Parientes que ESTA persona declaró en su DJI y que son locadores de su MISMA entidad (lado del funcionario del
      // nepotismo, vista dji_nepotismo migr. 137). El pariente (RUC-10) va tapado por publicar(); enlaza a su ficha.
      pool.query(
        `SELECT n.grado, n.parentesco, n.proveedor_ruc AS "proveedorRuc", n.proveedor_nombre AS "proveedorNombre",
                pc.codigo AS "proveedorCodigo", n.ordenes, n.monto
           FROM dji_nepotismo n LEFT JOIN persona_codigo pc ON pc.ruc = n.proveedor_ruc
          WHERE n.declarante_norm = $1 AND n.entidad_ruc = $2 ORDER BY n.monto DESC NULLS LAST LIMIT 20`,
        [f._nn, f.entidadRuc]),
    ]);
    const { _nn, paterno, nombres, ...resto } = f;
    return publicar({
      persona: { ...resto, nombre: [paterno, TAPA_NOMBRE, nombres].filter(Boolean).join(" ") },
      historia: historia.rows,
      otras: otras.rows,
      nepotismo: nepotismo.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /planilla/mensual?entidad= ─────────────────────────────────────────────────────────────
/**
 * La planilla de una entidad mes a mes (planilla_entidad_mes, migración 182): cuántas personas tuvo, su sueldo base sumado
 * y cuántas entraron y salieron frente al mes anterior que publicó; y los cambios de gobierno de esos meses (la gestión
 * local nueva o el Presidente que asumió), para marcarlos en el gráfico de la pestaña Planilla.
 */
const Mensual = z.object({ entidad: z.string().regex(/^\d{11}$/) });

planillaRouter.get("/mensual", async (c) => {
  const parsed = Mensual.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const { entidad } = parsed.data;
  const cuerpo = await memo.obtener(`mensual:${entidad}`, async () => {
    const [meses, cambios] = await Promise.all([
      pool.query(
        `SELECT to_char(mes, 'YYYY-MM') AS mes, personas, base::float AS base, altas, bajas
           FROM planilla_entidad_mes WHERE entidad_ruc = $1 ORDER BY mes`, [entidad]),
      pool.query<{ mes: string; nivel: string; quien: string | null }>(
        `WITH r AS (SELECT min(mes) AS d0, max(mes) AS d1 FROM planilla_entidad_mes WHERE entidad_ruc = $1),
              t AS (
                SELECT g.desde, g.nivel, g.org_nombre AS quien
                  FROM entidad_gobierno_amplia a JOIN gobierno_periodo g ON g.nivel = a.nivel AND g.ubigeo = a.ubigeo
                 WHERE a.ruc = $1
                UNION ALL
                SELECT n.desde, 'nacional', n.presidente
                  FROM entidad_gestion eg CROSS JOIN gobierno_nacional_inicio n
                 WHERE eg.ruc = $1 AND eg.nivel = 'nacional')
         SELECT DISTINCT to_char(t.desde, 'YYYY-MM') AS mes, t.nivel, t.quien
           FROM t, r WHERE t.desde > r.d0 AND t.desde <= r.d1 ORDER BY 1`, [entidad]).catch(() => ({ rows: [] })),
    ]);
    return { meses: meses.rows, cambios: cambios.rows };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /plazas ────────────────────────────────────────────────────────────────────────────────
/**
 * Los filtros por tramos de las plazas, sobre `servir_convocatoria s`: lo que paga, la experiencia general que pide (en
 * años; sin dato si SERVIR no la escribe en un formato que se lea) y cuántas vacantes ofrece.
 */
export const TRAMOS_PLAZA = {
  sueldo: {
    menos2500: `s.remuneracion < 2500`,
    "2500a4000": `s.remuneracion >= 2500 AND s.remuneracion < 4000`,
    "4000a6000": `s.remuneracion >= 4000 AND s.remuneracion < 6000`,
    "6000a10000": `s.remuneracion >= 6000 AND s.remuneracion < 10000`,
    mas10000: `s.remuneracion >= 10000`,
  },
  experiencia: {
    menos1: `s.exp_general < 1`,
    "1a3": `s.exp_general >= 1 AND s.exp_general < 3`,
    mas3: `s.exp_general >= 3`,
  },
  vacantes: {
    una: `s.vacantes = 1`,
    varias: `s.vacantes > 1`,
  },
} as const;
/** Se puede postular hoy (en Lima): ya empezó y no terminó su plazo. */
const HOY_LIMA = `(now() AT TIME ZONE 'America/Lima')::date`;
const ABIERTA = `s.fecha_fin >= ${HOY_LIMA} AND (s.fecha_inicio IS NULL OR s.fecha_inicio <= ${HOY_LIMA})`;

export const ListaPlazas = {
  ...Alcance,
  senal: z.enum(TIPOS_PLAZA).optional(),
  abierta: z.enum(["si"]).optional(),
  sueldo: enumDe(TRAMOS_PLAZA.sueldo).optional(),
  experiencia: enumDe(TRAMOS_PLAZA.experiencia).optional(),
  vacantes: enumDe(TRAMOS_PLAZA.vacantes).optional(),
  orden: z.enum(["senales", "reciente", "sueldo"]).default("senales"),
};
type ListaPlazasQ = z.infer<z.ZodObject<typeof ListaPlazas>>;
const ORDEN_PLAZAS = { senales: "s.sev DESC, s.n_senales DESC, s.fecha_inicio DESC NULLS LAST", reciente: "s.fecha_inicio DESC NULLS LAST", sueldo: "s.remuneracion DESC NULLS LAST" };

/** Los filtros de las plazas dentro del alcance (`conds` y `vals` ya traen el alcance). */
export function filtrosPlazas(q: ListaPlazasQ, conds: string[], vals: unknown[]) {
  if (q.senal) { vals.push([q.senal]); conds.push(`s.tipos @> $${vals.length}::text[]`); }
  if (q.abierta) conds.push(ABIERTA);
  if (q.sueldo) conds.push(TRAMOS_PLAZA.sueldo[q.sueldo]);
  if (q.experiencia) conds.push(TRAMOS_PLAZA.experiencia[q.experiencia]);
  if (q.vacantes) conds.push(TRAMOS_PLAZA.vacantes[q.vacantes]);
}

plazasRouter.get("/", async (c) => {
  const parsed = leer(c, ListaPlazas);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(`plazas:${JSON.stringify(q)}`, async () => {
    const alc: string[] = ["TRUE"];
    const vals: unknown[] = [];
    if (q.entidad) { vals.push(q.entidad); alc.push(`s.entidad_ruc = $${vals.length}`); }
    if (q.dep) { vals.push(q.dep); alc.push(`left(e.ubigeo, 2) = $${vals.length}`); }
    // La entidad (por su ubigeo) sólo hace falta para la región. Y por su RUC como char(11): comparada con el texto de
    // servir_convocatoria, el planificador no usaba su llave y cruzaba cada plaza con cada entidad (3 s por pedido).
    const desde = q.dep ? `FROM servir_convocatoria s JOIN entidades e ON e.ruc = s.entidad_ruc::char(11)` : `FROM servir_convocatoria s`;
    const resumenP = pool.query(
      `WITH x AS MATERIALIZED (SELECT s.vacantes, s.remuneracion, s.n_senales, s.sev, s.tipos, s.fecha_inicio, s.fecha_fin, s.exp_general
                                 ${desde} WHERE ${alc.join(" AND ")})
       SELECT (SELECT count(*) FROM x)::int AS plazas, (SELECT COALESCE(sum(vacantes), 0) FROM x)::int AS vacantes,
              (SELECT count(*) FROM x WHERE n_senales > 0)::int AS "conSenales",
              (SELECT count(*) FROM x WHERE sev = 3)::int AS alta,
              (SELECT count(*) FROM x WHERE sev = 2)::int AS media,
              (SELECT count(*) FROM x WHERE sev = 1)::int AS baja,
              (SELECT count(*) FROM x s WHERE ${ABIERTA})::int AS abiertas,
              (SELECT ${conteoTramos(TRAMOS_PLAZA)} FROM x s) AS tramos,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) FROM x WHERE remuneracion > 0)::float AS "medianaSueldo",
              (SELECT to_char(min(fecha_inicio), 'YYYY-MM-DD') FROM x) AS desde,
              COALESCE((SELECT json_agg(y ORDER BY y.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM x, unnest(x.tipos) t GROUP BY t) y), '[]') AS "porSenal"`,
      vals);
    if (q.size === 0) return publicar({ total: 0, page: 1, size: 0, data: [], resumen: (await resumenP).rows[0] });
    const conds = [...alc];
    const v2 = [...vals];
    filtrosPlazas(q, conds, v2);
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

// ─── GET /plazas/:aviso ─────────────────────────────────────────────────────────────────────────
/**
 * La ficha de una plaza CAS: la convocatoria con sus requisitos y señales, y su contexto. Las otras plazas de la entidad con
 * el mismo título (una convocatoria de varias vacantes suele venir así), lo que pagan otras entidades por el mismo título
 * (con tres plazas o más) y la gestión que la convocó (migración 183).
 */
const PLAZA_CAMPOS = `s.aviso, s.titulo, s.entidad, s.entidad_ruc AS "entidadRuc", s.ubicacion, s.numero, s.vacantes, s.remuneracion::float AS remuneracion,
       to_char(s.fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio", to_char(s.fecha_fin, 'YYYY-MM-DD') AS "fechaFin", s.experiencia,
       s.formacion, s.especializacion, s.conocimiento, s.servicio, s.exp_general::float AS "expGeneral", s.detalle_url AS "detalleUrl",
       s.senales, s.n_senales AS "nSenales"`;

plazasRouter.get("/:aviso", async (c) => {
  const aviso = c.req.param("aviso");
  if (!/^[0-9]{1,9}$/.test(aviso)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(`plaza:${aviso}`, async () => {
    const r = await pool.query(`SELECT ${PLAZA_CAMPOS}, mef_norm(s.titulo) AS "_t" FROM servir_convocatoria s WHERE s.aviso = $1`, [Number(aviso)]);
    const p = r.rows[0];
    if (!p) return null;
    const [mismas, otras, gestion] = await Promise.all([
      p.entidadRuc
        ? pool.query(
            `SELECT s.aviso, s.numero, s.vacantes, s.remuneracion::float AS remuneracion, to_char(s.fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio",
                    s.ubicacion, s.n_senales AS "nSenales"
               FROM servir_convocatoria s WHERE s.entidad_ruc = $1 AND mef_norm(s.titulo) = $2 AND s.aviso <> $3
              ORDER BY s.fecha_inicio DESC NULLS LAST, s.aviso DESC LIMIT 50`, [p.entidadRuc, p._t, p.aviso])
        : { rows: [] },
      pool.query<{ plazas: number; entidades: number; mediana: number | null; p25: number | null; p75: number | null }>(
        `SELECT count(*)::int AS plazas, count(DISTINCT s.entidad_ruc)::int AS entidades,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY s.remuneracion)::float AS mediana,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY s.remuneracion)::float AS p25,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY s.remuneracion)::float AS p75
           FROM servir_convocatoria s
          WHERE mef_norm(s.titulo) = $1 AND s.remuneracion > 0 AND s.entidad_ruc IS DISTINCT FROM $2`, [p._t, p.entidadRuc]),
      p.entidadRuc
        ? pool.query(`SELECT to_char(desde, 'YYYY-MM-DD') AS desde, quien, nivel, org_nombre AS partido FROM entidad_gestion WHERE ruc = $1`, [p.entidadRuc])
        : { rows: [] },
    ]);
    const { _t, ...plaza } = p;
    const o = otras.rows[0];
    return publicar({
      plaza,
      mismoTitulo: mismas.rows,
      // Con menos de tres plazas en otras entidades, no se compara.
      enOtras: o && o.plazas >= 3 ? o : null,
      gestion: gestion.rows[0] ?? null,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
