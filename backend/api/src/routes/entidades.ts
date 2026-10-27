import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, escaparLike, pool } from "../lib/db.js";
import { COLS_ESTADO_FILA, joinsEstadoFila } from "../lib/estadoFila.js";
import { cachePublico, parametros } from "../lib/http.js";
import { Memo } from "../lib/cache.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { crucesDeEntidad, fraccionamientoDeEntidad } from "../lib/cruces.js";
import { apellidoFuncionario, publicar } from "../lib/privacidad.js";
import { alertaNoDemo, alertaPublica, convocatoriaNoDemo, ENTIDAD_METADATA_MOCK } from "../lib/publicacion.js";

export const entidadesRouter = new Hono();

// Agregados de alertas: solo `activa` (como siempre) y NUNCA las semillas de demo `ALT-…`. Tampoco
// se leen las claves `*_mock` que seed_db.py dejó en entidades.metadata (reportes_mock, serie_mock,
// contratos, contratos_vigilados…): eran cifras inventadas. Ver lib/publicacion.ts §1.
const ALERTAS_ACTIVAS = `a.estado = 'activa' AND ${alertaNoDemo("a")}`;

/**
 * El tipo de la entidad como lo MUESTRA la web (frontend/lib/entidad-tipo.ts): el declarado en `tipo` (casi todo NULL)
 * o, si no, el que dice su nombre oficial, con las mismas reglas y en el mismo orden (una municipalidad de centro
 * poblado es distrital; una sin calificativo, provincial). NULL = sin clasificar. `t` es el alias de la tabla y
 * `nombre`, su nombre en minúsculas y sin tildes.
 */
export const CLASE_SQL = (t: string, nombre: string) => `CASE
  WHEN ${t}.tipo IN ('municipal_distrital', 'municipal_provincial', 'gobierno_regional', 'ministerio', 'empresa_publica', 'organismo_autonomo') THEN ${t}.tipo
  WHEN ${nombre} ~ '\\mmunicipalidad\\s+(distrital|de\\s+centro\\s+poblado)\\M' THEN 'municipal_distrital'
  WHEN ${nombre} ~ '\\mmunicipalidad\\M' THEN 'municipal_provincial'
  WHEN ${nombre} ~ '\\mgobierno\\s+regional\\M|\\mregion\\s+[a-z]' THEN 'gobierno_regional'
  WHEN ${nombre} ~ '\\mministerio\\M' THEN 'ministerio'
  WHEN ${nombre} ~ '\\m(empresa|e\\.?p\\.?s\\.?|sedapal|electro|egemsa|enapu|serpost)\\M' THEN 'empresa_publica'
  WHEN ${nombre} ~ '\\m(organismo|superintendencia|instituto|autoridad|contraloria|defensoria|jurado|registro)\\M' THEN 'organismo_autonomo'
END`;

/** Cada `clase` del filtro y los tipos de `CLASE_SQL` que junta (`municipal`: las dos municipalidades). */
const CLASES: Record<string, string> = {
  ministerio: `= 'ministerio'`,
  regional: `= 'gobierno_regional'`,
  municipal: `IN ('municipal_provincial', 'municipal_distrital')`,
  provincial: `= 'municipal_provincial'`,
  distrital: `= 'municipal_distrital'`,
  empresa: `= 'empresa_publica'`,
  organismo: `= 'organismo_autonomo'`,
  sin: `IS NULL`,
};
export const CLASES_ENTIDAD = Object.keys(CLASES) as [string, ...string[]];

/**
 * Las entidades donde un pariente que un funcionario declaró en su DJI es su locador: lo mismo que la vista
 * dji_nepotismo (migraciones 136-139), sin agruparla. La vista cruza `substr(ruc, 3, 8)` con el DNI del pariente y
 * recorre todas las órdenes de cada entidad (la lista tardaba 2,6 s, y 6 s con el filtro puesto); el RUC 10 es «10» +
 * DNI + un dígito, así que basta un rango sobre la llave de persona_orden_anual (entidad, ruc). Son ~115 de 3,162: se
 * calculan una vez para todas (`entidadesConNepotismo`) y la lista y sus conteos sólo miran si el RUC está entre ellas.
 */
export const PARIENTE_LOCADOR = `length(v.pariente_doc) = 8
     AND EXISTS (SELECT 1 FROM persona_orden_anual po
                  WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')`;
/** Los funcionarios (entidad y nombre normalizado, el de la planilla) que declararon a un pariente que es su locador. */
export const SQL_NEPOTISMO = `SELECT DISTINCT v.entidad_ruc AS entidad, v.declarante_norm AS declarante FROM dji_vinculos v
   WHERE v.declarante_norm IS NOT NULL AND ${PARIENTE_LOCADOR}`;

export interface FuncionariosConPariente { entidades: string[]; declarantes: string[] }
const nepotismoMemo = new Memo<FuncionariosConPariente>({ nombre: "entidades:nepotismo", ttlMs: 600_000, staleMs: 3_600_000, max: 1 });
/**
 * Los pares entidad × funcionario del indicio (~320), calculados una vez para todas las listas (la de entidades y la de
 * planilla), o null si no se pudo (entonces cada condición va fila por fila, con `PARIENTE_LOCADOR`).
 */
export const funcionariosConPariente = () =>
  nepotismoMemo
    .obtener("todos", async () => {
      const r = await consultaConPlazo<{ entidad: string; declarante: string }>(SQL_NEPOTISMO, [], 30_000);
      return { entidades: r.rows.map((x) => x.entidad), declarantes: r.rows.map((x) => x.declarante) };
    })
    .catch((e) => { console.warn(`[nepotismo] ${(e as Error).message}`); return null; });

/** La lista de entidades con el indicio, o null si no se pudo calcular. */
const entidadesConNepotismo = async () => {
  const f = await funcionariosConPariente();
  return f ? [...new Set(f.entidades)] : null;
};

/** El RUC (`ruc`, la columna) tiene el indicio: está en la lista (`param`, su `$n`) o, sin ella, por su cuenta. */
const enNepotismo = (ruc: string, param: string | null) =>
  param ? `${ruc}::text = ANY (${param}::text[])` : `EXISTS (SELECT 1 FROM dji_vinculos v WHERE v.entidad_ruc = ${ruc} AND ${PARIENTE_LOCADOR})`;

/**
 * Lo que otros registros dicen de la entidad, como condición sobre su RUC (`r`): la misma filtra la lista y cuenta cada
 * opción. Todas van por un índice de su tabla (entidad primero).
 */
export const SENALES_ENTIDAD = {
  // Contratos con indicio de captura por el partido que la gobierna (financió, vendió a su campaña, socio en la entidad).
  captura: (r: string) => `EXISTS (SELECT 1 FROM poder_entidad p WHERE p.entidad_ruc = ${r} AND p.n_captura > 0)`,
  // Informes de control de la Contraloría, con responsabilidad presunta (no es una condena).
  penal: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND 'penal' = ANY (i.responsabilidades))`,
  civil: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND 'civil' = ANY (i.responsabilidades))`,
  administrativa: (r: string) =>
    `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND i.responsabilidades && ARRAY['administrativa_entidad', 'administrativa_pas', 'administrativa'])`,
  informes: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r})`,
  // Su planilla (Portal de Transparencia): alguien con una señal alta, o que la publica.
  planillaAlta: (r: string) => `EXISTS (SELECT 1 FROM planilla_persona pp WHERE pp.entidad_ruc = ${r} AND pp.sev = 3)`,
  planilla: (r: string) => `EXISTS (SELECT 1 FROM planilla_persona pp WHERE pp.entidad_ruc = ${r})`,
  // Sus plazas CAS (SERVIR): alguna con señales de plaza a la medida, o alguna publicada.
  plazasSenales: (r: string) => `EXISTS (SELECT 1 FROM servir_convocatoria s WHERE s.entidad_ruc = ${r} AND s.n_senales > 0)`,
  plazas: (r: string) => `EXISTS (SELECT 1 FROM servir_convocatoria s WHERE s.entidad_ruc = ${r})`,
} as const;

export const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().max(80).optional(),
  tipo: z.string().max(60).optional(),
  // El tipo de la entidad (`CLASE_SQL`). Es un filtro, no una afirmación categórica: "ministerio" incluye al
  // Ministerio Público, etc.
  clase: z.enum(CLASES_ENTIDAD).optional(),
  // La provincia: los cuatro primeros dígitos del ubigeo.
  provincia: z.string().regex(/^\d{4}$/).optional(),
  // El partido que la gobierna (poder_entidad: gobiernos regionales y municipalidades) y si tiene contratos con indicio
  // de captura por él (migraciones 125 y 140).
  partido: z.string().trim().min(2).max(120).optional(),
  captura: z.enum(["1"]).optional(),
  // Informes de la Contraloría por el tipo de responsabilidad (presunta) que señalan, o cualquiera (migración 90).
  control: z.enum(["penal", "civil", "administrativa", "alguno"]).optional(),
  planilla: z.enum(["alta", "con"]).optional(),
  plazas: z.enum(["senales", "con"]).optional(),
  // Solo las entidades con indicio de nepotismo (un pariente declarado en la DJI que es su locador; vista migr. 136).
  nepotismo: z.enum(["1"]).optional(),
  orden: z.enum(["dictamen", "contratos", "nombre"]).default("dictamen"),
  // Con `facetas=1`, cuántas entidades hay en cada opción de los filtros (lo pide /app/entidades).
  facetas: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
type ListaEntidadesQ = z.infer<typeof ListQuery>;

const CONTROL: Record<NonNullable<ListaEntidadesQ["control"]>, keyof typeof SENALES_ENTIDAD> = {
  penal: "penal", civil: "civil", administrativa: "administrativa", alguno: "informes",
};

/**
 * Las condiciones de la lista sobre la tabla `t` (`nombre`: su nombre normalizado), con sus valores en `vals` (que puede
 * traer otros: las facetas juntan varias en una consulta). `nepotismo`: las entidades con ese indicio.
 */
export function filtrosEntidades(
  q: Partial<ListaEntidadesQ>, t: string, nombre: string, vals: unknown[] = [], nepotismo: string[] | null = null,
): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const ruc = `${t}.ruc`;
  // Un RUC (o su comienzo): el placeholder dice "por nombre o RUC" y antes sólo miraba el nombre.
  if (q.q && /^\d{4,11}$/.test(q.q)) conds.push(`${ruc}::text LIKE ${p(`${q.q}%`)}`);
  else if (q.q) conds.push(`${nombre} LIKE immutable_unaccent(${p(`%${escaparLike(q.q.toLowerCase())}%`)})`);
  if (q.region) conds.push(`${t}.region = ${p(q.region)}`);
  if (q.tipo) conds.push(`${t}.tipo = ${p(q.tipo)}`);
  if (q.clase) conds.push(`(${CLASE_SQL(t, nombre)}) ${CLASES[q.clase]}`);
  if (q.provincia) conds.push(`left(${t}.ubigeo, 4) = ${p(q.provincia)}`);
  if (q.partido) conds.push(`EXISTS (SELECT 1 FROM poder_entidad pp WHERE pp.entidad_ruc = ${ruc} AND pp.partido = ${p(q.partido)})`);
  if (q.captura) conds.push(SENALES_ENTIDAD.captura(ruc));
  if (q.control) conds.push(SENALES_ENTIDAD[CONTROL[q.control]](ruc));
  if (q.planilla) conds.push(SENALES_ENTIDAD[q.planilla === "alta" ? "planillaAlta" : "planilla"](ruc));
  if (q.plazas) conds.push(SENALES_ENTIDAD[q.plazas === "senales" ? "plazasSenales" : "plazas"](ruc));
  if (q.nepotismo) conds.push(enNepotismo(ruc, nepotismo && p(nepotismo)));
  return { conds, vals };
}

const ORDEN_ENTIDADES: Record<ListaEntidadesQ["orden"], { es: string; e: string }> = {
  dictamen: { es: "es.alertas_activas DESC, es.contratos DESC NULLS LAST, es.nombre, es.ruc", e: "a.alertas DESC NULLS LAST, cv.contratos DESC NULLS LAST, e.nombre, e.ruc" },
  contratos: { es: "es.contratos DESC NULLS LAST, es.nombre, es.ruc", e: "cv.contratos DESC NULLS LAST, e.nombre, e.ruc" },
  nombre: { es: "es.nombre_norm, es.ruc", e: "immutable_unaccent(lower(e.nombre)), e.ruc" },
};

const facetasMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:facetas", ttlMs: 600_000, staleMs: 3_600_000, max: 300 });

/**
 * Cuántas entidades hay en cada opción de los filtros, sobre lo que fija el lugar y el tipo (región, provincia, tipo) y
 * sin el filtro de cada faceta (los tipos, sin el tipo elegido; las provincias, sin la provincia): así ninguna opción
 * lleva a cero. Las señales se cuentan sobre ese mismo alcance, no sobre las otras señales. Una sola consulta (con
 * plazo propio: en frío, las señales de las 3,162 entidades pasan los 10 s del rol), guardada por alcance.
 */
export function sqlFacetasEntidades(q: Partial<ListaEntidadesQ>, modelos: boolean, nepotismo: string[] | null): { sql: string; vals: unknown[] } {
  const tabla = modelos ? "entidad_stats x" : "entidades x";
  const nombre = modelos ? "x.nombre_norm" : "immutable_unaccent(lower(x.nombre))";
  const vals: unknown[] = [];
  const donde = (f: Partial<ListaEntidadesQ>) => {
    const { conds } = filtrosEntidades(f, "x", nombre, vals);
    return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  };
  const sinClase = donde({ region: q.region, provincia: q.provincia });
  const sinProvincia = donde({ region: q.region, clase: q.clase });
  const alcance = donde({ region: q.region, provincia: q.provincia, clase: q.clase });
  if (nepotismo) vals.push(nepotismo);
  const senales = [
    ...Object.entries(SENALES_ENTIDAD).map(([k, f]) => `'${k}', count(*) FILTER (WHERE ${f("x.ruc")})`),
    `'nepotismo', count(*) FILTER (WHERE ${enNepotismo("x.ruc", nepotismo && `$${vals.length}`)})`,
  ].join(", ");
  const sql = `SELECT
      (SELECT COALESCE(json_agg(json_build_object('valor', COALESCE(t.v, 'sin'), 'n', t.n) ORDER BY t.n DESC), '[]')
         FROM (SELECT ${CLASE_SQL("x", nombre)} AS v, count(*)::int AS n FROM ${tabla} ${sinClase} GROUP BY 1) t) AS tipos,
      (SELECT COALESCE(json_agg(json_build_object('valor', t.v, 'etiqueta', t.e, 'n', t.n) ORDER BY t.e), '[]')
         FROM (SELECT left(x.ubigeo, 4) AS v, z.nombre AS e, count(*)::int AS n
                 FROM ${tabla} JOIN zonas z ON z.ubigeo = left(x.ubigeo, 4) ${sinProvincia} GROUP BY 1, 2) t) AS provincias,
      (SELECT COALESCE(json_agg(json_build_object('valor', t.v, 'n', t.n) ORDER BY t.v), '[]')
         FROM (SELECT pe.partido AS v, count(*)::int AS n FROM ${tabla} JOIN poder_entidad pe ON pe.entidad_ruc = x.ruc ${alcance} GROUP BY 1) t) AS partidos,
      (SELECT json_build_object(${senales}) FROM ${tabla} ${alcance}) AS senales`;
  return { sql, vals };
}

async function facetasEntidades(q: ListaEntidadesQ, modelos: boolean, nepotismo: string[] | null) {
  const clave = JSON.stringify({ modelos, region: q.region, provincia: q.provincia, clase: q.clase, nepotismo: !!nepotismo });
  return facetasMemo.obtener(clave, async () => {
    const { sql, vals } = sqlFacetasEntidades(q, modelos, nepotismo);
    return (await consultaConPlazo(sql, vals, 30_000)).rows[0] as Record<string, unknown>;
  });
}

// ─── GET /entidades — lista con contadores agregados (paginada) ─
// Fase 2 (auditoría C9): desde la vista materializada `entidad_stats` (migración 35), una fila por
// entidad con sus conteos ya hechos; antes cada pedido agrupaba TODAS las convocatorias. Mismas
// filas. Orden por defecto: dictámenes publicados, después las que más contratos tienen desde 2015, nombre; o más
// contratos, o por nombre. La provincia sale de `zonas` (con tildes, migración 72) y no del texto del SEACE. Va hasta un
// refresco detrás.
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const q = parsed.data;
  const { limit, offset } = q;
  const [modelos, nepotismo] = await Promise.all([hayModelosLectura(), entidadesConNepotismo()]);
  const col = modelos ? "es" : "e";
  const { conds, vals } = filtrosEntidades(q, col, modelos ? "es.nombre_norm" : "immutable_unaccent(lower(e.nombre))", [], nepotismo);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalVals = [...vals];
  if (nepotismo) vals.push(nepotismo);
  const conNepotismo = enNepotismo(`${col}.ruc`, nepotismo && `$${vals.length}`);
  vals.push(limit, offset);
  const [r, total, facetas] = await Promise.all([
    pool.query(modelos
      ? `SELECT es.ruc, es.nombre, es.tipo, es.region,
                COALESCE((SELECT z.nombre FROM entidades e2 JOIN zonas z ON z.ubigeo = left(e2.ubigeo::text, 4) WHERE e2.ruc = es.ruc), es.provincia) AS provincia,
                es.distrito,
                es.pliego_nombre_mef AS "pliegoNombreMef",
                es.alertas_activas AS alertas,
                es.monto_alertas_activas::float AS monto,
                COALESCE(es.score_prom_activas, 0)::int AS "scorePromedio",
                NULL::int AS reportes,
                es.contratos,
                es.alertas_activas AS "contratosVigilados",
                NULL::jsonb AS serie,
                ${conNepotismo} AS "conNepotismo"
           FROM entidad_stats es
           ${where}
           ORDER BY ${ORDEN_ENTIDADES[q.orden].es}
           LIMIT $${vals.length - 1} OFFSET $${vals.length}`
      : `SELECT
           e.ruc, e.nombre, e.tipo, e.region,
           COALESCE((SELECT z.nombre FROM zonas z WHERE z.ubigeo = left(e.ubigeo::text, 4)), e.provincia) AS provincia, e.distrito,
           e.pliego_nombre_mef AS "pliegoNombreMef",
           COALESCE(a.alertas, 0)      AS alertas,
           COALESCE(a.monto, 0)::float AS monto,
           COALESCE(a.score_avg, 0)::int AS "scorePromedio",
           NULL::int                   AS reportes,   -- antes metadata.reportes_mock (inventado)
           COALESCE(cv.contratos, 0)::int AS contratos,
           COALESCE(a.alertas, 0)::int AS "contratosVigilados",
           NULL::jsonb                 AS serie,      -- antes metadata.serie_mock (inventado)
           ${conNepotismo} AS "conNepotismo"
         FROM entidades e
         LEFT JOIN (
           SELECT c.entidad_ruc, COUNT(*)::int AS contratos FROM convocatorias c WHERE ${convocatoriaNoDemo("c")} GROUP BY c.entidad_ruc
         ) cv ON cv.entidad_ruc = e.ruc
         LEFT JOIN (
           SELECT a.entidad_ruc, COUNT(*)::int AS alertas, SUM(a.monto_adjudicado) AS monto, AVG(a.score)::int AS score_avg
           FROM alertas a WHERE ${ALERTAS_ACTIVAS}
           GROUP BY a.entidad_ruc
         ) a ON a.entidad_ruc = e.ruc
         ${where}
         ORDER BY ${ORDEN_ENTIDADES[q.orden].e}
         LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    pool.query(`SELECT count(*)::int AS n FROM ${modelos ? "entidad_stats es" : "entidades e"} ${where}`, totalVals),
    // Sin las facetas, la lista sigue: los filtros van sin números.
    q.facetas ? facetasEntidades(q, modelos, nepotismo).catch((e) => { console.warn(`[entidades] facetas: ${(e as Error).message}`); return null; }) : null,
  ]);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset, ...(q.facetas ? { facetas } : {}) });
});

// ─── GET /entidades/summary ── KPIs globales ────────────────────
entidadesRouter.get("/summary", async (c) => {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM entidades) AS total_entidades,
       (SELECT COUNT(*)::int FROM entidades e
          WHERE EXISTS (SELECT 1 FROM alertas a WHERE a.entidad_ruc = e.ruc AND ${ALERTAS_ACTIVAS})
       ) AS con_alertas,
       (SELECT COALESCE(SUM(a.monto_adjudicado), 0)::float FROM alertas a WHERE ${ALERTAS_ACTIVAS}) AS monto`,
  );
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(r.rows[0]);
});

// ─── GET /entidades/regiones — las regiones (departamentos) para el filtro de la lista ─
// Antes de /:ruc para que Hono no lo tome por un RUC.
entidadesRouter.get("/regiones", async (c) => {
  const modelos = await hayModelosLectura();
  const r = await pool.query<{ region: string }>(
    `SELECT DISTINCT region FROM ${modelos ? "entidad_stats" : "entidades"} WHERE region IS NOT NULL AND region <> '' ORDER BY region`,
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 3600 }));
  return c.json({ regiones: r.rows.map((x) => x.region) });
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
// ─── GET /entidades/:ruc/cruces — procesos cuyo ganador tiene cruces con otras fuentes (migración 48) ─
entidadesRouter.get("/:ruc/cruces", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(publicar(await crucesDeEntidad(ruc)));
});

// ─── GET /entidades/:ruc/fraccionamiento — órdenes menores de un mismo día que juntas pasan 8 UIT (migración 51) ─
entidadesRouter.get("/:ruc/fraccionamiento", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  // `?limit=` hasta 1000: la ficha las pide todas y las pagina (antes cortaba en 50 y decía "se muestran los 50").
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 50));
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(publicar(await fraccionamientoDeEntidad(ruc, limit)));
});

// ─── GET /entidades/:ruc/gasto — en qué gasta, según el MEF (migraciones 63 y 64) ─
// Suma las unidades ejecutoras con que cruzó la entidad (`mef_entity_budget.sec_ejecs`) en el último año cargado. Si la
// entidad cruzó con el pliego regional entero (`keyword` 'pliego …'), son las cifras de todo el gobierno regional:
// `cruce` lo dice y la ficha lo avisa. Ocho miradas, armadas en árbol donde corresponde:
//   genéricas › partidas › específicas · funciones · proyectos · fuentes › rubros · meses · programas › productos
type TipoGasto = "partida" | "funcion" | "proyecto" | "especifica" | "rubro" | "mes" | "programa" | "producto";
interface FilaGasto { tipo: TipoGasto; codigo: string; nombre: string | null; grupo: string | null; pim: number; devengado: number }
interface Dato { codigo: string; nombre: string; pim: number; devengado: number }

const porPim = (a: { pim: number }, b: { pim: number }) => b.pim - a.pim;

/** Junta en `lista` el dato con el mismo nombre (dos códigos que el clasificador llama igual son, en la ficha, uno). */
function sumarPorNombre<T extends Dato>(lista: T[], d: T): T {
  const igual = lista.find((p) => p.nombre.trim() === d.nombre.trim());
  if (!igual) {
    lista.push(d);
    return d;
  }
  igual.pim += d.pim;
  igual.devengado += d.devengado;
  return igual;
}

entidadesRouter.get("/:ruc/gasto", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const r = await pool.query<FilaGasto & { anio: number; cruce: string | null }>(
    `WITH e AS (SELECT sec_ejecs, split_part(keyword, ' ', 1) AS cruce FROM mef_entity_budget WHERE entidad_ruc = $1),
          u AS (SELECT max(g.anio) AS anio FROM mef_ejecutora_gasto g, e WHERE g.sec_ejec = ANY(e.sec_ejecs))
     SELECT u.anio, e.cruce, g.tipo, g.codigo, max(g.nombre) AS nombre, max(g.grupo) AS grupo,
            sum(g.pim)::float AS pim, sum(g.devengado)::float AS devengado
       FROM mef_ejecutora_gasto g, e, u
      WHERE g.anio = u.anio AND g.sec_ejec = ANY(e.sec_ejecs)
      GROUP BY u.anio, e.cruce, g.tipo, g.codigo
     HAVING sum(g.pim) > 0 OR sum(g.devengado) > 0`,
    [ruc],
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 300, swr: 3600 }));
  const filas = r.rows;
  const de = (t: TipoGasto) => filas.filter((x) => x.tipo === t);
  // 2999999 es el "proyecto" del MEF para las inversiones sin código propio (su actividad dice sólo "ACCIONES DE
  // INVERSIÓN" u "OBRAS"): sin nombre en el archivo.
  const dato = (f: FilaGasto): Dato => ({
    codigo: f.codigo,
    nombre: f.nombre || (f.tipo === "proyecto" && f.codigo === "2999999" ? "OTRAS INVERSIONES, SIN CÓDIGO DE PROYECTO EN EL MEF" : f.codigo),
    pim: f.pim,
    devengado: f.devengado,
  });

  // Genéricas › partidas › específicas. Dos partidas con el mismo nombre en una genérica ("GASTOS VARIABLES Y
  // OCASIONALES" del personal activo y del CAS) van juntas; sus específicas, también.
  type Partida = Dato & { especificas: Dato[] };
  const genericas = new Map<string, { nombre: string; pim: number; devengado: number; partidas: Partida[] }>();
  const partidaPorCodigo = new Map<string, Partida>();
  for (const f of de("partida")) {
    const g = f.grupo || "OTROS";
    let x = genericas.get(g);
    if (!x) genericas.set(g, (x = { nombre: g, pim: 0, devengado: 0, partidas: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    partidaPorCodigo.set(f.codigo, sumarPorNombre<Partida>(x.partidas, { ...dato(f), especificas: [] }));
  }
  for (const f of de("especifica")) {
    const p = partidaPorCodigo.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.especificas, dato(f));
  }
  for (const g of genericas.values()) {
    g.partidas.sort(porPim);
    for (const p of g.partidas) {
      p.especificas.sort(porPim);
      // Una sola específica que se llama como su partida no agrega nada.
      if (p.especificas.length === 1 && p.especificas[0].nombre.trim() === p.nombre.trim()) p.especificas = [];
    }
  }

  // Fuentes › rubros: de dónde viene la plata.
  const fuentes = new Map<string, { nombre: string; pim: number; devengado: number; rubros: Dato[] }>();
  for (const f of de("rubro")) {
    const k = f.grupo || "OTRAS FUENTES";
    let x = fuentes.get(k);
    if (!x) fuentes.set(k, (x = { nombre: k, pim: 0, devengado: 0, rubros: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    sumarPorNombre(x.rubros, dato(f));
  }
  for (const x of fuentes.values()) {
    x.rubros.sort(porPim);
    // "RECURSOS ORDINARIOS" › "RECURSOS ORDINARIOS": un solo rubro con el nombre de su fuente no agrega nada.
    if (x.rubros.length === 1 && x.rubros[0].nombre.trim() === x.nombre.trim()) x.rubros = [];
  }

  // Programas › productos.
  type Programa = Dato & { productos: Dato[] };
  const programas = new Map<string, Programa>(de("programa").map((f) => [f.codigo, { ...dato(f), productos: [] }]));
  for (const f of de("producto")) {
    const p = programas.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.productos, { ...dato(f), codigo: f.codigo.split(".").pop() ?? f.codigo });
  }
  for (const p of programas.values()) p.productos.sort(porPim);

  const proyectos = de("proyecto").map(dato).sort(porPim);
  return c.json({
    anio: filas[0]?.anio ?? null,
    cruce: filas[0]?.cruce ?? null,
    genericas: [...genericas.values()].sort(porPim),
    funciones: de("funcion").map(dato).sort(porPim),
    proyectos: {
      total: proyectos.length,
      pim: proyectos.reduce((s, p) => s + p.pim, 0),
      devengado: proyectos.reduce((s, p) => s + p.devengado, 0),
      // Todos: la ficha los pagina.
      lista: proyectos,
    },
    fuentes: [...fuentes.values()].sort(porPim),
    // Los doce meses, con cero los que no tienen devengado (la serie no salta).
    meses: Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      devengado: de("mes").filter((f) => Number(f.codigo) === i + 1).reduce((s, f) => s + f.devengado, 0),
    })),
    programas: [...programas.values()].sort(porPim),
  });
});

// ─── GET /entidades/:ruc/procesos — sus procesos adjudicados desde 2015 (CONOSCE desde 2018, migración 66; OCDS antes, 68) ─
// La base de Vigía (GET /contratos?entidad=) es casi toda de 2026; CONOSCE trae la historia. Un proceso por fila
// (código de convocatoria; ítems repetidos entre años, una vez), con el ganador de mayor monto, como
// GET /partidos/:clave/procesos. `resumen` va siempre sin filtros: las cifras de la ficha y los conteos de los filtros.
const ProcesosEntidadQuery = z.object({
  q: z.string().trim().min(3).max(80).optional(),
  objeto: z.string().max(40).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  orden: z.enum(["fecha", "monto"]).default("fecha"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const PROCESOS_DE_ENTIDAD = `
  WITH a AS (SELECT DISTINCT ON (codigo_convocatoria, n_item) * FROM conosce_adjudicaciones WHERE entidad_ruc = $1
              ORDER BY codigo_convocatoria, n_item, anio DESC),
       c AS (SELECT a.codigo_convocatoria AS codigo, min(a.fecha_convocatoria) AS fecha, max(a.objeto) AS objeto, max(a.tipo_proceso) AS "tipoProceso",
                    max(a.nomenclatura) AS nomenclatura, max(a.descripcion_proceso) AS descripcion, max(a.entidad) AS entidad, count(*)::int AS items,
                    sum(a.monto_referencial)::float AS "montoReferencial", sum(a.monto_adjudicado)::float AS "montoAdjudicado",
                    (sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')))::float AS pen, max(a.moneda) AS moneda,
                    count(DISTINCT a.ruc_proveedor)::int AS proveedores,
                    (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor,
                    (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS "rucProveedor"
               FROM a GROUP BY a.codigo_convocatoria)
  SELECT * FROM c
  UNION ALL
  -- Antes de 2018, de la API OCDS (migración 68): CONOSCE empieza ese año.
  SELECT h.codigo, h.fecha_convocatoria, h.objeto, h.tipo_proceso, h.nomenclatura, h.descripcion, h.entidad, 1,
         h.monto_referencial::float, h.monto_adjudicado::float,
         CASE WHEN h.moneda IS NULL OR h.moneda = 'PEN' THEN h.monto_adjudicado::float END,
         CASE COALESCE(h.moneda, 'PEN') WHEN 'PEN' THEN 'Soles' WHEN 'USD' THEN 'Dólar Norteamericano' WHEN 'EUR' THEN 'Euro' ELSE h.moneda END,
         h.proveedores, h.proveedor, h.ruc_proveedor
    FROM procesos_historicos h
   WHERE h.entidad_ruc = $1 AND h.fecha_convocatoria < DATE '2018-01-01' AND NOT EXISTS (SELECT 1 FROM c WHERE c.codigo = h.codigo)`;

const procesosEntidadMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:procesos", ttlMs: 300_000, staleMs: 300_000, max: 500 });

entidadesRouter.get("/:ruc/procesos", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = ProcesosEntidadQuery.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await procesosEntidadMemo.obtener(`procesos:${ruc}:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [ruc];
    const conds: string[] = [];
    if (q.objeto) { vals.push(q.objeto); conds.push(`p.objeto = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`extract(year FROM p.fecha) = $${vals.length}`); }
    if (q.q) {
      // El nombre de una persona natural (RUC 10) no se busca (como en casos_cruce y partido_proceso).
      vals.push(q.q);
      conds.push(`mef_norm(coalesce(p.descripcion, '') || ' ' || coalesce(p.nomenclatura, '') || ' ' ||
                  CASE WHEN p."rucProveedor" LIKE '10%' THEN '' ELSE coalesce(p.proveedor, '') END) LIKE '%' || mef_norm($${vals.length}) || '%'`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const orden = q.orden === "monto" ? `p.pen DESC NULLS LAST, p.fecha DESC` : `p.fecha DESC, p.pen DESC NULLS LAST`;
    const [filas, resumen] = await Promise.all([
      // La página primero (pag) y después, sólo para esas filas, lo que Vigía sabe de cada una (lib/estadoFila.ts).
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD}),
         pag AS (
           SELECT p.*, cv.ocid, count(*) OVER ()::int AS total, (sum(p.pen) OVER ())::float AS monto
             FROM p LEFT JOIN convocatorias cv ON cv.ocid = p.codigo
             ${where}
            ORDER BY ${orden}, p.codigo
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT pag.codigo, pag.nomenclatura, pag.descripcion, pag.objeto, pag."tipoProceso", to_char(pag.fecha, 'YYYY-MM-DD') AS fecha,
                pag.entidad, $1::text AS "entidadRuc", pag.items, pag."montoReferencial", pag."montoAdjudicado", pag.moneda, pag.proveedores,
                pag.proveedor, pag."rucProveedor", pag.ocid, pag.total, pag.monto, ${COLS_ESTADO_FILA}
           FROM pag
           ${joinsEstadoFila("pag.ocid")}
          ORDER BY ${orden.replace(/p\./g, "pag.")}, pag.codigo`, vals),
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD})
         SELECT count(*)::int AS procesos, COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen", count(DISTINCT "rucProveedor")::int AS proveedores,
                to_char(min(fecha), 'YYYY-MM-DD') AS desde,
                COALESCE((SELECT json_agg(x ORDER BY x.anio) FROM (SELECT extract(year FROM fecha)::int AS anio, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porAnio",
                COALESCE((SELECT json_agg(x ORDER BY x.procesos DESC) FROM (SELECT COALESCE(objeto, 'Sin dato') AS objeto, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porObjeto"
           FROM p`, [ruc]),
    ]);
    const total = filas.rows[0]?.total ?? 0;
    const monto = filas.rows[0]?.monto ?? 0;
    const data = filas.rows.map(({ total: _t, monto: _m, ...x }) => ({ ...x, nivel: null, lugar: null }));
    // El ganador puede ser una persona natural: publicar() la reconoce por su RUC 10 y tapa su nombre.
    return publicar({ total, montoAdjudicadoPen: monto, page: q.page, size: q.size, data, resumen: resumen.rows[0] });
  });
  c.header("Cache-Control", cachePublico(600, { maxAge: 120, swr: 600 }));
  return c.json(cuerpo);
});

entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const modelos = await hayModelosLectura();
  const [ent, mef, alertas, nep] = await Promise.all([
    pool.query(modelos
      // alertas, monto y contratos desde entidad_stats; la cola, en vivo (1,5 ms con la migración 32).
      ? `SELECT e.*,
                COALESCE(es.alertas_activas, 0)::int AS alertas,
                COALESCE(es.monto_alertas_activas, 0)::float AS monto,
                COALESCE(es.contratos, 0)::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN entidad_stats es ON es.ruc = e.ruc
          WHERE e.ruc = $1`
      : `SELECT e.*,
                COALESCE(a.alertas, 0)::int AS alertas,
                COALESCE(a.monto, 0)::float AS monto,
                (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN (
             SELECT a.entidad_ruc, COUNT(*) AS alertas, SUM(a.monto_adjudicado) AS monto
             FROM alertas a WHERE ${ALERTAS_ACTIVAS} GROUP BY a.entidad_ruc
           ) a ON a.entidad_ruc = e.ruc
          WHERE e.ruc = $1`,
      [ruc],
    ),
    // `corte`: la fecha del archivo del MEF del que salió (last_refreshed es cuándo se recalculó).
    pool.query(
      `SELECT b.*, (SELECT max(corte) FROM mef_ejecutora_anual) AS corte
         FROM mef_entity_budget b WHERE b.entidad_ruc = $1`,
      [ruc],
    ),
    // Solo alertas PUBLICADAS y no demo: antes salían también las que están en revisión humana o
    // descartadas, con su score (no publicado).
    pool.query(
      `SELECT a.id, a.codigo, a.codigo_convocatoria, a.score, a.fecha_buena_pro,
              a.monto_adjudicado, a.estado, a.objeto, a.region
         FROM alertas a WHERE a.entidad_ruc = $1 AND ${alertaPublica("a")}
         ORDER BY a.score DESC, a.id LIMIT 20`,
      [ruc],
    ),
    // Nepotismo (indicio, no acusación): parientes declarados en la DJI que son locadores de ESTA entidad.
    // Detalle: el FUNCIONARIO (cargo público, su DJI es pública) + el parentesco + el PROVEEDOR (RUC-10). El nombre
    // del proveedor lo tapa publicar() como a cualquier locador (un apellido). Ver vista dji_nepotismo (migr. 136).
    pool.query<{ declarante: string; cargo: string | null; declaranteFicha: string | null; grado: string; parentesco: string; proveedorRuc: string; proveedorNombre: string; proveedorCodigo: string | null; ordenes: number; monto: number }>(
      `SELECT n.declarante_norm AS declarante, n.cargo, pp.ficha AS "declaranteFicha", n.grado, n.parentesco,
              n.proveedor_ruc AS "proveedorRuc", n.proveedor_nombre AS "proveedorNombre", pc.codigo AS "proveedorCodigo", n.ordenes, n.monto
         FROM dji_nepotismo n
         LEFT JOIN persona_codigo pc ON pc.ruc = n.proveedor_ruc
         LEFT JOIN planilla_persona pp ON pp.entidad_ruc = n.entidad_ruc AND pp.nombre_norm = n.declarante_norm
        WHERE n.entidad_ruc = $1 ORDER BY n.monto DESC NULLS LAST LIMIT 40`,
      [ruc],
    ),
  ]);
  if (ent.rows.length === 0) return c.json({ error: "not_found" }, 404);
  // metadata sin las claves `*_mock` de seed_db.py (cifras inventadas).
  const entidad = ent.rows[0];
  if (entidad.metadata && typeof entidad.metadata === "object") {
    const limpia: Record<string, unknown> = { ...entidad.metadata };
    for (const k of ENTIDAD_METADATA_MOCK) delete limpia[k];
    entidad.metadata = limpia;
  }
  const porGradoMap = new Map<string, { grado: string; n: number; monto: number }>();
  for (const r of nep.rows) {
    const g = porGradoMap.get(r.grado) ?? { grado: r.grado, n: 0, monto: 0 };
    g.n += 1;
    g.monto += r.monto || 0;
    porGradoMap.set(r.grado, g);
  }
  const nepotismo = nep.rows.length
    ? {
        total: nep.rows.length,
        monto: nep.rows.reduce((a, r) => a + (r.monto || 0), 0),
        porGrado: [...porGradoMap.values()].sort((a, b) => b.monto - a.monto),
        // El proveedor (RUC-10) va tapado por publicar() como cualquier locador. Del funcionario, su cargo y, sólo si no
        // puede destapar el apellido tapado del pariente, su primer apellido (apellidoFuncionario); nunca el nombre
        // completo. Su ficha de planilla, tampoco cuando el parentesco no es seguro (ahí se ve su primer apellido).
        detalle: publicar(
          nep.rows.map(({ declarante, declaranteFicha, ...r }) => {
            const funcionarioApellido = apellidoFuncionario(r.parentesco, declarante);
            return { ...r, funcionarioApellido, declaranteFicha: funcionarioApellido ? declaranteFicha : null };
          }),
        ),
      }
    : null;
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({
    entidad,
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
    nepotismo,
  });
});
