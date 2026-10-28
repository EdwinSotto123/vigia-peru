import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, apellidoFuncionario, publicar } from "../lib/privacidad.js";
import { enlaceFuente } from "../lib/fuentes.js";
import { visitasHasta } from "../lib/visitas.js";
import { PERIODOS_GOBIERNO } from "./partidos.js";

/**
 * Personas contratadas (migración 91): quienes reciben órdenes de servicio del Estado como personas naturales
 * (RUC 10: locadores, asesores, choferes…) y lo que otros registros dicen de ellas en cada entidad (candidaturas,
 * aportes, autoridades, DJI, sanciones, visitas). Las señales son indicios para revisar, no pruebas.
 *
 * Privacidad (docs/PRIVACIDAD.md): cada fila lleva el RUC 10 junto al nombre, así publicar() pone la ref en lugar
 * del RUC y tapa un apellido en toda la respuesta. La ficha se pide por `codigo` (persona_codigo), nunca por RUC.
 * No hay búsqueda por nombre (como en casos_cruce): sólo por entidad, región, partido, señal y servicio.
 *
 *   GET /personas                 lista persona × entidad, paginada y filtrada, con el resumen de su alcance
 *   GET /personas/:codigo         la ficha: cada entidad con sus señales completas y lo que cobró por año
 *   GET /personas/:codigo/ordenes sus órdenes, paginadas
 */
export const personasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
/**
 * Hasta dónde se cuenta una lista con filtros: más allá, "más de 10 000" (`totalExacto: false`). También decide cómo se
 * arma la página: hasta el tope, juntando todas las coincidencias; más, recorriendo el índice del orden. Con 30 000 el
 * conteo de una palabra común se volvía lento («limpieza»: 5,4 s contra 1,8 s).
 */
const TOPE_CONTEO = 10_000;
const listaMemo = new Memo<Record<string, unknown>>({ nombre: "personas:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const fichaMemo = new Memo<Record<string, unknown> | null>({ nombre: "personas:ficha", ttlMs: 600_000, staleMs: 600_000, max: 400 });

export const TIPOS_SENAL = [
  "nepotismo", "financio_campana", "candidato_gobierna", "autoridad_contratada", "inhabilitado", "aporte_gobierna", "apellidos_autoridad", "apellidos_funcionario",
  "nepotismo_gobierno", "al_borde_del_tope", "socio_proveedor", "familia_estado",
  "funcionario_contratado", "meses_seguidos", "pago_alto", "candidato", "aporte", "visita_previa", "tambien_planilla", "paso_a_planilla",
] as const;

/**
 * Los filtros por tramos de la lista, con su condición sobre `persona_entidad pe` (texto fijo, sin nada del pedido): lo
 * que le pagó la entidad en todos sus años y en cuántos meses le dio órdenes (12 o más: un año de trabajo pagado como
 * locación; la señal «meses seguidos» mira 10 en un mismo año).
 */
export const TRAMOS_PERSONA = {
  monto: {
    menos5: `pe.monto < 5000`,
    "5a20": `pe.monto >= 5000 AND pe.monto < 20000`,
    "20a100": `pe.monto >= 20000 AND pe.monto < 100000`,
    "100a300": `pe.monto >= 100000 AND pe.monto < 300000`,
    mas300: `pe.monto >= 300000`,
  },
  meses: {
    "1": `pe.meses = 1`,
    "2a6": `pe.meses BETWEEN 2 AND 6`,
    "7a11": `pe.meses BETWEEN 7 AND 11`,
    "12a23": `pe.meses BETWEEN 12 AND 23`,
    "24mas": `pe.meses >= 24`,
  },
} as const;
/**
 * «Cuándo entró»: su primera orden de la entidad frente al inicio de la gestión que la gobierna hoy (entidad_gestion,
 * migración 181). `gestion`: entró con ella; `antes`: ya tenía órdenes antes y siguió con ella. Las entidades sin una
 * gestión que las cambie (organismos autónomos, universidades) no entran en ninguna de las dos.
 */
export const INGRESO_PERSONA = {
  gestion: `EXISTS (SELECT 1 FROM entidad_gestion g WHERE g.ruc = pe.entidad_ruc AND pe.primera >= g.desde)`,
  antes: `EXISTS (SELECT 1 FROM entidad_gestion g WHERE g.ruc = pe.entidad_ruc AND pe.primera < g.desde AND pe.ultima >= g.desde)`,
} as const;
type OpcionTramo<T extends keyof typeof TRAMOS_PERSONA> = keyof (typeof TRAMOS_PERSONA)[T] & string;
const tramo = <T extends keyof typeof TRAMOS_PERSONA>(t: T) => z.enum(Object.keys(TRAMOS_PERSONA[t]) as [OpcionTramo<T>, ...OpcionTramo<T>[]]);

/** Un gobierno de persona_entidad.gobiernos: 'clave del partido:año de su elección' (2014, 2018 o 2022). */
const GOBIERNO = /^[a-z0-9-]{1,80}:(\d{4})$/;

export const Lista = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  dep: z.string().regex(/^\d{2}$/).optional(),
  partido: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  periodo: z.coerce.number().int().refine((n) => PERIODOS_GOBIERNO.some((p) => p.anio === n)).optional(),
  // El partido que gobernaba la entidad cuando le dio las órdenes, en ese período: un filtro dentro del alcance (el
  // `partido` + `periodo` de arriba ES el alcance: la ficha de un partido).
  gobierno: z.string().regex(GOBIERNO).refine((g) => PERIODOS_GOBIERNO.some((p) => p.anio === Number(GOBIERNO.exec(g)?.[1]))).optional(),
  senal: z.enum(TIPOS_SENAL).optional(),
  severidad: z.enum(["alta", "media", "baja", "con", "sin"]).optional(),
  servicio: z.string().trim().min(2).max(60).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  monto: tramo("monto").optional(),
  meses: tramo("meses").optional(),
  ingreso: z.enum(["gestion", "antes"]).optional(),
  // El buscador: la entidad y el tipo de servicio, nunca el nombre de la persona (docs/PRIVACIDAD.md).
  q: z.string().trim().min(2).max(80).optional(),
  orden: z.enum(["senales", "monto", "ordenes", "meses", "reciente"]).default("senales"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  // size=0: sólo el resumen (los bloques del Inicio).
  size: z.coerce.number().int().min(0).max(50).default(20),
});
type ListaQ = z.infer<typeof Lista>;

const ORDEN: Record<ListaQ["orden"], string> = {
  senales: "pe.sev DESC, pe.n_senales DESC, pe.monto DESC",
  monto: "pe.monto DESC",
  ordenes: "pe.ordenes DESC, pe.monto DESC",
  meses: "pe.meses DESC, pe.monto DESC",
  reciente: "pe.ultima DESC NULLS LAST, pe.monto DESC",
};
const SEV: Record<string, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Las palabras de una búsqueda como las deja `mef_norm` en la base (mayúsculas, sin tildes, sólo letras y cifras): cada
 * una va a un `LIKE '%PALABRA%'` sobre el texto normalizado, que usa los índices de trigramas (migración 103). Hasta 5
 * palabras de 3 letras o más (con menos el índice de trigramas no sirve); como no quedan `%` ni `_`, no hay que escaparlas.
 */
export function palabrasBusqueda(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 5);
}

/** La expresión indexada de persona_entidad (migración 103). */
const TEXTO_PE = `mef_norm(COALESCE(pe.entidad, '') || ' ' || COALESCE(pe.servicio, ''))`;

/** Lo que fija el alcance (entidad, región, partido): el resumen va sobre esto, sin los demás filtros. */
function alcance(q: ListaQ): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (q.entidad) { vals.push(q.entidad); conds.push(`pe.entidad_ruc = $${vals.length}`); }
  if (q.dep) { vals.push(q.dep); conds.push(`pe.dep = $${vals.length}`); }
  if (q.partido) { vals.push([`${q.partido}:${q.periodo ?? 2022}`]); conds.push(`pe.gobiernos @> $${vals.length}::text[]`); }
  return { conds, vals };
}

/** Los filtros de la lista dentro del alcance. */
export function filtros(q: ListaQ, conds: string[], vals: unknown[]) {
  if (q.gobierno) { vals.push([q.gobierno]); conds.push(`pe.gobiernos @> $${vals.length}::text[]`); }
  if (q.monto) conds.push(TRAMOS_PERSONA.monto[q.monto]);
  if (q.meses) conds.push(TRAMOS_PERSONA.meses[q.meses]);
  if (q.ingreso) conds.push(INGRESO_PERSONA[q.ingreso]);
  if (q.senal) { vals.push([q.senal]); conds.push(`pe.tipos @> $${vals.length}::text[]`); }
  if (q.severidad === "con") conds.push(`pe.sev > 0`);
  else if (q.severidad === "sin") conds.push(`pe.sev = 0`);
  else if (q.severidad) { vals.push(SEV[q.severidad]); conds.push(`pe.sev = $${vals.length}`); }
  if (q.servicio) { vals.push(q.servicio); conds.push(`pe.servicio = $${vals.length}`); }
  if (q.anio) { vals.push(q.anio); conds.push(`$${vals.length}::smallint = ANY (pe.anios)`); }
  for (const w of palabrasBusqueda(q.q)) { vals.push(`%${w}%`); conds.push(`${TEXTO_PE} LIKE $${vals.length}`); }
}

/** Partidos que gobernaban la entidad en esos años ('clave:anio' de persona_entidad.gobiernos), con su nombre. */
const GOBIERNOS = (col: string) => `COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('clave', g.org_clave, 'nombre', g.org_nombre, 'anio', g.anio_eleccion))
      FROM gobierno_periodo g WHERE g.org_clave || ':' || g.anio_eleccion = ANY (${col})), '[]')`;

const FILA = `pe.codigo, pe.ruc, pe.nombre, pe.entidad, pe.entidad_ruc AS "entidadRuc", pe.dep, pe.servicio, pe.ordenes, pe.meses,
              pe.monto::float AS monto, to_char(pe.primera, 'YYYY-MM-DD') AS primera, to_char(pe.ultima, 'YYYY-MM-DD') AS ultima,
              pe.anios, pe.senales, pe.n_senales AS "nSenales"`;

const RESUMEN_VACIO = { filas: 0, personas: 0, monto: 0, ordenes: 0, conSenales: 0, alta: 0, media: 0, baja: 0, porSenal: [], porServicio: [], porAnio: [] };

/** La clave de persona_resumen de un alcance simple (sólo entidad, sólo región, sólo partido o el país); null si combina. */
function claveResumen(q: ListaQ): string | null {
  const n = [q.entidad, q.dep, q.partido].filter(Boolean).length;
  if (n === 0) return "pais";
  if (n > 1) return null;
  if (q.entidad) return `ent:${q.entidad}`;
  if (q.dep) return `dep:${q.dep}`;
  return `par:${q.partido}:${q.periodo ?? 2022}`;
}

/** El resumen del alcance: ya contado en persona_resumen (migración 91) o, si el alcance combina filtros, en vivo. */
async function resumenDe(q: ListaQ, conds: string[], vals: unknown[]) {
  const clave = claveResumen(q);
  if (clave) {
    const r = await pool.query(`SELECT resumen FROM persona_resumen WHERE alcance = $1`, [clave]);
    return r.rows[0]?.resumen ?? RESUMEN_VACIO;
  }
  return resumen(conds, vals);
}

/**
 * Las órdenes de servicio a personas que CONOSCE publicó con un monto que no se puede creer (migración 102), en el país
 * o en una entidad: se nombran junto al total, que no las suma. Índice parcial: son ~1 mil de 29 M. Para una región o
 * un partido, null (CONOSCE no trae el ubigeo de la entidad).
 */
async function dudosasDe(q: ListaQ): Promise<{ ordenes: number; monto: number } | null> {
  if (q.dep || q.partido) return null;
  const vals: unknown[] = [];
  let ent = "";
  if (q.entidad) { vals.push(q.entidad); ent = `AND o.entidad_ruc = $1`; }
  const r = await pool.query<{ ordenes: number; monto: number | null }>(
    `WITH d AS (
       SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista) o.monto_dudoso
         FROM conosce_ordenes o
        WHERE o.monto_dudoso IS NOT NULL AND o.ruc_contratista LIKE '10%' AND length(o.ruc_contratista) = 11 AND o.tipo_orden = 'Orden de Servicio'
          AND o.moneda = 'Nuevos Soles' ${ent}
        ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista, o.anio DESC, o.mes DESC)
     SELECT count(*)::int AS ordenes, COALESCE(sum(monto_dudoso), 0)::float AS monto FROM d`, vals);
  const d = r.rows[0];
  return d && d.ordenes > 0 ? { ordenes: d.ordenes, monto: Number(d.monto) } : null;
}

async function resumen(conds: string[], vals: unknown[]) {
  const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `WITH s AS MATERIALIZED (SELECT pe.ruc, pe.monto, pe.ordenes, pe.n_senales, pe.sev, pe.tipos, pe.servicio, pe.anios FROM persona_entidad pe ${donde})
     SELECT (SELECT count(*) FROM s)::int AS filas,
            (SELECT count(DISTINCT ruc) FROM s)::int AS personas,
            (SELECT COALESCE(sum(monto), 0) FROM s)::float AS monto,
            (SELECT COALESCE(sum(ordenes), 0) FROM s)::int AS ordenes,
            (SELECT count(*) FROM s WHERE n_senales > 0)::int AS "conSenales",
            (SELECT count(*) FROM s WHERE sev = 3)::int AS alta,
            (SELECT count(*) FROM s WHERE sev = 2)::int AS media,
            (SELECT count(*) FROM s WHERE sev = 1)::int AS baja,
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT t AS tipo, count(*)::int AS n FROM s, unnest(s.tipos) t GROUP BY t) x), '[]') AS "porSenal",
            COALESCE((SELECT json_agg(x ORDER BY x.n DESC) FROM (SELECT COALESCE(servicio, 'Otros') AS servicio, count(*)::int AS n,
                                                                         sum(monto)::float AS monto FROM s GROUP BY 1) x), '[]') AS "porServicio",
            COALESCE((SELECT json_agg(x ORDER BY x.anio) FROM (SELECT a AS anio, count(*)::int AS n FROM s, unnest(s.anios) a GROUP BY a) x), '[]') AS "porAnio"`,
    vals);
  return r.rows[0];
}

const facetasMemo = new Memo<Record<string, unknown> | null>({ nombre: "personas:facetas", ttlMs: 600_000, staleMs: 3_600_000, max: 400 });

/** Cuántas contrataciones del alcance caen en cada tramo de `TRAMOS_PERSONA`, en una pasada. */
const CONTEO_TRAMOS = `jsonb_build_object(${Object.entries(TRAMOS_PERSONA)
  .map(([t, opciones]) => `'${t}', jsonb_build_object(${Object.entries(opciones).map(([v, cond]) => `'${v}', count(*) FILTER (WHERE ${cond})`).join(", ")})`)
  .join(", ")})`;

/**
 * Las opciones de los filtros que dependen del alcance, guardadas por alcance (no por los demás filtros, como el resumen):
 *   · gobiernos: los partidos que gobernaban las entidades, con su nombre y período. En una entidad, los suyos con cuántas
 *     contrataciones; en el país, con las de cada partido ya contadas en persona_resumen; en una región, los que gobernaron
 *     allí, sin número (contarlos recorre cientos de miles de filas: 15 s en Lima). En la ficha de un partido no va.
 *   · tramos: cuántas caen en cada tramo de monto y de meses. Sólo en una entidad, donde se cuentan al instante; en el país
 *     o una región, las opciones van sin número.
 *   · gestion: en una entidad, desde cuándo la gobierna la gestión de hoy y cuántas contrataciones entraron con ella o
 *     venían de antes (el filtro «Cuándo entró»); null si la entidad no tiene gestión (o fuera de una entidad).
 */
async function facetasDe(q: ListaQ) {
  if (q.partido) return null;
  return facetasMemo.obtener(JSON.stringify({ entidad: q.entidad, dep: q.entidad ? undefined : q.dep }), async () => {
    const [gobiernos, tramos, gestion] = await Promise.all([
      pool.query<{ valor: string; nombre: string | null; anio: number; n: number | null }>(
        `WITH g AS (${q.entidad
          ? `SELECT g AS valor, count(*)::int AS n FROM persona_entidad pe, unnest(pe.gobiernos) g WHERE pe.entidad_ruc = $1 GROUP BY 1`
          : q.dep
            ? `SELECT DISTINCT org_clave || ':' || anio_eleccion AS valor, NULL::int AS n FROM gobierno_periodo WHERE left(ubigeo, 2) = $1`
            : `SELECT substr(alcance, 5) AS valor, (resumen->>'filas')::int AS n FROM persona_resumen WHERE alcance LIKE 'par:%'`}),
              nombres AS (SELECT DISTINCT ON (org_clave, anio_eleccion) org_clave || ':' || anio_eleccion AS valor, org_nombre AS nombre
                            FROM gobierno_periodo ORDER BY org_clave, anio_eleccion, org_nombre)
         SELECT g.valor, nombres.nombre, split_part(g.valor, ':', 2)::int AS anio, g.n
           FROM g LEFT JOIN nombres ON nombres.valor = g.valor
          WHERE g.n IS NULL OR g.n > 0
          ORDER BY nombres.nombre NULLS LAST, anio DESC`,
        q.entidad ? [q.entidad] : q.dep ? [q.dep] : []),
      q.entidad ? pool.query<{ t: Record<string, Record<string, number>> }>(`SELECT ${CONTEO_TRAMOS} AS t FROM persona_entidad pe WHERE pe.entidad_ruc = $1`, [q.entidad]) : null,
      q.entidad
        ? pool.query<{ desde: string; quien: string | null; nivel: string; gestion: number; antes: number }>(
            `SELECT to_char(g.desde, 'YYYY-MM-DD') AS desde, g.quien, g.nivel,
                    count(pe.ruc) FILTER (WHERE pe.primera >= g.desde)::int AS gestion,
                    count(pe.ruc) FILTER (WHERE pe.primera < g.desde AND pe.ultima >= g.desde)::int AS antes
               FROM entidad_gestion g LEFT JOIN persona_entidad pe ON pe.entidad_ruc = g.ruc
              WHERE g.ruc = $1 GROUP BY g.desde, g.quien, g.nivel`, [q.entidad])
        : null,
    ]);
    const g = gestion?.rows[0];
    return {
      gobiernos: gobiernos.rows,
      tramos: tramos?.rows[0]?.t ?? null,
      gestion: g ? { desde: g.desde, quien: g.quien, nivel: g.nivel, conteo: { gestion: g.gestion, antes: g.antes } } : null,
    };
  });
}

// ─── GET /personas ──────────────────────────────────────────────────────────────────────────────
personasRouter.get("/", async (c) => {
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = Lista.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await listaMemo.obtener(JSON.stringify(q), async () => {
    const { conds, vals } = alcance(q);
    const res = Promise.all([resumenDe(q, [...conds], [...vals]), dudosasDe(q)]).then(([r, dudosas]) => ({ ...r, dudosas }));
    if (q.size === 0) return publicar({ total: 0, page: 1, size: 0, data: [], resumen: await res });
    const sinFiltros = conds.length;
    filtros(q, conds, vals);
    const donde = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // La página va sola (con LIMIT usa el índice del orden) y el total aparte: con count(*) OVER () se ordenaba todo el
    // alcance (1,2 M filas en el país) para devolver 20. Sin filtros, el total es el del resumen. Con filtros en el país,
    // el total recorre las 3,2 M contrataciones si ningún índice lo acota (un año, unos meses: 1 s con la caché caliente,
    // más de 10 s en frío): va con plazo propio, como las órdenes de una empresa. Sin las facetas, la lista sigue (los
    // filtros van sin números). El total con filtros se cuenta hasta TOPE_CONTEO + 1, como en /contratos: "limpieza" son
    // 134 mil coincidencias y contarlas todas pasaba los 25 s (la búsqueda daba 500); si el conteo igual falla, la página
    // sale con un total aproximado en vez de un error.
    const cuentaP = conds.length > sinFiltros
      ? consultaConPlazo<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT 1 FROM persona_entidad pe ${donde} LIMIT ${TOPE_CONTEO + 1}) x`, vals, 15_000)
          .catch((e) => { console.warn(`[personas] conteo: ${(e as Error).message}`); return "fallo" as const; })
      : Promise.resolve(null);
    // Con pocas coincidencias (hasta el tope del conteo) se juntan todas por el índice de sus filtros (el de trigramas
    // para el texto) y recién se ordenan; con muchas, se recorre el índice del orden hasta llenar la página. Recorrer el
    // orden con una palabra poco común («construccion»: 18 mil de 3,2 millones, casi todas sin señales, al fondo del
    // orden) leía decenas de miles de filas sueltas en frío y pasaba los 10 s: la búsqueda daba 500.
    const filasP = cuentaP.then((cu) => {
      const pocas = cu !== null && cu !== "fallo" && (cu.rows[0]?.n ?? 0) <= TOPE_CONTEO;
      const origen = pocas ? `(SELECT * FROM persona_entidad pe ${donde} OFFSET 0) pe` : `persona_entidad pe ${donde}`;
      // Con plazo propio: en frío, recorrer el orden con una palabra de 10 a 50 mil coincidencias puede pasar los 10 s del
      // rol; mejor una página que tarda que un error.
      return consultaConPlazo(
        `WITH pag AS (
           SELECT pe.* FROM ${origen}
            ORDER BY ${ORDEN[q.orden]}, pe.entidad_ruc, pe.ruc
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT ${FILA.replace(/pe\./g, "pag.")}, ${GOBIERNOS("pag.gobiernos")} AS gobiernos
           FROM pag ORDER BY ${ORDEN[q.orden].replace(/pe\./g, "pag.")}, pag.entidad_ruc, pag.ruc`, vals, 25_000);
    });
    const [filas, rs, cuenta, facetas] = await Promise.all([
      filasP,
      res,
      cuentaP,
      facetasDe(q).catch((e) => { console.warn(`[personas] facetas: ${(e as Error).message}`); return null; }),
    ]);
    // Sin conteo (falló): lo que se sabe es que hay al menos lo de esta página y, si vino llena, algo más.
    const vistas = (q.page - 1) * q.size + filas.rows.length;
    const total = cuenta === "fallo" ? vistas + (filas.rows.length === q.size ? 1 : 0) : cuenta ? cuenta.rows[0]?.n ?? 0 : rs.filas;
    const totalExacto = cuenta === "fallo" ? filas.rows.length < q.size : total <= TOPE_CONTEO || !cuenta;
    return publicar({
      total, totalExacto, page: q.page, size: q.size, data: filas.rows.map((f) => ({ ...f, nombre: f.nombre ? conEnie(f.nombre) : f.nombre })), resumen: rs, facetas,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /personas/:codigo ──────────────────────────────────────────────────────────────────────
const CODIGO = /^[0-9a-f]{12}$/;

personasRouter.get("/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!CODIGO.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(codigo, async () => {
    const p = await pool.query<{ ruc: string }>(`SELECT ruc FROM persona_codigo WHERE codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc) return null;
    const [ent, senales, anual, mensual, dudosas, cambios] = await Promise.all([
      // Con la gestión que gobierna hoy cada entidad (migración 181): «entró con la gestión 2023-2026».
      pool.query(
        `SELECT ${FILA}, ${GOBIERNOS("pe.gobiernos")} AS gobiernos, z.nombre AS "depNombre",
                (SELECT jsonb_build_object('desde', to_char(g.desde, 'YYYY-MM-DD'), 'quien', g.quien, 'nivel', g.nivel)
                   FROM entidad_gestion g WHERE g.ruc = pe.entidad_ruc) AS gestion
           FROM persona_entidad pe LEFT JOIN zonas z ON z.ubigeo = pe.dep
          WHERE pe.ruc = $1 ORDER BY pe.sev DESC, pe.monto DESC`, [ruc]),
      pool.query(
        `SELECT s.entidad_ruc AS "entidadRuc", s.tipo, s.severidad, s.detalle, s.fuente, s.fuente_url AS "fuenteUrl",
                (SELECT p.id_pte FROM pte_entidad p WHERE p.ruc = s.entidad_ruc) AS "idPte"
           FROM persona_senal s WHERE s.ruc = $1
          ORDER BY CASE s.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, s.tipo`, [ruc]),
      // Lo que cobró por mes cada año, junto a lo que paga la entidad y el país por el mismo servicio.
      pool.query(
        `SELECT a.entidad_ruc AS "entidadRuc", a.entidad, a.anio, a.servicio, a.ordenes, a.meses, a.monto::float AS monto,
                round(a.monto / NULLIF(a.meses, 0), 2)::float AS "porMes", servicio_es_personal(a.servicio) AS personal,
                CASE WHEN re.personas IS NULL THEN NULL ELSE jsonb_build_object('personas', re.personas, 'mediana', re.mediana_mes,
                     'p25', re.p25_mes, 'p75', re.p75_mes, 'p90', re.p90_mes) END AS "enLaEntidad",
                CASE WHEN rp.personas IS NULL THEN NULL ELSE jsonb_build_object('personas', rp.personas, 'mediana', rp.mediana_mes,
                     'p25', rp.p25_mes, 'p75', rp.p75_mes, 'p90', rp.p90_mes) END AS "enElPais"
           FROM persona_orden_anual a
           LEFT JOIN servicio_referencia re ON re.entidad_ruc = a.entidad_ruc AND re.anio = a.anio AND re.servicio = a.servicio
           LEFT JOIN servicio_referencia rp ON rp.entidad_ruc = '' AND rp.anio = a.anio AND rp.servicio = a.servicio
          WHERE a.ruc = $1 ORDER BY a.anio DESC, a.monto DESC`, [ruc]),
      // Lo que cobró cada mes (línea de tiempo): el monto de cada orden tal como lo publicó CONOSCE; lo que puede ser un
      // error suyo, aparte (`dudoso`).
      pool.query<{ mes: string; monto: number; dudoso: number; ordenes: number }>(
        `WITH o AS (
           SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.fecha_emision, o.monto, o.monto_dudoso
             FROM conosce_ordenes o
            WHERE o.ruc_contratista = $1 AND o.tipo_orden = 'Orden de Servicio' AND o.moneda = 'Nuevos Soles'
              AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL) AND o.fecha_emision IS NOT NULL
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
         SELECT to_char(date_trunc('month', fecha_emision), 'YYYY-MM') AS mes, COALESCE(sum(monto), 0)::float AS monto,
                COALESCE(sum(monto_dudoso), 0)::float AS dudoso, count(*)::int AS ordenes
           FROM o GROUP BY 1 ORDER BY 1`, [ruc]),
      // Sus órdenes con un monto que puede ser un error de CONOSCE (migración 102): se muestran, no entran en sus sumas.
      pool.query<{ ordenes: number; monto: number | null; motivos: string[] | null }>(
        `WITH d AS (
           SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.monto_dudoso, o.dudoso_motivo
             FROM conosce_ordenes o
            WHERE o.ruc_contratista = $1 AND o.tipo_orden = 'Orden de Servicio' AND o.moneda = 'Nuevos Soles' AND o.monto_dudoso IS NOT NULL
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
         SELECT count(*)::int AS ordenes, sum(monto_dudoso)::float AS monto, array_agg(DISTINCT dudoso_motivo) AS motivos FROM d`, [ruc]),
      // Los cambios de gobierno en la entidad que más le pagó mientras tuvo órdenes (para marcarlos en su línea mes a mes):
      // la nueva gestión municipal o regional, o el Presidente que asumió si es del Ejecutivo.
      pool.query<{ mes: string; nivel: string; quien: string | null }>(
        `WITH e AS (SELECT entidad_ruc FROM persona_entidad WHERE ruc = $1 ORDER BY monto DESC LIMIT 1),
              r AS (SELECT min(primera) AS d0, max(ultima) AS d1 FROM persona_entidad WHERE ruc = $1),
              t AS (
                SELECT g.desde, g.nivel, g.org_nombre AS quien
                  FROM e JOIN entidad_gobierno_amplia a ON a.ruc = e.entidad_ruc
                  JOIN gobierno_periodo g ON g.nivel = a.nivel AND g.ubigeo = a.ubigeo
                UNION ALL
                SELECT n.desde, 'nacional', n.presidente
                  FROM e JOIN entidad_gestion eg ON eg.ruc = e.entidad_ruc AND eg.nivel = 'nacional'
                  CROSS JOIN gobierno_nacional_inicio n)
         SELECT DISTINCT to_char(t.desde, 'YYYY-MM') AS mes, t.nivel, t.quien
           FROM t, r WHERE t.desde > r.d0 AND t.desde <= r.d1 ORDER BY 1`, [ruc]).catch(() => ({ rows: [] })),
    ]);
    if (!ent.rows.length) return null;
    const nombrePersona = ent.rows[0]?.nombre ? conEnie(ent.rows[0].nombre) : null;
    // Las órdenes CONCRETAS detrás de la señal "inhabilitado" (el mismo JOIN órdenes↔sanción por vigencia que la computa
    // en la migración 91): se citan para que un humano pueda revisar cada una. Sólo si la persona tiene esa señal; el
    // `detalle.ordenes` (conteo) y estas filas salen del mismo DISTINCT ON, así que coinciden.
    const ordsInhab = new Map<string, Record<string, unknown>[]>();
    if (senales.rows.some((s) => s.tipo === "inhabilitado")) {
      const ro = await pool.query(
        `WITH _san AS (
           SELECT fecha_desde, COALESCE(fecha_hasta, CASE WHEN tipo = 'definitivo' THEN DATE '9999-12-31' END) AS hasta, resolucion
             FROM osce_sancionados
            WHERE ruc = $1 AND tipo IN ('temporal','definitivo') AND fecha_desde IS NOT NULL),
         o AS (
           SELECT DISTINCT ON (c.entidad_ruc, c.orden, c.fecha_emision)
                  c.entidad_ruc AS "entidadRuc", c.entidad, c.fecha_emision, c.nro_orden AS numero, c.orden,
                  c.descripcion, c.monto::float AS monto, c.tipo_contratacion AS "tipoContratacion", c.estado,
                  servicio_persona(c.descripcion) AS servicio
             FROM _san s
             JOIN conosce_ordenes c ON c.ruc_contratista = $1 AND c.fecha_emision BETWEEN s.fecha_desde AND s.hasta
            WHERE c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
            ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC)
         SELECT o."entidadRuc", o.entidad, to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.numero, o.orden, o.descripcion,
                o.monto, o."tipoContratacion", o.estado, o.servicio,
                (SELECT s.resolucion FROM _san s WHERE o.fecha_emision BETWEEN s.fecha_desde AND s.hasta ORDER BY s.fecha_desde LIMIT 1) AS resolucion
           FROM o ORDER BY o."entidadRuc", o.fecha_emision DESC`, [ruc]);
      for (const o of ro.rows) {
        const { entidadRuc, ...resto } = o as { entidadRuc: string } & Record<string, unknown>;
        const l = ordsInhab.get(entidadRuc) ?? [];
        l.push({ ...resto, descripcion: taparNombrePropio(resto.descripcion as string | null, nombrePersona) });
        ordsInhab.set(entidadRuc, l);
      }
    }
    // Las órdenes de servicio que la entidad le dio al locador: la evidencia de la señal "nepotismo", una por una (como
    // en "inhabilitado"). Sólo en las entidades donde tiene la señal; cada orden tal como la publicó CONOSCE.
    const ordsNep = new Map<string, Record<string, unknown>[]>();
    const entsNep = [...new Set(senales.rows.filter((s) => s.tipo === "nepotismo").map((s) => s.entidadRuc))];
    if (entsNep.length) {
      const ro = await pool.query(
        `SELECT o."entidadRuc", o.entidad, to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.numero, o.orden, o.descripcion,
                o.monto, o."tipoContratacion", o.estado, o.servicio
           FROM (
             SELECT DISTINCT ON (c.entidad_ruc, c.orden, c.fecha_emision)
                    c.entidad_ruc AS "entidadRuc", c.entidad, c.fecha_emision, c.nro_orden AS numero, c.orden,
                    c.descripcion, c.monto::float AS monto, c.tipo_contratacion AS "tipoContratacion", c.estado,
                    servicio_persona(c.descripcion) AS servicio
               FROM conosce_ordenes c
              WHERE c.ruc_contratista = $1 AND c.entidad_ruc = ANY($2)
                AND c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
              ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
           ) o ORDER BY o."entidadRuc", o.fecha_emision DESC`, [ruc, entsNep]);
      for (const o of ro.rows) {
        const { entidadRuc, ...resto } = o as { entidadRuc: string } & Record<string, unknown>;
        const l = ordsNep.get(entidadRuc) ?? [];
        l.push({ ...resto, descripcion: taparNombrePropio(resto.descripcion as string | null, nombrePersona) });
        ordsNep.set(entidadRuc, l);
      }
    }
    // La MISMA persona en la planilla de una entidad (enlace inverso locador→planilla, que faltaba): su ficha de planilla
    // por entidad, para que la señal "también en planilla" / "pasó a planilla" lleve a esa ficha.
    const planFichas = new Map<string, string>();
    if (senales.rows.some((s) => s.tipo === "tambien_planilla" || s.tipo === "paso_a_planilla")) {
      const pf = await pool.query<{ entidadRuc: string; ficha: string }>(
        `SELECT entidad_ruc AS "entidadRuc", ficha FROM planilla_persona WHERE codigo = $1 AND ficha IS NOT NULL`, [codigo]);
      for (const r of pf.rows) planFichas.set(r.entidadRuc, r.ficha);
    }
    // El funcionario que declaró a este locador como pariente (señal nepotismo) casi siempre está en la planilla de la
    // misma entidad: su ficha, para cerrar el vínculo locador→funcionario (`${entidad}|${nombre_norm}` → ficha).
    const declFichas = new Map<string, string>();
    if (entsNep.length) {
      const pf = await pool.query<{ entidadRuc: string; nn: string; ficha: string }>(
        `SELECT entidad_ruc AS "entidadRuc", nombre_norm AS nn, ficha FROM planilla_persona WHERE entidad_ruc = ANY($1) AND ficha IS NOT NULL`, [entsNep]);
      for (const r of pf.rows) declFichas.set(`${r.entidadRuc}|${r.nn}`, r.ficha);
    }
    // Nepotismo en el mismo gobierno (migración 179): el funcionario es de OTRA entidad; su ficha de planilla, de ésa.
    const declOtras = new Map<string, string>();
    // Y «Familia en el Estado» (migración 180): el funcionario es de otra entidad, fuera de su gobierno.
    const paresOtras = senales.rows
      .filter((s) => s.tipo === "nepotismo_gobierno" || s.tipo === "familia_estado")
      .flatMap((s) => {
        const par = (s.detalle as Record<string, unknown>)?.parientes;
        return Array.isArray(par) ? (par as Record<string, unknown>[]).map((pr) => [String(pr.entidad_ruc ?? ""), String(pr.declarante ?? "")] as const) : [];
      })
      .filter(([e, d]) => e && d);
    if (paresOtras.length) {
      const pf = await pool.query<{ entidadRuc: string; nn: string; ficha: string }>(
        `SELECT p.entidad_ruc AS "entidadRuc", p.nombre_norm AS nn, p.ficha FROM planilla_persona p
           JOIN unnest($1::text[], $2::text[]) AS x(e, n) ON p.entidad_ruc = x.e AND p.nombre_norm = x.n
          WHERE p.ficha IS NOT NULL`,
        [paresOtras.map(([e]) => e), paresOtras.map(([, d]) => d)]);
      for (const r of pf.rows) declOtras.set(`${r.entidadRuc}|${r.nn}`, r.ficha);
    }
    const porEntidad = new Map<string, unknown[]>();
    for (const s of senales.rows) {
      const l = porEntidad.get(s.entidadRuc) ?? [];
      const detalle = s.tipo === "inhabilitado"
        ? { ...(s.detalle as Record<string, unknown>), ordenes_detalle: ordsInhab.get(s.entidadRuc) ?? [] }
        : s.tipo === "nepotismo"
          ? (() => {
              const det = s.detalle as Record<string, unknown>;
              const par = det.parientes;
              return {
                ...det,
                parientes: Array.isArray(par)
                  ? (par as Record<string, unknown>[]).map(({ declarante, ...pr }) => {
                      // Sin el nombre completo del funcionario (ver apellidoFuncionario): su primer apellido y su ficha,
                      // sólo si el parentesco no puede destapar el apellido tapado de esta persona.
                      const funcionarioApellido = apellidoFuncionario(pr.parentesco, declarante);
                      return { ...pr, funcionarioApellido, ficha: funcionarioApellido ? declFichas.get(`${s.entidadRuc}|${String(declarante ?? "")}`) ?? null : null };
                    })
                  : par,
                ordenes_detalle: ordsNep.get(s.entidadRuc) ?? [],
              };
            })()
          : s.tipo === "nepotismo_gobierno" || s.tipo === "familia_estado"
            ? (() => {
                // Como en el nepotismo: nunca el nombre completo del funcionario; su primer apellido y su ficha sólo si el
                // parentesco no puede destapar el apellido tapado de esta persona.
                const det = s.detalle as Record<string, unknown>;
                const par = det.parientes;
                return {
                  ...det,
                  parientes: Array.isArray(par)
                    ? (par as Record<string, unknown>[]).map(({ declarante, ...pr }) => {
                        const funcionarioApellido = apellidoFuncionario(pr.parentesco, declarante);
                        return { ...pr, funcionarioApellido, ficha: funcionarioApellido ? declOtras.get(`${String(pr.entidad_ruc ?? "")}|${String(declarante ?? "")}`) ?? null : null };
                      })
                    : par,
                };
              })()
          : (s.tipo === "tambien_planilla" || s.tipo === "paso_a_planilla") && planFichas.has(s.entidadRuc)
            ? { ...(s.detalle as Record<string, unknown>), plan_ficha: planFichas.get(s.entidadRuc) }
            : s.detalle;
      // El enlace al registro exacto (lib/fuentes.ts): las declaraciones juradas de la entidad, su planilla en el Portal de
      // Transparencia, la ficha de la empresa de la que es socio, el reporte de visitas del mes; si no, la portada arreglada.
      const fuenteUrl = enlaceFuente(s.fuente, s.fuenteUrl, { entidadRuc: s.entidadRuc, idPte: s.idPte, detalle: s.detalle as Record<string, unknown> | null });
      l.push({ tipo: s.tipo, severidad: s.severidad, detalle, fuente: s.fuente, fuenteUrl });
      porEntidad.set(s.entidadRuc, l);
    }
    const entidades = ent.rows.map((e) => ({ ...e, nombre: e.nombre ? conEnie(e.nombre) : e.nombre, senalesDetalle: porEntidad.get(e.entidadRuc) ?? [] }));
    const sum = (k: "ordenes" | "monto" | "meses") => entidades.reduce((t, e) => t + Number(e[k] ?? 0), 0);
    const fechas = (k: "primera" | "ultima") => entidades.map((e) => e[k]).filter(Boolean).sort();
    return publicar({
      persona: {
        codigo, ruc, nombre: entidades[0].nombre, entidades: entidades.length, ordenes: sum("ordenes"), monto: sum("monto"),
        meses: sum("meses"), primera: fechas("primera")[0] ?? null, ultima: fechas("ultima").at(-1) ?? null,
        nSenales: senales.rows.length,
        dudosas: dudosas.rows[0]?.ordenes ? dudosas.rows[0] : null,
      },
      entidades,
      anual: anual.rows,
      mensual: mensual.rows,
      cambios: cambios.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * El nombre de la persona dentro de la descripción de sus órdenes, ya tapado (el materno): en orden SUNAT ("VARGAS
 * ROJAS LUIS") y hablado ("LUIS VARGAS ROJAS"). publicar() no lo reconoce bien en prosa cuando va pegado a otras palabras
 * en mayúsculas ("ASISTENCIA DE VARGAS ROJAS…" tapaba el "DE").
 */
/** La Ñ que CONOSCE escribe "¿" entre letras ("NURE¿A"): sin ella el tapado no reconoce la palabra. */
export const conEnie = (t: string) => t.replace(/(?<=\p{L})¿(?=\p{L})/gu, "Ñ");

export function taparNombrePropio(texto: string | null, nombre: string | null): string | null {
  if (!texto || !nombre) return texto;
  texto = conEnie(texto);
  nombre = conEnie(nombre);
  const p = nombre.trim().split(/\s+/);
  if (p.length < 3) return texto;
  // Por palabras enteras (sin \b: no conoce la Ñ ni las tildes).
  const esc = (w: string[]) => w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const sunat = new RegExp(`(?<!\\p{L})${esc(p)}(?!\\p{L})`, "giu");
  const hablado = new RegExp(`(?<!\\p{L})${esc([...p.slice(2), p[0], p[1]])}(?!\\p{L})`, "giu");
  return texto
    .replace(sunat, [p[0], TAPA_NOMBRE, ...p.slice(2)].join(" "))
    .replace(hablado, [...p.slice(2), p[0], TAPA_NOMBRE].join(" "));
}

// ─── GET /personas/:codigo/perfil ───────────────────────────────────────────────────────────────
/**
 * Lo que la persona es en otros registros públicos, unido por su DNI (que nunca sale de la base): las empresas de las que
 * es socia, representante o directiva (RNP), sus candidaturas y cargos de elección (JNE), sus aportes a partidos (ONPE),
 * sus visitas a entidades, los funcionarios que la declararon como pariente (DJI) y su paso por la planilla (su ficha de
 * planilla, enlazada al refrescar). Cada bloque con su fecha, para la línea de vida que arma la web. Plan 2026-10-27, 1A.
 * Privacidad: del funcionario que la declaró, su entidad, su cargo y su primer apellido (sólo si el parentesco no destapa el
 * apellido tapado de esta persona); de las visitas, el cargo y la oficina visitados (no el nombre de quien la recibió);
 * de las empresas, sólo las de RUC 20.
 */
personasRouter.get("/:codigo/perfil", async (c) => {
  const codigo = c.req.param("codigo");
  if (!CODIGO.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(`perfil:${codigo}`, async () => {
    const p = await pool.query<{ ruc: string }>(`SELECT ruc FROM persona_codigo WHERE codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc || !/^10[0-9]{9}$/.test(ruc)) return null;
    const dni = ruc.slice(2, 10);
    const [empresas, candidaturas, autoridades, aportes, visitas, familia, planilla, entidades, porEntidad, previas] = await Promise.all([
      pool.query(
        `SELECT r.ruc_empresa::text AS ruc, er.nombre, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
                to_char(min(r.fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde,
                (COALESCE(er.adj_monto, 0) + COALESCE(er.ord_monto, 0))::float AS vendido, er.entidades,
                er.inhabilitada, er.estado_sunat AS "estadoSunat", er.n_alta AS "nAlta"
           FROM rnp_conformacion_juridica r LEFT JOIN empresa_resumen er ON er.ruc = r.ruc_empresa::text
          WHERE r.numero_documento = $1 AND r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
          GROUP BY r.ruc_empresa, er.nombre, er.adj_monto, er.ord_monto, er.entidades, er.inhabilitada, er.estado_sunat, er.n_alta
          ORDER BY vendido DESC NULLS LAST, desde LIMIT 60`, [dni]),
      pool.query(
        `SELECT "año" AS anio, partido, cargo, resultado, region, provincia, distrito
           FROM jne_candidaturas WHERE numero_documento = $1 ORDER BY "año" DESC, cargo LIMIT 40`, [dni]),
      pool.query(
        `SELECT cargo, organizacion_politica AS partido, to_char(periodo_inicio, 'YYYY-MM-DD') AS desde,
                to_char(periodo_fin, 'YYYY-MM-DD') AS hasta, vigente, departamento, provincia, distrito
           FROM jne_autoridades WHERE dni = $1 ORDER BY periodo_inicio DESC NULLS LAST LIMIT 20`, [dni]),
      pool.query(
        `SELECT partido, "año" AS anio, to_char(fecha_aporte, 'YYYY-MM-DD') AS fecha, monto::float AS monto, tipo_aporte AS tipo,
                nivel, proceso
           FROM onpe_aportantes WHERE numero_documento = $1 ORDER BY fecha_aporte DESC NULLS LAST, "año" DESC LIMIT 100`, [dni]),
      pool.query(
        `SELECT count(*) OVER ()::int AS total, to_char(fecha_visita, 'YYYY-MM-DD') AS fecha, entidad_visitada AS entidad,
                funcionario_cargo AS cargo, funcionario_area AS area, left(motivo, 160) AS motivo, fuente
           FROM visitas_entidades WHERE numero_documento = $1 ORDER BY fecha_visita DESC NULLS LAST LIMIT 100`, [dni]),
      pool.query<{ entidadRuc: string; entidad: string | null; parentesco: string | null; grado: string | null; declarante: string | null; cargo: string | null; ficha: string | null }>(
        `SELECT v.entidad_ruc AS "entidadRuc", COALESCE(e.nombre, v.entidad_ruc) AS entidad, v.parentesco, v.grado,
                v.declarante_norm AS declarante,
                (SELECT fc.cargo FROM dji_funcionarios fc WHERE fc.codigo_ddjj = v.codigo_ddjj AND fc.cargo IS NOT NULL
                  ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) AS cargo,
                pp.ficha
           FROM (SELECT DISTINCT ON (entidad_ruc, declarante_norm) entidad_ruc, declarante_norm, parentesco, grado, codigo_ddjj
                   FROM dji_vinculos WHERE pariente_doc = $1 AND declarante_norm IS NOT NULL
                  ORDER BY entidad_ruc, declarante_norm, codigo_ddjj) v
           LEFT JOIN entidades e ON e.ruc::text = v.entidad_ruc
           LEFT JOIN planilla_persona pp ON pp.entidad_ruc = v.entidad_ruc AND pp.nombre_norm = v.declarante_norm
          LIMIT 40`, [dni]),
      pool.query(
        `SELECT entidad_ruc AS "entidadRuc", entidad, ficha, cargo, regimen, dependencia, to_char(primer_mes, 'YYYY-MM') AS desde,
                to_char(ultimo_mes, 'YYYY-MM') AS hasta, base::float AS base, n_senales AS "nSenales",
                (SELECT e.id_pte FROM pte_entidad e WHERE e.ruc = planilla_persona.entidad_ruc) AS "idPte"
           FROM planilla_persona WHERE codigo = $1 ORDER BY ultimo_mes DESC NULLS LAST LIMIT 20`, [codigo]),
      pool.query(
        `SELECT entidad_ruc AS "entidadRuc", entidad, to_char(primera, 'YYYY-MM-DD') AS primera, to_char(ultima, 'YYYY-MM-DD') AS ultima,
                ordenes, monto::float AS monto
           FROM persona_entidad WHERE ruc = $1 ORDER BY monto DESC NULLS LAST LIMIT 40`, [ruc]),
      // Para la línea de vida: sus visitas por entidad (todas, no sólo las 100 últimas) y las que precedieron a su primera
      // orden en esa entidad (la señal visita_previa, migración 195).
      pool.query(
        `SELECT entidad_visitada AS entidad, count(*)::int AS n, to_char(min(fecha_visita), 'YYYY-MM-DD') AS primera,
                to_char(max(fecha_visita), 'YYYY-MM-DD') AS ultima, count(*) FILTER (WHERE decisor)::int AS "aQuienDecide"
           FROM visitas_entidades WHERE numero_documento = $1 AND entidad_visitada IS NOT NULL
          GROUP BY entidad_visitada ORDER BY count(*) DESC, min(fecha_visita) LIMIT 12`, [dni]),
      pool.query(
        `SELECT s.entidad_ruc AS "entidadRuc", pe.entidad, s.severidad, s.detalle->>'primera_orden' AS "primeraOrden",
                (SELECT min(v->>'fecha') FROM jsonb_array_elements(s.detalle->'visitas') v) AS "primeraVisita",
                COALESCE((s.detalle->>'n_visitas')::int, jsonb_array_length(s.detalle->'visitas')) AS n,
                COALESCE((s.detalle->>'a_quien_decide')::int, 0) AS "aQuienDecide"
           FROM persona_senal s LEFT JOIN persona_entidad pe ON pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc
          WHERE s.ruc = $1 AND s.tipo = 'visita_previa' AND jsonb_typeof(s.detalle->'visitas') = 'array'
          LIMIT 20`, [ruc]),
    ]);
    const totalVisitas = (visitas.rows[0]?.total as number | undefined) ?? 0;
    return publicar({
      empresas: empresas.rows,
      candidaturas: candidaturas.rows,
      autoridades: autoridades.rows,
      aportes: aportes.rows,
      visitas: {
        total: totalVisitas,
        ultimas: visitas.rows.map(({ total: _t, ...v }) => v),
        hasta: await visitasHasta(),
        porEntidad: porEntidad.rows,
        // Las visitas antes de su primera orden en una entidad: van destacadas en la línea de vida.
        antesDeOrden: previas.rows,
      },
      // Sin el nombre del funcionario (apellidoFuncionario): su primer apellido y su ficha, si el parentesco lo permite.
      familia: familia.rows.map(({ declarante, ficha, ...f }) => {
        const funcionarioApellido = apellidoFuncionario(f.parentesco, declarante);
        return { ...f, funcionarioApellido, ficha: funcionarioApellido ? ficha : null };
      }),
      planilla: planilla.rows,
      entidades: entidades.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /personas/:codigo/ordenes ──────────────────────────────────────────────────────────────
const Ordenes = z.object({
  entidad: z.string().regex(/^\d{11}$/).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  // En la descripción, la entidad o el número de la orden.
  q: z.string().trim().min(2).max(80).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

personasRouter.get("/:codigo/ordenes", async (c) => {
  const codigo = c.req.param("codigo");
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = Ordenes.safeParse(crudos);
  if (!CODIGO.test(codigo) || !parsed.success) return c.json({ error: "not_found" }, 404);
  const q = parsed.data;
  const cuerpo = await fichaMemo.obtener(`ordenes:${codigo}:${JSON.stringify(q)}`, async () => {
    const p = await pool.query<{ ruc: string; nombre: string | null }>(
      `SELECT pc.ruc, (SELECT pe.nombre FROM persona_entidad pe WHERE pe.ruc = pc.ruc LIMIT 1) AS nombre
         FROM persona_codigo pc WHERE pc.codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc) return null;
    const vals: unknown[] = [ruc];
    // Con las de monto dudoso (migración 98): se muestran con su monto original, que no se suma.
    const conds = [`o.ruc_contratista = $1`, `o.tipo_orden = 'Orden de Servicio'`, `o.moneda = 'Nuevos Soles'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`];
    if (q.entidad) { vals.push(q.entidad); conds.push(`o.entidad_ruc = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`o.fecha_emision >= make_date($${vals.length}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`); }
    for (const w of palabrasBusqueda(q.q)) {
      vals.push(`%${w}%`);
      conds.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE $${vals.length}`);
    }
    // Una vez cada orden (un archivo mensual puede repetirla; vale la del más nuevo), como persona_orden_anual.
    const r = await pool.query(
      `WITH o AS (
         SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
           FROM conosce_ordenes o WHERE ${conds.join(" AND ")}
          ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
       SELECT to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.nro_orden AS numero,
              o.orden, o.descripcion, COALESCE(o.monto, o.monto_dudoso)::float AS monto, o.monto_dudoso::float AS "montoDudoso",
              o.dudoso_motivo AS "dudosoMotivo",
              o.tipo_contratacion AS "tipoContratacion", o.estado, servicio_persona(o.descripcion) AS servicio,
              count(*) OVER ()::int AS total
         FROM o ORDER BY o.fecha_emision DESC, o.orden DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, vals);
    const total = r.rows[0]?.total ?? 0;
    // Las descripciones pueden traer el DNI o el nombre de la persona: publicar() los tapa (por eso va su RUC 10 con
    // su nombre: así la reconoce, y el RUC sale como ref).
    return publicar({ persona: { ruc, nombre: p.rows[0]?.nombre ? conEnie(p.rows[0].nombre) : null }, total, page: q.page, size: q.size,
                      data: r.rows.map(({ total: _t, ...f }) => ({ ...f, descripcion: taparNombrePropio(f.descripcion, p.rows[0]?.nombre ?? null) })) });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
