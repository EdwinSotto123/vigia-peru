import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { TAPA_NOMBRE, apellidoFuncionario, apellidosSunat, publicar, reservarParentesco, taparNombreSuelto } from "../lib/privacidad.js";
import { declaranteElectoSql, esCargoDeEleccion, esElectoSql, marcaElecto } from "../lib/electos.js";
import { fichasDeContratada, fichasPorNombre } from "../lib/identidadPersona.js";
import { comprasYFamilia, familiaDelFuncionario, ventasComoExsocio } from "../lib/familiaFuncionario.js";
import { cargoRealDe, cargosEnPlanilla, cobradoEnPlanilla, empleosDeclarados } from "../lib/cargoReal.js";
import { SENALES_CON_PARIENTES, casoReservado, podarParientes } from "../lib/nepotismo.js";
import { enlaceFuente } from "../lib/fuentes.js";
import { motivoPublicable } from "../lib/cruces.js";
import { visitasHasta } from "../lib/visitas.js";
import { personasPorNombreVisible } from "../lib/personasNombre.js";
import { funcionarioDeCodigo, funcionariosPorNombreVisible, mismaPersona, nombreTapado, organizacionPublicable, palabrasDeBusqueda, palabrasRequeridas, parecidosA } from "../lib/funcionarios.js";
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
  // Un informe de control de la Contraloría lo comprende (responsabilidad presunta) y la misma entidad le dio órdenes
  // después de emitido (migración 308).
  "ordenes_tras_informe",
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
        ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC)
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

/** Un año de las órdenes de servicio de una entidad a personas (`resumen.anual`). */
export type AnioPersonas = {
  anio: number;
  /** Personas con al menos una orden ese año. */
  personas: number;
  ordenes: number;
  monto: number;
  /** De esas personas, cuántas tienen alguna señal en esta entidad (persona_entidad.sev), y cuánto se les pagó ese año. */
  conSenal: number;
  montoConSenal: number;
};

/**
 * Lo que la entidad pagó a personas cada año: cuántas, en cuántas órdenes y cuánto, y qué parte fue a quienes tienen
 * alguna señal (persona_orden_anual de la migración 91, por su clave primaria; la señal, de persona_entidad). Es el
 * gráfico «cada año» de la pestaña (pedido del dueño del 2026-11-18: las dos cajas de arriba no decían cuándo). El
 * subselect con OFFSET 0 evalúa el «tiene señal» una vez por fila con el semijoin hasheado.
 *
 * Sólo con el alcance de UNA entidad: EsSalud, la mayor (49 560 personas, 96 mil filas), tarda 0,1 s con la caché
 * caliente y 0,5-0,8 s en frío (PROD, 2026-11-18); el país serían 5,5 M filas (26 s en frío) y una región o un partido,
 * cientos de miles, así que ahí no va (la lista dibuja `porAnio`, ya contado en persona_resumen). Se guarda por entidad,
 * no por los demás filtros (como las facetas); con size=0 (los bloques del Inicio) no se pide. Si tarda o falla, la
 * lista sale igual, sin la serie.
 */
const SQL_ANUAL = `
  SELECT a.anio, count(*)::int AS personas, sum(a.ordenes)::int AS ordenes, COALESCE(sum(a.monto), 0)::float AS monto,
         count(*) FILTER (WHERE a.con)::int AS "conSenal", COALESCE(sum(a.monto) FILTER (WHERE a.con), 0)::float AS "montoConSenal"
    FROM (SELECT o.anio, o.ordenes, o.monto,
                 o.ruc IN (SELECT pe.ruc FROM persona_entidad pe WHERE pe.entidad_ruc = $1 AND pe.sev > 0) AS con
            FROM persona_orden_anual o
           WHERE o.entidad_ruc = $1
          OFFSET 0) a
   GROUP BY a.anio
   ORDER BY a.anio`;
const anualMemo = new Memo<AnioPersonas[]>({ nombre: "personas:anual", ttlMs: 3_600_000, staleMs: 3_600_000, max: 400 });

export function conSerieAnual(q: Pick<ListaQ, "entidad" | "dep" | "partido" | "size">): boolean {
  return !!q.entidad && !q.dep && !q.partido && q.size > 0;
}

async function anualDe(q: ListaQ): Promise<AnioPersonas[] | null> {
  if (!conSerieAnual(q) || !q.entidad) return null;
  const entidad = q.entidad;
  return anualMemo
    .obtener(entidad, async () => (await consultaConPlazo<AnioPersonas>(SQL_ANUAL, [entidad], 8_000)).rows)
    .catch((e) => {
      console.warn(`[personas] anual: ${(e as Error).message}`);
      return null;
    });
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
    // `anual`: lo pagado cada año, sólo en una entidad y con la lista (ver `anualDe`); fuera de eso la clave no va.
    const res = Promise.all([resumenDe(q, [...conds], [...vals]), dudosasDe(q), anualDe(q)])
      .then(([r, dudosas, anual]) => ({ ...r, dudosas, ...(anual ? { anual } : {}) }));
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
    // Si lo buscado parece un nombre (un apellido y un nombre), además de la entidad y el servicio se busca a la PERSONA
    // por su nombre visible (lib/personasNombre.ts): antes no había cómo llegar a una ficha escribiendo el nombre. Sólo
    // en la primera página y en todo el país (dentro de una entidad la lista ya es corta).
    const porNombreP = q.q && q.page === 1 && !q.entidad && !q.dep && !q.partido
      ? personasPorNombreVisible(q.q).catch((e) => { console.warn(`[personas] por nombre: ${(e as Error).message}`); return []; })
      : Promise.resolve([]);
    const [filas, rs, cuenta, facetas, porNombre] = await Promise.all([
      filasP,
      res,
      cuentaP,
      facetasDe(q).catch((e) => { console.warn(`[personas] facetas: ${(e as Error).message}`); return null; }),
      porNombreP,
    ]);
    // Sin conteo (falló): lo que se sabe es que hay al menos lo de esta página y, si vino llena, algo más.
    const vistas = (q.page - 1) * q.size + filas.rows.length;
    const total = cuenta === "fallo" ? vistas + (filas.rows.length === q.size ? 1 : 0) : cuenta ? cuenta.rows[0]?.n ?? 0 : rs.filas;
    const totalExacto = cuenta === "fallo" ? filas.rows.length < q.size : total <= TOPE_CONTEO || !cuenta;
    return publicar({
      total, totalExacto, page: q.page, size: q.size, data: filas.rows.map((f) => ({ ...f, nombre: f.nombre ? conEnie(f.nombre) : f.nombre })), resumen: rs, facetas,
      // Personas cuyo nombre visible coincide con lo buscado: cada una con su ficha.
      porNombre: porNombre.map((p) => ({ ...p, nombre: conEnie(p.nombre) })),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /personas/rastro?q= ───────────────────────────────────
/**
 * Dónde aparece una persona, buscada por su NOMBRE COMPLETO, en todos los registros que Vigía tiene: visitas a entidades
 * (como visitante), empresas en que es socia o representante (RNP), declaraciones juradas de intereses (como
 * declarante), aportes de campaña y personas expuestas políticamente. Pedido del usuario el 2026-11-14: el asistente
 * respondió «ningún registro» de alguien con 6 visitas a 4 entidades, porque ninguna herramienta buscaba visitas por el
 * nombre del visitante. El apellido tapado es para MOSTRAR; para buscar se usa el nombre entero.
 *
 * Sólo para el MCP (cabecera interna, como /gobserva/interno/consumo): por la API pública permitiría confirmar a quién
 * corresponde un nombre tapado. La respuesta sale con un apellido tapado y sin ningún documento. Se pide un apellido y
 * un nombre como mínimo (dos palabras de 3 letras o más), y cada lista tiene tope.
 */
const Rastro = z.object({ q: z.string().trim().min(6).max(80) });
const rastroMemo = new Memo<Record<string, unknown>>({ nombre: "personas:rastro", ttlMs: 600_000, max: 300 });

/** Una palabra del nombre como patrón de LIKE: mayúsculas, sin tildes, y «_» donde la base puede tener Ñ o una vocal con tilde. */
function patronPalabra(w: string): string {
  const base = w.toUpperCase().normalize("NFD").replace(/N\u0303/g, "_").replace(/\p{M}/gu, "").replace(/[%\\]/g, "");
  return `%${base.replace(/[^A-Z_]/g, "_")}%`;
}

personasRouter.get("/rastro", async (c) => {
  const esperado = (c.env as { MCP_INTERNO_TOKEN?: string } | undefined)?.MCP_INTERNO_TOKEN ?? process.env.MCP_INTERNO_TOKEN ?? "";
  const llega = Buffer.from(c.req.header("x-vigia-interno") ?? "");
  const clave = Buffer.from(esperado);
  if (!esperado || llega.length !== clave.length || !timingSafeEqual(llega, clave)) return c.json({ error: "forbidden" }, 403);
  const parsed = Rastro.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  if (/\d/.test(parsed.data.q)) return c.json({ error: "invalid_query", detail: "No se busca por DNI, RUC ni números: escribe el nombre." }, 400);
  const palabras = [...new Set(parsed.data.q.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 3))].slice(0, 6);
  if (palabras.length < 2) return c.json({ error: "invalid_query", detail: "Escribe al menos un apellido y un nombre." }, 400);
  const cuerpo = await rastroMemo.obtener(palabras.map(patronPalabra).join("|"), async () => {
    // Quien además tiene cargo público lleva el enlace a su ficha de rastro (migración 318).
    const [rastro, conCargo] = await Promise.all([
      armarRastro(palabras),
      consultaConPlazo<{ codigo: string; paterno: string; nombres: string; cargo: string | null; entidad: string | null; declaraciones: number }>(
        `SELECT f.codigo, f.paterno, f.nombres, f.cargo, f.entidad, f.declaraciones FROM funcionario_resumen f
          WHERE (SELECT bool_and(f.nombre_norm LIKE p) FROM unnest($1::text[]) p) ORDER BY f.declaraciones DESC LIMIT 5`,
        [palabras.map(patronPalabra)], 6000).then((r) => r.rows).catch(() => []),
    ]);
    return {
      ...rastro,
      con_cargo_publico: conCargo.map(({ paterno, nombres, ...f }) => ({ ...f, nombre: nombreTapado(paterno, nombres) })),
    };
  });
  c.header("Cache-Control", "private, no-store");
  return c.json(cuerpo);
});

/**
 * El rastro de una persona en todos los registros. `palabras`: las que TIENEN que estar en el nombre de cada fila.
 * `acepta`: además, la fila sólo cuenta si su nombre pasa esta prueba (la ficha pública exige que sea la misma persona:
 * `mismaPersona`). Cada lista sale con el nombre de su registro con un apellido tapado.
 */
async function armarRastro(palabras: string[], acepta?: (nombre: string) => boolean) {
  const pats = palabras.map(patronPalabra);
  const solo = <T extends { nombre: string }>(filas: T[] | null): T[] | null => (filas && acepta ? filas.filter((f) => acepta(f.nombre)) : filas);
  {
    // Todas las palabras tienen que estar en el nombre (en cualquier orden): cada tabla tiene índice de trigramas.
    const todas = (col: string) => pats.map((_, i) => `${col} LIKE $${i + 1}`).join(" AND ");
    const intento = <T extends Record<string, unknown>>(sql: string) =>
      consultaConPlazo<T>(sql, pats, 8000).then((r) => r.rows).catch(() => null);
    // Los registros que guardan el nombre como lo escribió su fuente (RNP, ONPE, informes de control) pueden traer «Ñ»
    // donde el nombre de la ficha, ya normalizado, trae «N»: ahí la «N» vale por cualquier letra. Sólo con `acepta`, que
    // después exige el nombre exacto (sin él, la búsqueda se abriría de más).
    const patsCrudos = acepta ? pats.map((p) => p.replace(/N/g, "_")) : pats;
    const intentoCrudo = <T extends Record<string, unknown>>(sql: string) =>
      consultaConPlazo<T>(sql, patsCrudos, 8000).then((r) => r.rows).catch(() => null);
    // Las órdenes de persona natural van por apellidos exactos (índice ap1, ap2): cada palabra buscada puede ser un apellido.
    const exactas = [...new Set(palabras.flatMap((w) => {
      const sinTilde = w.toUpperCase().normalize("NFD").replace(/N\u0303/g, "Ñ").replace(/\p{M}/gu, "");
      return [sinTilde, sinTilde.replace(/Ñ/g, "N")];
    }))];
    const ordenes = palabras.length >= 3
      ? consultaConPlazo<{ nombre: string; codigo: string | null; entidad: string; entidad_ruc: string; ordenes: number; monto: number; primera: string; ultima: string; servicio: string | null }>(
          `SELECT max(o.nombre) AS nombre, max(pc.codigo) AS codigo, max(o.entidad) AS entidad, o.entidad_ruc, sum(o.ordenes)::int AS ordenes,
                  sum(o.monto)::float AS monto, to_char(min(o.primera), 'YYYY-MM-DD') AS primera, to_char(max(o.ultima), 'YYYY-MM-DD') AS ultima,
                  max(o.servicio) AS servicio
             FROM persona_orden_anual o LEFT JOIN persona_codigo pc ON pc.ruc = o.ruc
            WHERE o.ap1 = ANY($1::text[]) AND o.ap2 = ANY($1::text[])
              AND (SELECT bool_and(upper(o.nombre) LIKE p) FROM unnest($2::text[]) p)
            GROUP BY o.ruc, o.entidad_ruc ORDER BY 6 DESC NULLS LAST LIMIT 40`, [exactas, pats], 8000).then((r) => solo(r.rows)).catch(() => null)
      : Promise.resolve([]);
    const [visitas, rnp, dji, aportes, peps, salidas] = (await Promise.all([
      intento<{ nombre: string; entidad: string; entidad_ruc: string | null; visitas: number; primera: string; ultima: string;
                en_nombre_de: string[] | null; a_quien: string[] | null; motivos: string[] | null }>(
        `SELECT v.visitante_norm AS nombre, v.entidad_visitada AS entidad,
                (SELECT r.ruc FROM visita_entidad_ruc r WHERE r.entidad_visitada = v.entidad_visitada LIMIT 1) AS entidad_ruc,
                count(*)::int AS visitas, to_char(min(v.fecha_visita), 'YYYY-MM-DD') AS primera, to_char(max(v.fecha_visita), 'YYYY-MM-DD') AS ultima,
                (array_agg(DISTINCT v.entidad_visitante) FILTER (WHERE COALESCE(v.entidad_visitante, '') <> ''
                                                                    AND v.tipo_entidad_visitante IS DISTINCT FROM 'persona_natural'))[1:4] AS en_nombre_de,
                (array_agg(DISTINCT concat_ws(', ', NULLIF(v.funcionario_cargo, ''), NULLIF(v.funcionario_area, '')))
                   FILTER (WHERE COALESCE(v.funcionario_cargo, v.funcionario_area, '') <> ''))[1:5] AS a_quien,
                (array_agg(DISTINCT left(v.motivo, 90)) FILTER (WHERE COALESCE(v.motivo, '') <> ''))[1:4] AS motivos
           FROM visitas_entidades v WHERE ${todas("v.visitante_norm")}
          GROUP BY 1, 2 ORDER BY 1, count(*) DESC LIMIT 60`),
      intentoCrudo<{ nombre: string; ruc: string; empresa: string | null; rol: string | null; desde: string | null }>(
        `SELECT DISTINCT ON (r.nombre, r.ruc_empresa, r.tipo_rol) r.nombre, r.ruc_empresa AS ruc, e.nombre AS empresa, r.tipo_rol AS rol,
                to_char(r.fecha_inicio_vigencia, 'YYYY-MM-DD') AS desde
           FROM rnp_conformacion_juridica r LEFT JOIN empresa_resumen e ON e.ruc = r.ruc_empresa
          WHERE ${todas("r.nombre")} AND r.ruc_empresa LIKE '20%' ORDER BY r.nombre, r.ruc_empresa, r.tipo_rol LIMIT 40`),
      intento<{ nombre: string; entidad: string | null; cargo: string | null; presentada: string | null; inicio: string | null; cese: string | null }>(
        `SELECT DISTINCT ON (d.nombre_norm, d.entidad, d.cargo) d.nombre_norm AS nombre, d.entidad, d.cargo,
                left(d.fecha_presentacion::text, 10) AS presentada, left(d.fecha_inicio_cargo::text, 10) AS inicio, left(d.fecha_cese_cargo::text, 10) AS cese
           FROM dji_funcionarios d WHERE ${todas("d.nombre_norm")} ORDER BY d.nombre_norm, d.entidad, d.cargo, d.fecha_presentacion DESC LIMIT 40`),
      intentoCrudo<{ nombre: string; partido: string | null; anio: number | null; monto: number | null; aportes: number }>(
        `SELECT upper(a.nombre) AS nombre, a.partido, a.año AS anio, sum(a.monto)::float AS monto, count(*)::int AS aportes
           FROM onpe_aporte_unico a WHERE ${todas("upper(a.nombre)")} GROUP BY 1, 2, 3 ORDER BY 3 DESC NULLS LAST LIMIT 40`),
      intento<{ nombre: string; cargo: string | null; entidad: string | null; desde: number | null; hasta: number | null }>(
        `SELECT p.nombre_norm AS nombre, p.cargo, p.entidad, p.año_desde AS desde, p.año_hasta AS hasta
           FROM peps p WHERE ${todas("p.nombre_norm")} ORDER BY p.año_desde DESC NULLS LAST LIMIT 20`),
      // Quien dejó la planilla de una entidad (las salidas se registran desde 2025).
      intento<{ nombre: string; entidad: string | null; entidad_ruc: string; cargo: string | null; dependencia: string | null; desde: string | null; hasta: string }>(
        `SELECT s.nombre_norm AS nombre, (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = s.entidad_ruc) AS entidad, s.entidad_ruc,
                max(s.cargo) AS cargo, max(s.dependencia) AS dependencia, to_char(min(s.primer_mes), 'YYYY-MM') AS desde, to_char(max(s.ultimo_mes), 'YYYY-MM') AS hasta
           FROM planilla_salida s WHERE ${todas("s.nombre_norm")} GROUP BY s.nombre_norm, s.entidad_ruc ORDER BY 7 DESC LIMIT 20`),
    ])).map((l) => solo(l as { nombre: string }[] | null)) as [
      { nombre: string; entidad: string; entidad_ruc: string | null; visitas: number; primera: string; ultima: string;
        en_nombre_de: string[] | null; a_quien: string[] | null; motivos: string[] | null }[] | null,
      { nombre: string; ruc: string; empresa: string | null; rol: string | null; desde: string | null }[] | null,
      { nombre: string; entidad: string | null; cargo: string | null; presentada: string | null; inicio: string | null; cese: string | null }[] | null,
      { nombre: string; partido: string | null; anio: number | null; monto: number | null; aportes: number }[] | null,
      { nombre: string; cargo: string | null; entidad: string | null; desde: number | null; hasta: number | null }[] | null,
      { nombre: string; entidad: string | null; entidad_ruc: string; cargo: string | null; dependencia: string | null; desde: string | null; hasta: string }[] | null,
    ];
    // El motivo en texto libre puede nombrar a otras personas: sale la categoría del registro o su clase.
    for (const v of visitas ?? []) {
      v.motivos = v.motivos ? [...new Set(v.motivos.map((m) => motivoPublicable(m)).filter((m): m is string => !!m))] : null;
    }
    // El cruce que busca un investigador: la persona visitó una entidad y una empresa SUYA (es socia o representante) le
    // ganó procesos a esa misma entidad. Con las fechas, para ver si la visita fue antes de la buena pro.
    let visitoYGano: Record<string, unknown>[] = [];
    const rucsEmp = [...new Set((rnp ?? []).map((x) => x.ruc))];
    const rucsEnt = [...new Set((visitas ?? []).map((x) => x.entidad_ruc).filter((x): x is string => !!x))];
    if (rucsEmp.length && rucsEnt.length) {
      const g = await consultaConPlazo<{ empresa_ruc: string; entidad_ruc: string; entidad: string; procesos: number; monto: number | null; primera: string; ultima: string }>(
        `SELECT a.ruc_proveedor AS empresa_ruc, a.entidad_ruc, max(a.entidad) AS entidad, count(DISTINCT a.codigo_convocatoria)::int AS procesos,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))::float AS monto,
                to_char(min(a.fecha_buenapro), 'YYYY-MM-DD') AS primera, to_char(max(a.fecha_buenapro), 'YYYY-MM-DD') AS ultima
           FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = ANY($1::text[]) AND a.entidad_ruc = ANY($2::text[])
          GROUP BY 1, 2 ORDER BY 5 DESC NULLS LAST LIMIT 40`, [rucsEmp, rucsEnt], 8000).then((r) => r.rows).catch(() => []);
      visitoYGano = g.map((x) => {
        const v = (visitas ?? []).filter((y) => y.entidad_ruc === x.entidad_ruc);
        const primeraVisita = v.map((y) => y.primera).sort()[0] ?? null;
        return {
          entidad: x.entidad, entidad_ruc: x.entidad_ruc, empresa_ruc: x.empresa_ruc,
          empresa: (rnp ?? []).find((y) => y.ruc === x.empresa_ruc)?.empresa ?? null,
          rol_en_la_empresa: (rnp ?? []).find((y) => y.ruc === x.empresa_ruc)?.rol ?? null,
          visitas: v.reduce((s, y) => s + y.visitas, 0), primera_visita: primeraVisita, ultima_visita: v.map((y) => y.ultima).sort().pop() ?? null,
          procesos_ganados: x.procesos, monto_soles: x.monto, primera_buena_pro: x.primera, ultima_buena_pro: x.ultima,
          visito_antes_de_ganar: primeraVisita != null && primeraVisita <= x.ultima,
        };
      });
    }
    // Puerta giratoria: salió de la planilla de una entidad y una empresa SUYA le ganó después a esa misma entidad. El
    // empate entre la planilla y el RNP es por nombre: se dice, para que se confirme.
    let salioYGano: Record<string, unknown>[] = [];
    const rucsSal = [...new Set((salidas ?? []).map((x) => x.entidad_ruc))];
    if (rucsEmp.length && rucsSal.length) {
      const g = await consultaConPlazo<{ empresa_ruc: string; entidad_ruc: string; codigo: string; fecha: string; monto: number | null }>(
        `SELECT a.ruc_proveedor AS empresa_ruc, a.entidad_ruc, a.codigo_convocatoria AS codigo, to_char(max(a.fecha_buenapro), 'YYYY-MM-DD') AS fecha,
                sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))::float AS monto
           FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = ANY($1::text[]) AND a.entidad_ruc = ANY($2::text[])
          GROUP BY 1, 2, 3 ORDER BY 4 LIMIT 200`, [rucsEmp, rucsSal], 8000).then((r) => r.rows).catch(() => []);
      salioYGano = (salidas ?? []).flatMap((s) => {
        const despues = g.filter((x) => x.entidad_ruc === s.entidad_ruc && x.fecha > `${s.hasta}-31`);
        return [...new Set(despues.map((x) => x.empresa_ruc))].map((ruc) => {
          const suyos = despues.filter((x) => x.empresa_ruc === ruc);
          const emp = (rnp ?? []).find((y) => y.ruc === ruc);
          return {
            entidad: s.entidad, entidad_ruc: s.entidad_ruc, cargo_que_tenia: s.cargo, salio_de_planilla: s.hasta,
            empresa: emp?.empresa ?? null, empresa_ruc: ruc, rol_en_la_empresa: emp?.rol ?? null, en_la_empresa_desde: emp?.desde ?? null,
            procesos_ganados_despues: suyos.length, monto_soles: suyos.reduce((t, x) => t + (x.monto ?? 0), 0),
            primera_buena_pro_tras_salir: suyos[0]?.fecha ?? null, empate: "por nombre completo: confirmar que es la misma persona",
          };
        });
      });
    }
    // Red de la persona (migraciones 292 y 293): dos o más empresas SUYAS ganan en la misma entidad procesos de objeto
    // parecido. Se exige que al menos dos de las empresas del grupo sean de esta persona, para no traer el grupo de otro socio.
    let variasEmpresas: Record<string, unknown>[] = [];
    if (rucsEmp.length >= 2) {
      variasEmpresas = await consultaConPlazo<Record<string, unknown>>(
        `SELECT g.entidad_ruc, (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = g.entidad_ruc) AS entidad, g.empresas, g.contratos AS contratos_con_objeto_parecido,
                g.seguidos AS con_90_dias_o_menos_entre_si, g.monto::float AS monto_soles, to_char(g.desde, 'YYYY-MM-DD') AS desde, to_char(g.hasta, 'YYYY-MM-DD') AS hasta,
                g.ejemplos AS ejemplos_ocid
           FROM mismo_dueno_grupo g
          WHERE g.rucs && $1::text[] AND (SELECT count(*) FROM unnest(g.rucs) u WHERE u = ANY($1::text[])) >= 2
          ORDER BY g.seguidos DESC, g.contratos DESC LIMIT 20`, [rucsEmp], 6000).then((r) => r.rows).catch(() => []);
    }
    // Una empresa SUYA está inhabilitada y OTRA empresa suya ganó buenas pro dentro de la sanción (migración 297, vista
    // desde la persona). Las dos empresas tienen que ser de la misma fila del RNP (el mismo nombre completo), para no
    // juntar a dos homónimos. Si ganó en consorcio, el monto es el del proceso entero.
    let inhabilitadaYGano: Record<string, unknown>[] = [];
    if (rucsEmp.length >= 2) {
      const g = await consultaConPlazo<{ sancionada_ruc: string; sancionada: string | null; sancion: string; desde: string; hasta: string | null;
                                         empresa_ruc: string; procesos: number; monto: number | null; primera: string; ultima: string }>(
        // De las banderas ya calculadas (cruces_proveedor): traen también lo ganado dentro de un consorcio y las fechas de
        // ingreso del socio ya revisadas.
        `SELECT c.detalle->>'sancionada_ruc' AS sancionada_ruc, max(c.detalle->>'sancionada') AS sancionada, max(c.detalle->>'sancion') AS sancion,
                min(c.detalle->>'sancion_desde') AS desde, max(c.detalle->>'sancion_hasta') AS hasta, c.ruc_empresa::text AS empresa_ruc,
                count(DISTINCT c.ocid)::int AS procesos, sum(c.monto)::float AS monto,
                to_char(min(c.fecha), 'YYYY-MM-DD') AS primera, to_char(max(c.fecha), 'YYYY-MM-DD') AS ultima
           FROM cruces_proveedor c
          WHERE c.tipo = 'socio_de_inhabilitada' AND c.ruc_empresa = ANY($1::text[]) AND c.detalle->>'sancionada_ruc' = ANY($1::text[])
          GROUP BY 1, 6 ORDER BY 7 DESC LIMIT 40`, [rucsEmp], 8000).then((r) => r.rows).catch(() => []);
      const nombresDe = (ruc: string) => new Set((rnp ?? []).filter((y) => y.ruc === ruc).map((y) => y.nombre));
      inhabilitadaYGano = g.flatMap((x) => {
        const enSancionada = nombresDe(x.sancionada_ruc);
        const mismo = (rnp ?? []).find((y) => y.ruc === x.empresa_ruc && enSancionada.has(y.nombre));
        if (!mismo) return [];
        const enLaSancionada = (rnp ?? []).find((y) => y.ruc === x.sancionada_ruc && y.nombre === mismo.nombre);
        return [{
          empresa_inhabilitada: x.sancionada, empresa_inhabilitada_ruc: x.sancionada_ruc, rol_en_la_inhabilitada: enLaSancionada?.rol ?? null,
          sancion: x.sancion === "definitivo" ? "inhabilitación definitiva" : "inhabilitación temporal", sancion_desde: x.desde, sancion_hasta: x.hasta,
          empresa_que_gano: mismo.empresa, empresa_que_gano_ruc: x.empresa_ruc, rol_en_la_que_gano: mismo.rol, en_la_que_gano_desde: mismo.desde,
          procesos_ganados_durante_la_sancion: x.procesos, monto_soles: x.monto, primera_buena_pro: x.primera, ultima_buena_pro: x.ultima,
          falta_confirmar: "que sea la misma persona (el empate es por nombre completo), su porcentaje en las dos empresas y que sean del mismo rubro",
        }];
      });
    }
    // Informes de control de la Contraloría en que figura como funcionario comprendido, con responsabilidad PRESUNTA
    // (migración 302; la vista no trae documento: el empate es por nombre completo y se dice).
    const control = solo(await intentoCrudo<{ nombre: string; codigo: string; numero: string | null; titulo: string | null; entidad: string | null;
                                    entidad_ruc: string | null; fecha: string | null; responsabilidades: string[]; ficha: string | null }>(
      `SELECT p.nombre, i.codigo, i.numero, left(i.titulo, 220) AS titulo, i.entidad_nombre AS entidad, btrim(i.entidad_ruc) AS entidad_ruc,
              to_char(coalesce(i.fecha_emision, i.fecha_publicacion), 'YYYY-MM-DD') AS fecha, p.responsabilidades, i.url_resumen AS ficha
         FROM informe_control_implicado p JOIN informes_control i ON i.codigo = p.codigo
        WHERE ${todas("p.nombre")} ORDER BY 7 DESC NULLS LAST LIMIT 40`));
    // Y el cruce: figura en un informe de una entidad y esa MISMA entidad le siguió dando órdenes después (migración 308,
    // vista aquí por nombre). Las órdenes vienen por año: cuenta si la última es posterior al informe.
    const ordenesFilas = (await ordenes) ?? [];
    const enInformeYCobro = (control ?? []).flatMap((x) => {
      if (!x.entidad_ruc || !x.fecha) return [];
      const o = ordenesFilas.find((y) => y.entidad_ruc === x.entidad_ruc && y.ultima > x.fecha!);
      return o ? [{
        entidad: x.entidad, entidad_ruc: x.entidad_ruc, informe: x.numero ?? x.codigo, fecha_del_informe: x.fecha,
        responsabilidad_presunta: x.responsabilidades, ordenes_de_esa_entidad: o.ordenes, monto_soles: o.monto,
        primera_orden: o.primera, ultima_orden: o.ultima, ficha: x.ficha,
        falta_confirmar: "que sea la misma persona (el empate es por nombre completo) y cuántas de esas órdenes son posteriores al informe",
      }] : [];
    });
    // Cada fila lleva el nombre como está en su registro, con un apellido tapado: dos personas distintas que comparten
    // las palabras buscadas se ven como dos nombres.
    const tapar = <T extends { nombre: string }>(filas: T[] | null) =>
      filas?.map((f) => ({ ...f, nombre: taparNombrePropio(f.nombre, f.nombre) ?? f.nombre })) ?? null;
    return {
      buscado: palabras.length,
      // Los visitantes van en el orden que escribió cada portería: se decide por pesos cuál es el apellido que se tapa.
      visitas: visitas?.map((f) => ({ ...f, nombre: taparNombreSuelto(f.nombre) })) ?? null,
      empresas: tapar(rnp),
      declaraciones_juradas: tapar(dji),
      aportes_de_campana: tapar(aportes),
      personas_expuestas: tapar(peps),
      ordenes_como_persona_natural: tapar(ordenesFilas.length ? ordenesFilas : await ordenes),
      visito_y_su_empresa_gano: visitoYGano,
      salidas_de_planilla: tapar(salidas),
      salio_de_la_entidad_y_su_empresa_gano: salioYGano,
      gana_en_la_misma_entidad_con_varias_empresas: variasEmpresas,
      empresa_suya_inhabilitada_y_otra_gano: inhabilitadaYGano,
      informes_de_control: tapar(control),
      en_informe_de_control_y_despues_cobro: enInformeYCobro,
      sin_respuesta: [["visitas", visitas], ["empresas", rnp], ["declaraciones_juradas", dji], ["aportes_de_campana", aportes], ["personas_expuestas", peps]]
        .filter(([, v]) => v === null).map(([k]) => k as string),
    };
  }
}

const CODIGO = /^[0-9a-f]{12}$/;

// ─── GET /personas/buscar?q= ────────────────────────────────────────────────────────────────────
/**
 * Buscar a una PERSONA por su nombre en todos los registros que tienen ficha (pedido del dueño del 2026-11-16: alguien con
 * un cargo de poder «no aparece en la BBDD»; estaba, pero sólo se llegaba a quien recibió órdenes): quien tiene cargo
 * público —presentó declaraciones juradas de intereses o está o estuvo en una planilla del Estado (migraciones 318 y
 * 319)— y quien recibió órdenes o ganó procesos. Sólo por lo que se VE del nombre (apellido paterno y nombres): el
 * apellido tapado no se busca.
 */
const buscarMemo = new Memo<Record<string, unknown>>({ nombre: "personas:buscar", ttlMs: 600_000, staleMs: 600_000, max: 400 });

personasRouter.get("/buscar", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const palabras = palabrasDeBusqueda(q);
  c.header("Cache-Control", CACHE);
  if (palabras.length < 2) return c.json({ q, falta: "Escribe un apellido y un nombre.", conCargo: [], contratadas: [] });
  const cuerpo = await buscarMemo.obtener(palabras.join(" "), async (ctl) => {
    // Una búsqueda que falló (tiempo agotado, base ocupada) no es «nadie se llama así»: se dice en `sinRespuesta` y esa
    // respuesta no se guarda en ninguna caché. Antes quedaba vacía 20 minutos en memoria y en el borde.
    const sinRespuesta: string[] = [];
    const fallo = (que: string) => (err: unknown) => {
      console.warn(`[personas:buscar] ${que}: ${(err as Error).message}`);
      sinRespuesta.push(que);
      return [];
    };
    const [conCargo, contratadas] = await Promise.all([
      funcionariosPorNombreVisible(q, 25).catch(fallo("conCargo")),
      // Hasta 30: quien escribe el nombre completo trae también a quienes coinciden por el otro apellido, y no deben
      // sacar de la lista a la persona buscada.
      personasPorNombreVisible(q, 30).catch(fallo("contratadas")),
    ]);
    if (sinRespuesta.length) ctl.noGuardar();
    return publicar({ q, conCargo, contratadas, ...(sinRespuesta.length ? { sinRespuesta } : {}) });
  });
  const b = cuerpo as { sinRespuesta?: string[]; conCargo?: unknown[]; contratadas?: unknown[] };
  if ((b.sinRespuesta ?? []).length) c.header("Cache-Control", "no-store");
  // «Nadie se llama así» se guarda un minuto, no una hora: recalcularlo es barato y un vacío equivocado guardado en el
  // borde le dice a quien investiga que alguien no tiene cargo público cuando sí lo tiene (visto el 2026-11-19).
  else if (!(b.conCargo ?? []).length && !(b.contratadas ?? []).length) c.header("Cache-Control", cachePublico(60, { maxAge: 30, swr: 120 }));
  return c.json(cuerpo);
});

// ─── GET /personas/cargo/:codigo ────────────────────────────────────────────────────────────────
/**
 * La ficha de rastro de una persona con cargo público (migración 318): los cargos que declaró a la Contraloría y dónde más
 * aparece — las visitas que hizo a otras entidades, las empresas en que es socia o representante, la planilla, sus
 * órdenes, sus aportes de campaña y los informes de control que la comprenden (responsabilidad presunta) —, con los
 * cruces entre esos registros ya hechos (visitó una entidad y una empresa suya le ganó; salió de la planilla y una
 * empresa suya le ganó después).
 *
 * Es pública, así que: el nombre sale UNA sola vez y con el apellido materno tapado (las filas de cada registro no llevan
 * nombre: cada registro lo taparía a su modo y dos versiones lo dirían entero); lo que representaba en una visita sólo si
 * es una organización; sin motivos de visita (texto libre); sin documentos. El empate con los otros registros es por
 * nombre completo (`mismaPersona`) y la ficha lo avisa.
 */
const cargoMemo = new Memo<Record<string, unknown> | null>({ nombre: "personas:cargo", ttlMs: 600_000, staleMs: 600_000, max: 400 });

personasRouter.get("/cargo/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!CODIGO.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await cargoMemo.obtener(codigo, async (ctl) => {
    const f = await funcionarioDeCodigo(codigo);
    if (!f) return null;
    const esEl = mismaPersona(f);
    const orgOk = organizacionPublicable(f);
    const requeridas = palabrasRequeridas(f);
    const [cargos, planilla, rastro, parecidos, candidaturas, recibidas] = await Promise.all([
      // Cada cargo que declaró, por entidad: desde cuándo, hasta cuándo y cuántas declaraciones lo respaldan.
      pool.query(
        `SELECT d.entidad, (SELECT r.ruc FROM dji_entidad_ruc r WHERE r.entidad = d.entidad) AS "entidadRuc", NULLIF(btrim(d.cargo), '') AS cargo,
                count(DISTINCT d.codigo_ddjj)::int AS declaraciones,
                to_char(min(fecha_dji(d.fecha_inicio_cargo)), 'YYYY-MM-DD') AS inicio,
                to_char(max(fecha_dji(d.fecha_cese_cargo)), 'YYYY-MM-DD') AS cese,
                bool_or(COALESCE(btrim(d.fecha_cese_cargo), '') = '') AS "sinCese",
                to_char(min(fecha_dji(d.fecha_presentacion)), 'YYYY-MM-DD') AS primera,
                to_char(max(fecha_dji(d.fecha_presentacion)), 'YYYY-MM-DD') AS ultima
           FROM dji_funcionarios d WHERE d.nombre_norm = $1
          GROUP BY d.entidad, NULLIF(btrim(d.cargo), '') ORDER BY max(fecha_dji(d.fecha_presentacion)) DESC NULLS LAST, 1 LIMIT 80`, [f.nombreNorm]),
      // Su planilla, por nombre exacto (se escribe igual que en la DJI): la de hoy, con el enlace a esa ficha, y las
      // entidades en que ya no figura. Con el último mes que publicó cada entidad: «no figura» puede ser que la entidad
      // publicó un mes incompleto, no que la persona se fue.
      consultaConPlazo<Record<string, unknown>>(
        `SELECT x.*, (SELECT to_char(max(m.mes), 'YYYY-MM') FROM planilla_entidad_mes m WHERE m.entidad_ruc = x."entidadRuc") AS "ultimoMesEntidad"
           FROM (
             SELECT 'hoy' AS situacion, p.ficha, p.entidad, p.entidad_ruc AS "entidadRuc", p.cargo, p.dependencia, p.regimen, p.base::float AS base, p.meses,
                    to_char(p.primer_mes, 'YYYY-MM') AS "primerMes", to_char(p.ultimo_mes, 'YYYY-MM') AS "ultimoMes"
               FROM planilla_persona p WHERE p.nombre_norm = $1
             UNION ALL
             SELECT 'antes', NULL, (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = s.entidad_ruc), s.entidad_ruc, s.cargo, s.dependencia, s.regimen,
                    s.base::float, s.meses, to_char(s.primer_mes, 'YYYY-MM'), to_char(s.ultimo_mes, 'YYYY-MM')
               FROM planilla_salida s WHERE s.nombre_norm = $1
           ) x ORDER BY x.situacion DESC, x."ultimoMes" DESC NULLS LAST LIMIT 30`, [f.nombreNorm], 8000)
        .then((r) => r.rows).catch(() => null),
      armarRastro(requeridas, esEl),
      parecidosA(f).catch(() => 0),
      // Sus candidaturas (JNE, desde 2014): a qué postuló, con qué organización y si salió electa.
      consultaConPlazo<{ nombre: string; anio: number | null; cargo: string | null; partido: string | null; resultado: string | null;
                         region: string | null; provincia: string | null; distrito: string | null }>(
        `SELECT c.nombre, c."año" AS anio, c.cargo, c.partido, c.resultado, c.region, c.provincia, c.distrito
           FROM jne_candidaturas c WHERE ${requeridas.map((_, i) => `upper(c.nombre) LIKE $${i + 1}`).join(" AND ")}
          ORDER BY c."año" DESC NULLS LAST LIMIT 80`, requeridas.map((w) => patronPalabra(w).replace(/N/g, "_")), 8000)
        .then((r) => r.rows.filter((x) => esEl(x.nombre)).map(({ nombre: _n, ...x }) => x))
        .catch(() => null),
      // Las empresas cuya gente lo visitó (migración 335): sólo en las entidades en que declaró un cargo o figuró en
      // planilla, para no mezclarlo con un homónimo de otra entidad. Con cuántos procesos le ganó después cada empresa a
      // esa entidad (sola, desde su primera visita). Nunca quién visitó.
      consultaConPlazo<{ entidadRuc: string; entidad: string | null; ruc: string; empresa: string | null; visitas: number; primera: string | null;
                         ultima: string | null; ganoDespues: number; montoDespues: number | null; primeraBuenaPro: string | null }>(
        `WITH ents AS (
           SELECT r.ruc FROM dji_funcionarios d JOIN dji_entidad_ruc r ON r.entidad = d.entidad
            WHERE d.nombre_norm = $1 AND r.como NOT IN ('trigramas', 'empleo_actual')
           UNION SELECT p.entidad_ruc FROM planilla_persona p WHERE p.nombre_norm = $1
           UNION SELECT s.entidad_ruc FROM planilla_salida s WHERE s.nombre_norm = $1)
         SELECT k.entidad_ruc AS "entidadRuc", (SELECT es.nombre FROM entidad_stats es WHERE es.ruc = k.entidad_ruc) AS entidad,
                k.ruc, COALESCE(er.nombre, e.razon_social) AS empresa, k.visitas, to_char(k.primera, 'YYYY-MM-DD') AS primera,
                to_char(k.ultima, 'YYYY-MM-DD') AS ultima, COALESCE(g.procesos, 0) AS "ganoDespues", g.monto AS "montoDespues",
                to_char(g.primera_bp, 'YYYY-MM-DD') AS "primeraBuenaPro"
           FROM funcionario_visita_empresa k
           LEFT JOIN empresa_resumen er ON er.ruc = k.ruc
           LEFT JOIN empresas e ON e.ruc = k.ruc::char(11)
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT a.codigo_convocatoria)::int AS procesos, min(a.fecha_buenapro) AS primera_bp,
                    (sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')))::float AS monto
               FROM conosce_adjudicaciones a
              WHERE a.ruc_proveedor = k.ruc AND a.entidad_ruc = k.entidad_ruc AND a.fecha_buenapro >= k.primera) g ON true
          WHERE k.llave = nombre_llave($1) AND k.entidad_ruc IN (SELECT ruc FROM ents)
          ORDER BY COALESCE(g.procesos, 0) DESC, k.visitas DESC LIMIT 80`, [f.nombreNorm], 8000)
        .then((r) => r.rows).catch(() => null),
    ]);
    // Las visitas se buscan por palabras (índice de trigramas sobre 12 M de filas): con un nombre muy común puede no
    // responder a tiempo. Entonces, por el nombre exacto en sus formas más usadas (índice btree): apellidos y nombres,
    // nombres y apellidos, y las dos con sólo el primer nombre. Trae menos que la otra, pero no deja la ficha sin visitas.
    let visitasDe = rastro.visitas;
    if (visitasDe === null) {
      const primerNombre = f.nombres.split(" ")[0];
      const apellidos = [f.paterno, f.materno ?? ""].filter(Boolean).join(" ");
      const formas = [...new Set([`${apellidos} ${f.nombres}`, `${f.nombres} ${apellidos}`, `${apellidos} ${primerNombre}`, `${primerNombre} ${apellidos}`])];
      visitasDe = await consultaConPlazo<NonNullable<typeof rastro.visitas>[number]>(
        `SELECT v.visitante_norm AS nombre, v.entidad_visitada AS entidad,
                (SELECT r.ruc FROM visita_entidad_ruc r WHERE r.entidad_visitada = v.entidad_visitada LIMIT 1) AS entidad_ruc,
                count(*)::int AS visitas, to_char(min(v.fecha_visita), 'YYYY-MM-DD') AS primera, to_char(max(v.fecha_visita), 'YYYY-MM-DD') AS ultima,
                (array_agg(DISTINCT v.entidad_visitante) FILTER (WHERE COALESCE(v.entidad_visitante, '') <> ''
                                                                    AND v.tipo_entidad_visitante IS DISTINCT FROM 'persona_natural'))[1:4] AS en_nombre_de,
                (array_agg(DISTINCT concat_ws(', ', NULLIF(v.funcionario_cargo, ''), NULLIF(v.funcionario_area, '')))
                   FILTER (WHERE COALESCE(v.funcionario_cargo, v.funcionario_area, '') <> ''))[1:5] AS a_quien,
                NULL::text[] AS motivos
           FROM visitas_entidades v WHERE v.visitante_norm = ANY($1::text[])
          GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 60`, [formas], 6000).then((r) => r.rows).catch(() => null);
    }
    // Sin el nombre de cada registro (ver arriba) y sin texto libre.
    const sinNombre = <T extends Record<string, unknown>>(filas: T[] | null | undefined) => (filas ?? []).map(({ nombre: _n, ...x }) => x);
    const visitas = (visitasDe ?? []).map(({ nombre: _n, motivos: _m, en_nombre_de, ...v }) => ({
      ...v, en_nombre_de: (en_nombre_de ?? []).filter((o: string) => orgOk(o)),
    }));
    // Si la planilla no respondió a tiempo, al menos lo que ya dice el índice (funcionario_resumen): la entidad y el cargo de
    // hoy. Antes la ficha decía «No figura en ninguna planilla» bajo una cabecera «En planilla hoy» (usuario, 2026-11-17).
    const planillaFilas = planilla ?? (f.planillaHoy && f.entidadRuc
      ? [{ situacion: "hoy", ficha: null, entidad: f.entidad, entidadRuc: f.entidadRuc, cargo: f.cargo, dependencia: null, regimen: null,
           base: null, meses: null, primerMes: null, ultimoMes: f.planillaHasta ? String(f.planillaHasta).slice(0, 7) : null, ultimoMesEntidad: null,
           resumida: true }]
      : []);
    // Si puede ser una autoridad electa (cargo de elección en una DJI, o salió electa en el JNE; si el JNE no respondió,
    // se asume que sí), la familia sale con las reservas de un nombre público (lib/familiaFuncionario.ts).
    const posibleElecto = esCargoDeEleccion(f.cargo) || cargos.rows.some((x) => esCargoDeEleccion(x.cargo))
      || candidaturas === null || candidaturas.some((x) => String(x.resultado ?? "").toLowerCase() === "electo");
    const [fichas, familia, doble, empleos, cargosPlanilla, cobrado, comprasFamiliar, exAutoridad, estadoDji] = await Promise.all([
      fichasPorNombre(f.nombreNorm),
      familiaDelFuncionario(codigo, posibleElecto).catch((e) => { console.warn(`[cargo] familia: ${(e as Error).message}`); return undefined; }),
      // Cobra por dos lados (migración 352): en la planilla de una entidad y, esos mismos meses, con órdenes de servicio de otra.
      pool.query(
        `SELECT d.entidad_ruc, d.entidad, d.cargo, d.sueldo::float AS sueldo, d.otra_ruc, d.otra, d.ordenes, d.monto::float AS monto_soles, d.meses,
                to_char(d.desde, 'YYYY-MM') AS desde, to_char(d.hasta, 'YYYY-MM') AS hasta, d.docente, d.severidad
           FROM doble_percepcion d WHERE d.codigo = $1 ORDER BY d.monto DESC LIMIT 20`, [codigo])
        .then((r) => r.rows).catch(() => []),
      // El puesto con sus palabras (sección de empleos de sus declaraciones) y cada cargo que tuvo en cada planilla
      // (migración 357): la declaración sólo trae la categoría del formulario y la planilla resumía con el último mes.
      f.declaraciones > 0 ? empleosDeclarados(f.nombreNorm) : Promise.resolve([]),
      f.planillaEntidades > 0 ? cargosEnPlanilla(f.nombreNorm) : Promise.resolve([]),
      // Lo que cobró en planilla, por entidad y año: «Lo que cobró» sólo contaba las órdenes de servicio.
      f.planillaEntidades > 0 ? cobradoEnPlanilla(f.nombreNorm) : Promise.resolve([]),
      // Trabaja en compras (o decide el gasto) y un familiar declarado recibe órdenes de su entidad (migración 364).
      comprasYFamilia(codigo, posibleElecto).catch((e) => { console.warn(`[cargo] compras y familia: ${(e as Error).message}`); return []; }),
      // Es una autoridad electa que dejó de figurar en una empresa que le vendió a su entidad (migración 367).
      ventasComoExsocio(f.nombreNorm).catch((e) => { console.warn(`[cargo] autoridad ex socia: ${(e as Error).message}`); return []; }),
      // En qué quedó su declaración jurada (migración 445): leída, sin familiares, por leer y por qué. Sólo el total de
      // familiares que trae, nunca el parentesco. Sin la tabla (o sin fila), la ficha dice lo de antes.
      pool.query<{ estado: string; declaraciones: number; ultima: string | null; leidos: number; declarados: number | null; declaradosDe: string | null }>(
        `SELECT e.estado, e.declaraciones, to_char(e.ultima, 'YYYY-MM-DD') AS ultima, e.leidos, e.declarados,
                to_char(e.declarados_de, 'YYYY-MM-DD') AS "declaradosDe"
           FROM funcionario_dji_estado e WHERE e.codigo = $1`, [codigo])
        .then((r) => r.rows[0] ?? null).catch(() => null),
    ]);
    // Cada planilla con los cargos que tuvo en ella, si fueron más de uno (uno solo ya lo dice la fila).
    const planillaConCargos = planillaFilas.map((x) => {
      const suyos = (cargosPlanilla ?? []).filter((k) => k.entidadRuc === (x as { entidadRuc?: string }).entidadRuc);
      return suyos.length > 1 ? { ...x, cargos: suyos.map(({ entidadRuc: _e, ...k }) => k) } : x;
    });
    const cargosConPuesto = (cargos.rows as { cargo: string | null; entidadRuc: string | null }[]).map((x) => {
      const real = cargoRealDe(x.cargo, x.entidadRuc, empleos ?? []);
      return real ? { ...x, cargoReal: real } : x;
    });
    const sinRespuesta = [...rastro.sin_respuesta.filter((x) => x !== "visitas" || visitasDe === null), ...(planilla ? [] : ["planilla"]),
      ...(candidaturas ? [] : ["candidaturas"]), ...(recibidas ? [] : ["visitas_recibidas"]), ...(familia === undefined ? ["familia"] : []),
      ...(empleos ? [] : ["empleos"]), ...(cargosPlanilla ? [] : ["cargos_planilla"]), ...(cobrado ? [] : ["cobrado_planilla"])];
    // Una ficha a medias no se guarda: el que vuelva a pedirla en un momento la arma entera.
    if (sinRespuesta.length) ctl.noGuardar();
    return publicar({
      codigo,
      persona: {
        nombre: f.nombre, cargo: f.cargo, entidad: f.entidad, entidadRuc: f.entidadRuc, cargoDe: f.cargoDe,
        declaraciones: f.declaraciones, entidades: f.entidades, primera: f.primera, ultima: f.ultima,
        planillaHoy: f.planillaHoy, planillaEntidades: f.planillaEntidades, planillaHasta: f.planillaHasta,
      },
      // Otras personas con cargo público que se ven igual (mismo apellido paterno y nombres): son fichas aparte.
      parecidos,
      // Sus otras fichas (persona contratada, planilla): la ficha de cargo las reúne (lib/identidadPersona.ts).
      mismaPersona: fichas,
      // Lo que obtuvo del Estado cada familiar que declaró (migración 351); null: no hay familiares leídos.
      familia: familia ?? null,
      // Por qué no hay (o cuántos faltan): el estado de su declaración jurada (migración 445). Quien no presentó ninguna
      // (sólo figura en una planilla) no tiene fila: `sin_declaracion`.
      declaracionFamilia: estadoDji ?? (f.declaraciones > 0 ? null : { estado: "sin_declaracion", declaraciones: 0, ultima: null, leidos: 0, declarados: null, declaradosDe: null }),
      cargos: cargosConPuesto,
      // Los trabajos que escribió en sus declaraciones (sólo empleadores con RUC 20), del vigente al más antiguo.
      empleos: empleos ?? [],
      visitas: {
        total: visitas.reduce((s, v) => s + (v.visitas ?? 0), 0),
        entidades: new Set(visitas.map((v) => v.entidad)).size,
        primera: visitas.map((v) => v.primera).filter(Boolean).sort()[0] ?? null,
        ultima: visitas.map((v) => v.ultima).filter(Boolean).sort().pop() ?? null,
        filas: visitas.sort((a, b) => (b.visitas ?? 0) - (a.visitas ?? 0)),
      },
      empresas: sinNombre(rastro.empresas),
      // Las visitas que RECIBIÓ, por empresa (sólo empresas con RUC 20; quien visitó no sale).
      recibidas: recibidas == null ? null : {
        empresas: recibidas.length,
        visitas: recibidas.reduce((s, x) => s + (x.visitas ?? 0), 0),
        ganaronDespues: recibidas.filter((x) => x.ganoDespues > 0).length,
        filas: recibidas,
      },
      planilla: planillaConCargos,
      // Lo cobrado en planilla por entidad y año. El nombre de la entidad, el de su fila de planilla si la vista no lo trae.
      cobradoPlanilla: (cobrado ?? []).map((x) => ({
        ...x, entidad: x.entidad ?? (planillaFilas.find((y) => (y as { entidadRuc?: string }).entidadRuc === x.entidadRuc) as { entidad?: string | null } | undefined)?.entidad ?? null,
      })),
      ordenes: sinNombre(rastro.ordenes_como_persona_natural),
      aportes: sinNombre(rastro.aportes_de_campana),
      expuesta: sinNombre(rastro.personas_expuestas),
      candidaturas: candidaturas ?? [],
      informes: sinNombre(rastro.informes_de_control),
      cruces: {
        visitoYSuEmpresaGano: rastro.visito_y_su_empresa_gano,
        salioYSuEmpresaGano: rastro.salio_de_la_entidad_y_su_empresa_gano,
        variasEmpresasEnUnaEntidad: rastro.gana_en_la_misma_entidad_con_varias_empresas,
        empresaInhabilitadaYOtraGano: rastro.empresa_suya_inhabilitada_y_otra_gano,
        enInformeYDespuesCobro: rastro.en_informe_de_control_y_despues_cobro,
        doblePercepcion: doble,
        comprasFamiliar,
        exAutoridad,
      },
      sinRespuesta,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  // A medias, sin caché del borde: si no, la versión incompleta se sirve media hora.
  c.header("Cache-Control", ((cuerpo as { sinRespuesta?: string[] }).sinRespuesta ?? []).length ? "no-store" : CACHE);
  return c.json(cuerpo);
});

// ─── GET /personas/:codigo ──────────────────────────────────────────────────────────────────────

personasRouter.get("/:codigo", async (c) => {
  const codigo = c.req.param("codigo");
  if (!CODIGO.test(codigo)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await fichaMemo.obtener(codigo, async () => {
    const p = await pool.query<{ ruc: string }>(`SELECT ruc FROM persona_codigo WHERE codigo = $1`, [codigo]);
    const ruc = p.rows[0]?.ruc;
    if (!ruc) return null;
    // Si es o fue autoridad electa, su nombre va completo (lib/electos.ts). El DNI son los dígitos 3 a 10 de su RUC 10.
    const electoP = /^10\d{9}$/.test(ruc)
      ? pool.query<{ e: boolean }>(`SELECT ${esElectoSql("$1::text")} AS e`, [ruc.slice(2, 10)])
      : Promise.resolve(null);
    const [ent, senales, anual, mensual, dudosas, cambios, ganados] = await Promise.all([
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
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC)
         SELECT to_char(date_trunc('month', fecha_emision), 'YYYY-MM') AS mes, COALESCE(sum(monto), 0)::float AS monto,
                COALESCE(sum(monto_dudoso), 0)::float AS dudoso, count(*)::int AS ordenes
           FROM o GROUP BY 1 ORDER BY 1`, [ruc]),
      // Sus órdenes con un monto que puede ser un error de CONOSCE (migración 102): se muestran, no entran en sus sumas.
      pool.query<{ ordenes: number; monto: number | null; motivos: string[] | null }>(
        `WITH d AS (
           SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.monto_dudoso, o.dudoso_motivo
             FROM conosce_ordenes o
            WHERE o.ruc_contratista = $1 AND o.tipo_orden = 'Orden de Servicio' AND o.moneda = 'Nuevos Soles' AND o.monto_dudoso IS NOT NULL
            ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC)
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
      // Los procesos de selección que ganó como persona natural (CONOSCE, con su RUC), cada uno con las señales de ese
      // contrato (casos_cruce). La ficha se armaba sólo con sus órdenes de servicio (migración 317).
      pool.query<{ codigo: string; ocid: string | null; proveedor: string | null; entidad: string | null; entidadRuc: string | null; objeto: string | null;
                   tipoProceso: string | null; nomenclatura: string | null; fecha: string | null; monto: number | null; severidad: string | null;
                   cruces: { tipo: string; severidad: string; n: number }[] | null }>(
        `WITH g AS (
           SELECT a.codigo_convocatoria::text AS codigo, max(a.proveedor) AS proveedor, max(a.entidad) AS entidad, btrim(max(a.entidad_ruc)) AS entidad_ruc,
                  max(a.descripcion_proceso) AS objeto, max(a.tipo_proceso) AS tipo_proceso, max(a.nomenclatura) AS nomenclatura,
                  min(a.fecha_buenapro) AS fecha, sum(a.monto_adjudicado) AS monto
             FROM conosce_adjudicaciones a
            WHERE a.ruc_proveedor = $1 AND a.monto_adjudicado > 0
            GROUP BY 1)
         SELECT g.codigo, c.ocid, g.proveedor, g.entidad, g.entidad_ruc AS "entidadRuc", g.objeto, g.tipo_proceso AS "tipoProceso", g.nomenclatura,
                to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.monto::float AS monto, k.severidad, k.cruces
           FROM g
           LEFT JOIN convocatorias c ON c.codigo::text = g.codigo
           LEFT JOIN casos_cruce k ON k.ocid = c.ocid AND k.ruc = $1
          ORDER BY g.fecha DESC NULLS LAST, g.codigo DESC LIMIT 300`, [ruc]).catch((e) => { console.warn(`[personas] procesos ganados: ${(e as Error).message}`); return { rows: [] }; }),
    ]);
    // Sin órdenes de servicio pero con procesos ganados, también tiene ficha.
    if (!ent.rows.length && !ganados.rows.length) return null;
    // Cómo cobró (usuario, 2026-11-17): por qué tipo de orden y si salió de un proceso. Con qué documento, abajo.
    const porTipo = await consultaConPlazo<{ tipo: string | null; clase: string | null; ordenes: number; monto: number }>(
      `WITH o AS (
         SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.tipo_orden, o.tipo_contratacion, o.monto
           FROM conosce_ordenes o
          WHERE o.ruc_contratista = $1 AND o.moneda = 'Nuevos Soles' AND o.estado IS DISTINCT FROM 'Anulada' AND o.monto > 0
            AND o.monto_dudoso IS NULL AND o.fecha_emision IS NOT NULL
          ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC)
       SELECT tipo_orden AS tipo, clase_orden(tipo_contratacion) AS clase, count(*)::int AS ordenes, COALESCE(sum(monto), 0)::float AS monto
         FROM o GROUP BY 1, 2 ORDER BY 4 DESC`, [ruc], 8000).then((r) => r.rows).catch(() => null);
    const nombreCrudo = ent.rows[0]?.nombre ?? ganados.rows.find((g) => g.proveedor)?.proveedor ?? null;
    const nombrePersona = nombreCrudo ? conEnie(nombreCrudo) : null;
    const procesos = ganados.rows.map(({ proveedor: _p, ...g }) => ({ ...g, objeto: taparNombrePropio(g.objeto, nombrePersona) }));
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
    // ¿Quién de los funcionarios que la declararon es una autoridad electa (su nombre completo es público)? Y ¿va ella con su
    // nombre completo? Con un parentesco que destapa, lo que identifica al funcionario se reserva (reservarParentesco).
    const personaPublica = (await electoP)?.rows[0]?.e === true;
    const pares = senales.rows
      .filter((s) => s.tipo === "nepotismo" || s.tipo === "nepotismo_gobierno" || s.tipo === "familia_estado")
      .flatMap((s) => {
        const par = (s.detalle as Record<string, unknown>)?.parientes;
        return Array.isArray(par)
          ? (par as Record<string, unknown>[]).map((pr) => ({
              entidad: s.tipo === "nepotismo" ? s.entidadRuc : String(pr.entidad_ruc ?? ""), declarante: String(pr.declarante ?? ""), cargo: String(pr.cargo ?? ""),
            }))
          : [];
      })
      .filter((x) => x.entidad && x.declarante);
    const electos = new Set<string>();
    if (pares.length) {
      const r = await pool.query<{ e: string; n: string; electo: boolean }>(
        `SELECT x.e, x.n, ${declaranteElectoSql("x.n", "x.e", "x.c")} AS electo FROM unnest($1::text[], $2::text[], $3::text[]) AS x(e, n, c)`,
        [pares.map((x) => x.entidad), pares.map((x) => x.declarante), pares.map((x) => x.cargo)],
      ).catch(() => null);
      // Si la consulta falla, todos cuentan como electos: se reserva de más, nunca de menos.
      for (const x of r ? r.rows.filter((y) => y.electo) : pares.map((y) => ({ e: y.entidad, n: y.declarante }))) electos.add(`${x.e}|${x.n}`);
    }
    /**
     * Un familiar declarado, como sale: con el cargo, el primer apellido y la ficha del funcionario; o reservado (sólo que
     * existe) si ella va con su nombre completo y el parentesco destaparía el apellido tapado del funcionario. El caso de
     * un funcionario electo con un parentesco que destapa el de ella ya no llega aquí (podarParientes, abajo).
     */
    const pariente = (entidad: string, pr: Record<string, unknown>, declarante: unknown, fichaDe: (d: string) => string | null) => {
      if (reservarParentesco({ parentesco: pr.parentesco, declaranteElecto: electos.has(`${entidad}|${String(declarante ?? "")}`), familiarPublico: personaPublica })) {
        return { reservado: true as const };
      }
      const funcionarioApellido = apellidoFuncionario(pr.parentesco, declarante);
      return { ...pr, funcionarioApellido, ficha: funcionarioApellido ? fichaDe(String(declarante ?? "")) : null };
    };
    const porEntidad = new Map<string, unknown[]>();
    // El caso reservado de una autoridad electa (lo declaró y el parentesco destapa el apellido tapado de esta persona) no
    // sale, ni como «reservado»: sin otro familiar, la señal tampoco, ni entre las de su entidad (migración 311, que se lo
    // quita en la base; esto cubre lo que llegue antes de su próxima corrida).
    const quitadas = new Map<string, Set<string>>();
    let nQuitadas = 0;
    for (const s0 of senales.rows) {
      const podado = SENALES_CON_PARIENTES.has(s0.tipo) && s0.detalle
        ? podarParientes(s0.tipo, s0.detalle as Record<string, unknown>, (pr) => casoReservado({
            electo: electos.has(`${s0.tipo === "nepotismo" ? s0.entidadRuc : String(pr.entidad_ruc ?? "")}|${String(pr.declarante ?? "")}`),
            parentesco: typeof pr.parentesco === "string" ? pr.parentesco : null,
          }))
        : s0.detalle;
      if (!podado && SENALES_CON_PARIENTES.has(s0.tipo) && s0.detalle) {
        quitadas.set(s0.entidadRuc, (quitadas.get(s0.entidadRuc) ?? new Set<string>()).add(s0.tipo));
        nQuitadas++;
        continue;
      }
      const s = podado === s0.detalle ? s0 : { ...s0, detalle: podado };
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
                  ? (par as Record<string, unknown>[]).map(({ declarante, ...pr }) =>
                      // Sin el nombre completo del funcionario (ver apellidoFuncionario): su primer apellido y su ficha,
                      // sólo si el parentesco no puede destapar el apellido tapado de esta persona; reservado si es una
                      // autoridad electa y el parentesco destapa.
                      pariente(s.entidadRuc, pr, declarante, (d) => declFichas.get(`${s.entidadRuc}|${d}`) ?? null))
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
                    ? (par as Record<string, unknown>[]).map(({ declarante, ...pr }) =>
                        pariente(String(pr.entidad_ruc ?? ""), pr, declarante, (d) => declOtras.get(`${String(pr.entidad_ruc ?? "")}|${d}`) ?? null))
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
    const entidades = ent.rows.map((e) => {
      // Las señales de la entidad (persona_entidad), sin las que no salen.
      const fuera = quitadas.get(e.entidadRuc);
      const suyas = fuera && Array.isArray(e.senales) ? (e.senales as { tipo?: unknown }[]).filter((x) => !fuera.has(String(x.tipo))) : null;
      return { ...e, ...(suyas ? { senales: suyas, nSenales: suyas.length } : {}), nombre: e.nombre ? conEnie(e.nombre) : e.nombre,
               senalesDetalle: porEntidad.get(e.entidadRuc) ?? [] };
    });
    const sum = (k: "ordenes" | "monto" | "meses") => entidades.reduce((t, e) => t + Number(e[k] ?? 0), 0);
    const fechas = (k: "primera" | "ultima") => entidades.map((e) => e[k]).filter(Boolean).sort();
    // Sus otras fichas (cargo público, planilla), sólo si el enlace es seguro (lib/identidadPersona.ts).
    const fichas = /^10\d{9}$/.test(ruc) ? await fichasDeContratada(ruc, codigo) : null;
    const fechasGanados = procesos.map((g) => g.fecha).filter((f): f is string => !!f).sort();
    return publicar({
      persona: {
        codigo, ruc, nombre: entidades[0]?.nombre ?? nombrePersona, ...marcaElecto(personaPublica), entidades: entidades.length, ordenes: sum("ordenes"), monto: sum("monto"),
        meses: sum("meses"), primera: fechas("primera")[0] ?? null, ultima: fechas("ultima").at(-1) ?? null,
        nSenales: senales.rows.length - nQuitadas,
        dudosas: dudosas.rows[0]?.ordenes ? dudosas.rows[0] : null,
        // Los procesos de selección que ganó (CONOSCE): cuántos, cuánto, en cuántas entidades y entre qué fechas.
        procesos: procesos.length,
        montoProcesos: procesos.reduce((t, g) => t + (g.monto ?? 0), 0),
        entidadesProcesos: new Set(procesos.map((g) => g.entidadRuc).filter(Boolean)).size,
        primeraBuenaPro: fechasGanados[0] ?? null,
        ultimaBuenaPro: fechasGanados.at(-1) ?? null,
      },
      procesos,
      entidades,
      anual: anual.rows,
      // Con qué documento factura (sólo su clase: el RUC de una persona lleva su DNI y nunca sale) y por qué tipo de orden.
      comoCobro: {
        documento: /^10/.test(ruc) ? "ruc10" : /^(15|17)/.test(ruc) ? "ruc_otro_documento" : "ruc20",
        porTipo: porTipo ?? [],
      },
      mensual: mensual.rows,
      cambios: cambios.rows,
      mismaPersona: fichas,
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
  // Se tapa el segundo apellido entero, con sus partículas («QUISPE DE LA TORRE JUAN» → «QUISPE ••• JUAN»), y el primero
  // se queda con las suyas («DE LA CRUZ ••• ROSA»): lo decide apellidosSunat, como en publicar().
  const [e1, e2] = apellidosSunat(p.map((w) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()));
  const [ap1, ap2, nombres] = [p.slice(0, e1), p.slice(e1, e2), p.slice(e2)];
  const hablado = new RegExp(`(?<!\\p{L})${esc([...nombres, ...ap1, ...ap2])}(?!\\p{L})`, "giu");
  return texto
    .replace(sunat, [...ap1, TAPA_NOMBRE, ...nombres].join(" "))
    .replace(hablado, [...nombres, ...ap1, TAPA_NOMBRE].join(" "));
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
          -- También las filas que el RNP tipa como «RUC» con el DNI de 8 cifras (auditoría del 2026-10-29).
          WHERE r.numero_documento = $1 AND (r.tipo_documento LIKE 'DOC. NACIONAL%' OR r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES')
            AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
          GROUP BY r.ruc_empresa, er.nombre, er.adj_monto, er.ord_monto, er.entidades, er.inhabilitada, er.estado_sunat, er.n_alta
          ORDER BY vendido DESC NULLS LAST, desde LIMIT 60`, [dni]),
      pool.query(
        `SELECT "año" AS anio, partido, cargo, resultado, region, provincia, distrito
           FROM jne_candidaturas WHERE numero_documento = $1 ORDER BY "año" DESC, cargo LIMIT 40`, [dni]),
      pool.query(
        `SELECT cargo, organizacion_politica AS partido, to_char(periodo_inicio, 'YYYY-MM-DD') AS desde,
                to_char(periodo_fin, 'YYYY-MM-DD') AS hasta, (vigente AND (periodo_fin IS NULL OR periodo_fin >= current_date)) AS vigente,
                departamento, provincia, distrito
           FROM jne_autoridades WHERE dni = $1 ORDER BY periodo_inicio DESC NULLS LAST LIMIT 20`, [dni]),
      pool.query(
        `SELECT partido, "año" AS anio, to_char(fecha_aporte, 'YYYY-MM-DD') AS fecha, monto::float AS monto, tipo_aporte AS tipo,
                nivel, proceso
           -- Cada aporte una vez (migración 211: el mismo en el informe anual y en el de campaña se contaba dos veces).
           FROM onpe_aporte_unico WHERE numero_documento = $1 ORDER BY fecha_aporte DESC NULLS LAST, "año" DESC LIMIT 100`, [dni]),
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
           -- Por la función de la migración 213: la API no lee dji_vinculos (el DNI de los familiares nunca sale de la base).
           FROM dji_familia_de($1) v
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
        `SELECT v.entidad_visitada AS entidad,
                (SELECT min(m.ruc) FROM visita_entidad_ruc m WHERE m.entidad_visitada = v.entidad_visitada) AS "entidadRuc",
                count(*)::int AS n, to_char(min(v.fecha_visita), 'YYYY-MM-DD') AS primera,
                to_char(max(v.fecha_visita), 'YYYY-MM-DD') AS ultima, count(*) FILTER (WHERE v.decisor)::int AS "aQuienDecide"
           FROM visitas_entidades v WHERE v.numero_documento = $1 AND v.entidad_visitada IS NOT NULL
          GROUP BY v.entidad_visitada ORDER BY count(*) DESC, min(v.fecha_visita) LIMIT 12`, [dni]),
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
    // Como en la ficha: si el funcionario es una autoridad electa, o si ella misma va con su nombre completo, y el parentesco
    // destapa, el funcionario no se identifica (ni cargo, ni apellido, ni ficha, ni parentesco).
    const personaPublica = autoridades.rows.length > 0
      || (await pool.query<{ e: boolean }>(`SELECT ${esElectoSql("$1::text")} AS e`, [dni]).catch(() => ({ rows: [{ e: true }] }))).rows[0]?.e === true;
    const famElectos = new Set<string>();
    if (familia.rows.length) {
      const r = await pool.query<{ e: string; n: string; electo: boolean }>(
        `SELECT x.e, x.n, ${declaranteElectoSql("x.n", "x.e", "x.c")} AS electo FROM unnest($1::text[], $2::text[], $3::text[]) AS x(e, n, c)`,
        [familia.rows.map((f) => f.entidadRuc), familia.rows.map((f) => f.declarante ?? ""), familia.rows.map((f) => f.cargo ?? "")],
      ).catch(() => null);
      for (const x of r ? r.rows.filter((y) => y.electo) : familia.rows.map((f) => ({ e: f.entidadRuc, n: f.declarante ?? "" }))) famElectos.add(`${x.e}|${x.n}`);
    }
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
      // Sin el nombre del funcionario (apellidoFuncionario): su primer apellido y su ficha, si el parentesco lo permite;
      // reservado (sólo la entidad) si ella va completa y el parentesco destapa el apellido del funcionario. El caso de una
      // autoridad electa con un parentesco que destapa el de ella no sale (como en su ficha: migración 311).
      familia: familia.rows.flatMap(({ declarante, ficha, ...f }): Record<string, unknown>[] => {
        const electo = famElectos.has(`${f.entidadRuc}|${declarante ?? ""}`);
        if (casoReservado({ electo, parentesco: f.parentesco })) return [];
        if (reservarParentesco({ parentesco: f.parentesco, declaranteElecto: electo, familiarPublico: personaPublica })) {
          return [{ entidadRuc: f.entidadRuc, entidad: f.entidad, reservado: true as const }];
        }
        const funcionarioApellido = apellidoFuncionario(f.parentesco, declarante);
        return [{ ...f, funcionarioApellido, ficha: funcionarioApellido ? ficha : null }];
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
          ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC)
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
