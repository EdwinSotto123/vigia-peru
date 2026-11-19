import { escaparLike, pool } from "./db.js";
import { esElectoSql } from "./electos.js";

/**
 * Las listas de la pestaña «Visitas» de una entidad, ENTERAS y paginadas en el servidor (rediseño del 2026-11-18: «mucho
 * scroll, varias tablas… no tiene sentido»). Antes GET /visitas/entidad/:ruc mandaba las 1,000 organizaciones que más la
 * visitan, 300 oficinas, 1,000 visitas de familiares y las 1,000 visitas más recientes (varios MB en las entidades grandes)
 * y la web las cortaba ahí. Ahora cada lista llega de a una página, con su búsqueda, sus filtros y su orden, y nada queda
 * fuera: GET /visitas/entidad/:ruc/lista?que=empresas|organizaciones|areas|parientes|visitas.
 *
 *   empresas        las empresas cuya gente la visitó y que después recibieron algo (entidad_visita_empresa, migr. 203)
 *   organizaciones  cada organización que declaró quien visitó (entidad_visita_org, migr. 188) y lo que ganó después
 *   areas           a qué oficinas y cargos (entidad_visita_area); de quien recibe, nunca su nombre
 *   parientes       las visitas de familiares declarados de sus funcionarios (entidad_visita_pariente); nunca quiénes
 *   visitas         cada visita (visitas_entidades), por el índice de la entidad y la fecha
 *
 * Las cuatro primeras salen de tablas precalculadas de a lo más ~42 mil filas por entidad (el Congreso): cada pedido
 * cuenta el total y, por cada opción de cada filtro, cuántas quedan con los DEMÁS filtros puestos (ninguna opción lleva a
 * cero). La de visitas recorre el índice (entidad_visitada, fecha_visita) de a una página; su total sale de las cifras
 * precalculadas cuando el filtro las tiene (sin filtros, por año, por tipo, a quien decide, de familiares) o de la misma
 * consulta (por organización), y si no, la página dice si hay más (`hayMas`). Buscar en ella es buscar la ORGANIZACIÓN de
 * quien visita (entre las suyas, en entidad_visita_org): nunca a una persona por su nombre (docs/PRIVACIDAD.md). Esa
 * búsqueda lee sólo las visitas de esas organizaciones (índice de upper(entidad_visitante) y de la entidad, juntos).
 */

export const LISTAS_VISITAS = ["empresas", "organizaciones", "areas", "parientes", "visitas"] as const;
export type QueLista = (typeof LISTAS_VISITAS)[number];

/** Filas por página si no se pide otro tamaño (la web pide 15: la pestaña entera cabe en una pantalla y media). */
export const TAM_LISTA = 15;
const TAM_MAX = 50;
/**
 * Hasta dónde se salta en la lista de visitas: más allá, la base lee cientos de miles de visitas para descartarlas (el
 * Congreso tiene 1,2 M: saltar 100 mil son ~1 s). El año y el orden «Lo más antiguo» llevan a cualquier visita sin saltar
 * tanto, y la respuesta lo dice (`error: "pagina_muy_honda"`).
 */
export const SALTO_MAX = 100_000;

type Valores = readonly string[] | "anio" | "texto";

/** Los filtros que acepta cada lista y sus valores. */
const FILTROS: Record<QueLista, Record<string, Valores>> = {
  empresas: {
    via: ["representante", "socio", "directivo", "nombre"],
    declaro: ["si", "no"],
    antes: ["si", "no"],
    decisor: ["si", "no"],
    tipo: ["contrato", "consorcio", "orden"],
  },
  organizaciones: { tipo: ["privada", "publica"], despues: ["si", "no"], decisor: ["si", "no"] },
  areas: { decisor: ["si", "no"] },
  parientes: { proveedor: ["si", "no"], decisor: ["si", "no"] },
  visitas: { tipo: ["privada", "publica", "persona_natural", "pariente"], decisor: ["si", "no"], hora: ["fuera", "dentro"], anio: "anio", org: "texto" },
};

/** Los órdenes de cada lista: el primero es el de siempre. */
const ORDENES: Record<QueLista, readonly string[]> = {
  empresas: ["nueva", "monto", "visitas", "dias", "reciente"],
  organizaciones: ["visitas", "monto", "reciente"],
  areas: ["visitas", "privadas"],
  parientes: ["reciente", "antiguo"],
  visitas: ["reciente", "antiguo"],
};

export interface PedidoLista {
  que: QueLista;
  page: number;
  size: number;
  offset: number;
  /** Lo que se busca, ya limpio (2 a 80 caracteres), o null. */
  q: string | null;
  orden: string;
  /** Los filtros válidos que llegaron (dimensión → valor). */
  f: Record<string, string>;
}

export interface ResultadoLista {
  que: QueLista;
  page: number;
  size: number;
  /** null: no se sabe sin recorrer todo (la lista de visitas con filtros combinados); vale `hayMas`. */
  total: number | null;
  hayMas: boolean;
  filas: Record<string, unknown>[];
  /** Por filtro, cuántas filas da cada opción con los demás filtros puestos; null si no se sabe (no se muestra un 0). */
  facetas: Record<string, Record<string, number> | null>;
  /** Visitas: los años que tiene (para elegir uno), y en cuántas organizaciones encontró lo buscado. */
  anios?: number[];
  organizaciones?: number;
}

/** El pedido de la URL, validado: lo que no es una opción conocida se ignora (nunca entra al SQL). */
export function leerPedido(que: string | undefined, qp: Record<string, string | undefined>): PedidoLista | null {
  if (!que || !(LISTAS_VISITAS as readonly string[]).includes(que)) return null;
  const l = que as QueLista;
  const page = Math.min(1_000_000, Math.max(1, Math.floor(Number(qp.page)) || 1));
  const size = Math.min(TAM_MAX, Math.max(5, Math.floor(Number(qp.size)) || TAM_LISTA));
  const limpio = (qp.q ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const orden = qp.orden && ORDENES[l].includes(qp.orden) ? qp.orden : ORDENES[l][0];
  const f: Record<string, string> = {};
  for (const [dim, permitidos] of Object.entries(FILTROS[l])) {
    const v = (qp[dim] ?? "").trim();
    if (!v) continue;
    if (permitidos === "anio") {
      if (/^(19|20)\d{2}$/.test(v)) f[dim] = v;
    } else if (permitidos === "texto") {
      // La organización como la guarda entidad_visita_org: en mayúsculas y sin espacios en los bordes.
      const t = v.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 200);
      if (t) f[dim] = t;
    } else if (permitidos.includes(v)) f[dim] = v;
  }
  return { que: l, page, size, offset: (page - 1) * size, q: limpio.length >= 2 ? limpio : null, orden, f };
}

// ─── Filtros y conteos por opción ───────────────────────────────────────────────

/** Por dimensión, el SQL de cada opción (texto fijo: lo que llega de la URL sólo elige cuál). */
type Condiciones = Record<string, Record<string, string>>;

const y = (xs: string[]) => (xs.length ? xs.map((x) => `(${x})`).join(" AND ") : "true");

/** Las condiciones de los filtros pedidos que esta lista sabe aplicar, por dimensión. */
export function activas(conds: Condiciones, f: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dim, valor] of Object.entries(f)) {
    const c = conds[dim]?.[valor];
    if (c) out[dim] = c;
  }
  return out;
}

/**
 * Las columnas de UNA consulta que cuenta el total con todos los filtros y, por cada opción de cada filtro, cuántas
 * quedan con los demás filtros puestos y esa opción (así ninguna opción del desplegable lleva a una lista vacía).
 */
export function sqlFacetas(conds: Condiciones, act: Record<string, string>): string {
  const cols = [`count(*) FILTER (WHERE ${y(Object.values(act))})::int AS "total"`];
  for (const [dim, opciones] of Object.entries(conds)) {
    const otras = Object.entries(act).filter(([d]) => d !== dim).map(([, c]) => c);
    for (const [valor, c] of Object.entries(opciones)) cols.push(`count(*) FILTER (WHERE ${y([...otras, c])})::int AS "${dim}:${valor}"`);
  }
  return cols.join(", ");
}

/** La fila de `sqlFacetas` como { total, facetas: { dimensión: { opción: n } } }. */
export function armarFacetas(fila: Record<string, unknown> | undefined): { total: number; facetas: Record<string, Record<string, number>> } {
  const facetas: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(fila ?? {})) {
    const n = Number(v) || 0;
    if (k === "total") {
      total = n;
      continue;
    }
    const [dim, valor] = k.split(":");
    if (!dim || !valor) continue;
    (facetas[dim] ??= {})[valor] = n;
  }
  return { total, facetas };
}

/** `%texto%` para un ILIKE: lo que escribe la persona va como texto, no como comodín. */
const patron = (q: string) => `%${escaparLike(q)}%`;
/** Los dígitos de lo buscado, para comparar con un RUC (sin dígitos, '' no calza con nada). */
const digitos = (q: string) => q.replace(/\D/g, "");
/** Para comparar sin tildes ni mayúsculas, como unaccent + ILIKE. */
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Sólo un RUC 20 se muestra o se busca: un RUC 10 lleva el DNI de una persona. */
const ruc20 = (r: unknown): string | null => (typeof r === "string" && /^20\d{9}$/.test(r) ? r : null);

// ─── Qué tablas hay (una base sin migrar responde igual, con menos) ─────────────

export interface Capacidades {
  /** entidad_visita_resumen / _org / _area (migración 188). */
  pre: boolean;
  parientes: boolean;
  empresas: boolean;
  meses: boolean;
  /** visita_decisor() (para la visita recién cargada que aún no trae su marca). */
  decisor: boolean;
}
let caps: { t: number; v: Capacidades } | null = null;

export async function capacidades(): Promise<Capacidades> {
  if (caps && Date.now() - caps.t < 600_000) return caps.v;
  const r = await pool.query<Capacidades>(
    `SELECT to_regclass('entidad_visita_resumen') IS NOT NULL AND to_regclass('entidad_visita_org') IS NOT NULL
              AND to_regclass('entidad_visita_area') IS NOT NULL AS pre,
            to_regclass('entidad_visita_pariente') IS NOT NULL AS parientes,
            to_regclass('entidad_visita_empresa') IS NOT NULL AS empresas,
            to_regclass('entidad_visita_mes') IS NOT NULL AS meses,
            EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'visita_decisor') AS decisor`,
  );
  const v = r.rows[0] ?? { pre: false, parientes: false, empresas: false, meses: false, decisor: false };
  caps = { t: Date.now(), v };
  return v;
}

// ─── Empresas que ganaron algo después ──────────────────────────────────────────

const C_EMPRESAS: Condiciones = {
  via: { representante: "e.representante > 0", socio: "e.socio > 0", directivo: "e.directivo > 0", nombre: "e.nombre > 0" },
  declaro: { si: "e.declaradas > 0", no: "e.declaradas = 0" },
  antes: { si: "e.antes > 0", no: "e.antes = 0" },
  decisor: { si: "e.decisores > 0", no: "e.decisores = 0" },
  tipo: { contrato: "e.despues_tipo = 'contrato'", consorcio: "e.despues_tipo = 'consorcio'", orden: "e.despues_tipo = 'orden'" },
};
const O_EMPRESAS: Record<string, string> = {
  // Primero las que nunca le habían vendido y, entre ellas, por lo que ganaron.
  nueva: "(e.antes = 0) DESC, e.monto DESC NULLS LAST, e.visitas DESC, e.ruc",
  monto: "e.monto DESC NULLS LAST, e.visitas DESC, e.ruc",
  visitas: "e.visitas DESC, e.monto DESC NULLS LAST, e.ruc",
  dias: "e.dias ASC NULLS LAST, e.monto DESC NULLS LAST, e.ruc",
  reciente: "e.despues DESC, e.ruc",
};

async function listaEmpresas(ruc: string, p: PedidoLista, cap: Capacidades): Promise<ResultadoLista> {
  if (!cap.empresas) return vacia(p);
  const act = activas(C_EMPRESAS, p.f);
  const vals: unknown[] = [ruc];
  let busca = "true";
  if (p.q) {
    vals.push(patron(p.q), digitos(p.q));
    busca = `(unaccent(COALESCE(r.nombre, '')) ILIKE unaccent($2) OR unaccent(COALESCE(e.otra_org, '')) ILIKE unaccent($2) OR e.ruc = $3)`;
  }
  const desde = `FROM entidad_visita_empresa e LEFT JOIN empresa_resumen r ON r.ruc = e.ruc
                WHERE e.entidad_ruc = $1 AND e.despues IS NOT NULL AND ${busca}`;
  const [filas, cuentas] = await Promise.all([
    pool.query(
      `SELECT e.ruc, r.nombre AS empresa, e.visitas, e.visitantes, e.decisores, e.socio, e.representante, e.directivo,
              e.nombre AS "porNombre", e.declaradas, e.personal, e.compartidas, e.otra_org AS "otraOrg",
              to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.ultima, 'YYYY-MM-DD') AS ultima, e.antes,
              to_char(e.despues, 'YYYY-MM-DD') AS despues, e.despues_tipo AS "despuesTipo", e.dias,
              e.contratos, e.consorcios, e.ordenes, e.monto::float AS monto,
              e.despues_numero AS "despuesNumero", e.despues_detalle AS "despuesDetalle", e.despues_monto::float AS "despuesMonto",
              e.despues_codigo AS "despuesCodigo", e.despues_orden AS "despuesOrden", e.despues_ocid AS "despuesOcid"
         ${desde} AND ${y(Object.values(act))}
        ORDER BY ${O_EMPRESAS[p.orden] ?? O_EMPRESAS.nueva} LIMIT ${p.size} OFFSET ${p.offset}`,
      vals,
    ),
    pool.query(`SELECT ${sqlFacetas(C_EMPRESAS, act)} ${desde}`, vals),
  ]);
  const { total, facetas } = armarFacetas(cuentas.rows[0]);
  return { que: p.que, page: p.page, size: p.size, total, hayMas: p.offset + filas.rows.length < total, filas: filas.rows, facetas };
}

// ─── Quiénes la visitan (cada organización) ─────────────────────────────────────

const C_ORGS: Condiciones = {
  tipo: { privada: "o.tipo IS DISTINCT FROM 'publica'", publica: "o.tipo = 'publica'" },
  despues: { si: "o.despues IS NOT NULL", no: "o.despues IS NULL" },
  decisor: { si: "o.decisores > 0", no: "o.decisores = 0" },
};
const O_ORGS: Record<string, string> = {
  visitas: "o.visitas DESC, o.org",
  monto: "o.monto DESC NULLS LAST, o.visitas DESC, o.org",
  reciente: "o.ultima DESC NULLS LAST, o.visitas DESC, o.org",
};

async function listaOrganizaciones(ruc: string, p: PedidoLista, cap: Capacidades): Promise<ResultadoLista> {
  if (!cap.pre) return vacia(p);
  const act = activas(C_ORGS, p.f);
  const vals: unknown[] = [ruc];
  let busca = "true";
  if (p.q) {
    // Por lo que declararon o por el RUC 20 de su empresa (nunca un RUC 10). No por el nombre de la empresa: con él en el
    // filtro la unión recorría las 41,952 organizaciones del Congreso (8.8 s); la organización suele ser ese nombre.
    vals.push(patron(p.q), digitos(p.q));
    busca = `(unaccent(o.org) ILIKE unaccent($2) OR (o.ruc = $3 AND o.ruc LIKE '20%'))`;
  }
  // MATERIALIZED: unida una vez (hash) y no fila por fila. Con «sólo las que ganaron algo» y LIMIT, Postgres probaba la
  // empresa de cada una de las 42 mil organizaciones del Congreso de a una (5.8 s); juntas son 60 ms.
  const cte = `WITH o AS MATERIALIZED (
      SELECT o.org, o.tipo, o.visitas, o.visitantes, o.primera, o.ultima, o.decisores, o.ruc,
             ${cap.empresas ? "e.despues, e.despues_tipo, e.monto, e.despues_numero, e.despues_monto" : "NULL::date AS despues, NULL::text AS despues_tipo, NULL::numeric AS monto, NULL::text AS despues_numero, NULL::numeric AS despues_monto"}
        FROM entidad_visita_org o
        ${cap.empresas ? "LEFT JOIN entidad_visita_empresa e ON e.entidad_ruc = o.entidad_ruc AND e.ruc = o.ruc" : ""}
       WHERE o.entidad_ruc = $1 AND ${busca})`;
  const [filas, cuentas] = await Promise.all([
    pool.query(
      `${cte}
       SELECT o.org, o.tipo, o.visitas, o.visitantes, to_char(o.primera, 'YYYY-MM-DD') AS primera, to_char(o.ultima, 'YYYY-MM-DD') AS ultima,
              o.decisores, o.ruc, to_char(o.despues, 'YYYY-MM-DD') AS despues, o.despues_tipo AS "despuesTipo",
              COALESCE(o.monto, 0)::float AS "montoDespues", o.despues_numero AS "despuesNumero", o.despues_monto::float AS "despuesMonto"
         FROM o WHERE ${y(Object.values(act))}
        ORDER BY ${O_ORGS[p.orden] ?? O_ORGS.visitas} LIMIT ${p.size} OFFSET ${p.offset}`,
      vals,
    ),
    pool.query(`${cte} SELECT ${sqlFacetas(C_ORGS, act)} FROM o`, vals),
  ]);
  // El nombre de la empresa de cada fila de la página (una consulta para todas).
  const rucs = [...new Set(filas.rows.map((o) => ruc20(o.ruc)).filter((x): x is string => !!x))];
  const nombres = rucs.length
    ? new Map((await pool.query<{ ruc: string; nombre: string }>(`SELECT ruc, nombre FROM empresa_resumen WHERE ruc = ANY($1)`, [rucs])).rows.map((x) => [x.ruc, x.nombre]))
    : new Map<string, string>();
  const { total, facetas } = armarFacetas(cuentas.rows[0]);
  return {
    que: p.que, page: p.page, size: p.size, total, hayMas: p.offset + filas.rows.length < total, facetas,
    filas: filas.rows.map((o) => {
      const r = ruc20(o.ruc);
      return { ...o, ruc: r, empresa: r ? nombres.get(r) ?? null : null };
    }),
  };
}

// ─── A qué oficinas ─────────────────────────────────────────────────────────────

const C_AREAS: Condiciones = { decisor: { si: "a.decisor", no: "NOT a.decisor" } };
const O_AREAS: Record<string, string> = {
  visitas: "a.visitas DESC, a.area, a.cargo",
  privadas: "a.privadas DESC, a.visitas DESC, a.area, a.cargo",
};

async function listaAreas(ruc: string, p: PedidoLista, cap: Capacidades): Promise<ResultadoLista> {
  if (!cap.pre) return vacia(p);
  const act = activas(C_AREAS, p.f);
  const vals: unknown[] = [ruc];
  let busca = "true";
  if (p.q) {
    vals.push(patron(p.q));
    busca = `(unaccent(a.area) ILIKE unaccent($2) OR unaccent(a.cargo) ILIKE unaccent($2))`;
  }
  const desde = `FROM entidad_visita_area a WHERE a.entidad_ruc = $1 AND ${busca}`;
  const [filas, cuentas] = await Promise.all([
    pool.query(
      `SELECT a.area, NULLIF(a.cargo, '') AS cargo, a.visitas, a.privadas, a.decisor
         ${desde} AND ${y(Object.values(act))}
        ORDER BY ${O_AREAS[p.orden] ?? O_AREAS.visitas} LIMIT ${p.size} OFFSET ${p.offset}`,
      vals,
    ),
    pool.query(`SELECT ${sqlFacetas(C_AREAS, act)} ${desde}`, vals),
  ]);
  const { total, facetas } = armarFacetas(cuentas.rows[0]);
  return { que: p.que, page: p.page, size: p.size, total, hayMas: p.offset + filas.rows.length < total, filas: filas.rows, facetas };
}

// ─── Visitas de familiares de sus funcionarios ──────────────────────────────────

const C_PARIENTES: Condiciones = {
  proveedor: { si: "p.proveedor", no: "NOT p.proveedor" },
  decisor: { si: "p.decisor", no: "NOT p.decisor" },
};
const O_PARIENTES: Record<string, string> = {
  reciente: "p.fecha DESC, p.visita_id DESC",
  antiguo: "p.fecha ASC, p.visita_id ASC",
};

async function listaParientes(ruc: string, p: PedidoLista, cap: Capacidades): Promise<ResultadoLista> {
  if (!cap.parientes) return vacia(p);
  const act = activas(C_PARIENTES, p.f);
  const vals: unknown[] = [ruc];
  let busca = "true";
  if (p.q) {
    // El parentesco, el cargo o la oficina de quien la recibió: nada de la persona que visitó.
    vals.push(patron(p.q));
    busca = `(unaccent(COALESCE(p.parentesco, '')) ILIKE unaccent($2) OR unaccent(COALESCE(p.cargo, '')) ILIKE unaccent($2)
              OR unaccent(COALESCE(p.area, '')) ILIKE unaccent($2))`;
  }
  const desde = `FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1 AND ${busca}`;
  const [filas, cuentas] = await Promise.all([
    pool.query(
      `SELECT to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.parentesco, p.cargo, p.area, p.decisor, p.proveedor
         ${desde} AND ${y(Object.values(act))}
        ORDER BY ${O_PARIENTES[p.orden] ?? O_PARIENTES.reciente} LIMIT ${p.size} OFFSET ${p.offset}`,
      vals,
    ),
    pool.query(`SELECT ${sqlFacetas(C_PARIENTES, act)} ${desde}`, vals),
  ]);
  const { total, facetas } = armarFacetas(cuentas.rows[0]);
  return {
    que: p.que, page: p.page, size: p.size, total, hayMas: p.offset + filas.rows.length < total, facetas,
    // La clave es su lugar en la lista, no el id de la visita: con él se la podría buscar en otra lista que sí nombra a
    // quien visitó, y aquí no se dice quién es el familiar.
    filas: filas.rows.map((x, i) => ({ clave: `p${p.offset + i + 1}`, ...x })),
  };
}

// ─── Cada visita ────────────────────────────────────────────────────────────────

/** Fuera del horario de oficina: antes de las 7, desde las 19 o en fin de semana. */
export const FUERA_DE_HORA = `(v.hora_ingreso < TIME '07:00' OR v.hora_ingreso >= TIME '19:00' OR extract(isodow FROM v.fecha_visita) IN (6, 7))`;

function condVisitas(cap: Capacidades): Condiciones {
  // La marca de quien decide ya va en la visita (migración 188); la de una visita recién cargada, en vivo.
  const dec = `COALESCE(v.decisor, ${cap.decisor ? "visita_decisor(v.funcionario_cargo, v.funcionario_area), " : ""}false)`;
  return {
    tipo: {
      privada: "v.tipo_entidad_visitante = 'privada'",
      publica: "v.tipo_entidad_visitante = 'publica'",
      persona_natural: "v.tipo_entidad_visitante = 'persona_natural'",
    },
    decisor: { si: dec, no: `NOT ${dec}` },
    hora: { fuera: `COALESCE(${FUERA_DE_HORA}, false)`, dentro: `NOT COALESCE(${FUERA_DE_HORA}, false)` },
  };
}

interface ResumenVisitas { total: number; privadas: number; publicas: number; personas: number; decisores: number; fuera: number; parientes: number | null }
interface MesVisitas { anio: number; visitas: number; privadas: number }

async function cifrasVisitas(ruc: string, cap: Capacidades): Promise<{ r: ResumenVisitas | null; anios: MesVisitas[] }> {
  const [r, m] = await Promise.all([
    cap.pre
      ? pool.query(
          `SELECT total, privadas, publicas, personas, decisores, fuera_de_hora AS fuera,
                  ${cap.parientes ? "(SELECT count(*)::int FROM entidad_visita_pariente WHERE entidad_ruc = $1)" : "NULL::int"} AS parientes
             FROM entidad_visita_resumen WHERE entidad_ruc = $1`, [ruc])
      : Promise.resolve({ rows: [] as ResumenVisitas[] }),
    cap.meses
      ? pool.query<MesVisitas>(
          `SELECT extract(year FROM mes)::int AS anio, sum(visitas)::int AS visitas, sum(privadas)::int AS privadas
             FROM entidad_visita_mes WHERE entidad_ruc = $1 GROUP BY 1 ORDER BY 1 DESC`, [ruc])
      : Promise.resolve({ rows: [] as MesVisitas[] }),
  ]);
  return { r: (r.rows[0] as ResumenVisitas | undefined) ?? null, anios: m.rows };
}

/** Lo que pide la web de cada visita (sin el documento: sólo para saber si es una autoridad electa). */
const COLUMNAS_VISITA = (cap: Capacidades) => `
  v.id, to_char(v.fecha_visita, 'YYYY-MM-DD') AS fecha, to_char(v.hora_ingreso, 'HH24:MI') AS hora, v.duracion_min AS duracion,
  v.visitante, (v.numero_documento ~ '^[0-9]{8}$' AND ${esElectoSql("v.numero_documento")}) AS electo,
  v.tipo_entidad_visitante AS tipo, v.entidad_visitante AS organizacion,
  v.funcionario_cargo AS cargo, v.funcionario_area AS area, left(v.motivo, 160) AS motivo, v.fuente,
  ${condVisitas(cap).decisor.si} AS decisor, COALESCE(${FUERA_DE_HORA}, false) AS "fueraDeHora",
  ${cap.parientes ? "EXISTS (SELECT 1 FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1 AND p.visita_id = v.id)" : "false"} AS pariente,
  (SELECT ev.ruc FROM empresa_visita ev WHERE ev.visita_id = v.id LIMIT 1) AS ruc`;

async function listaVisitas(ruc: string, p: PedidoLista, cap: Capacidades): Promise<ResultadoLista | { error: string }> {
  const conds = condVisitas(cap);
  const { tipo, anio, org, decisor, hora } = p.f;
  const pariente = tipo === "pariente";
  if (pariente && !cap.parientes) return vacia(p);
  if (p.offset > SALTO_MAX) return { error: "pagina_muy_honda" };
  // Las condiciones sobre la visita (tipo, quien decide, horario). En la de familiares, quien decide es el de su tabla
  // (el mismo que cuenta la cifra de arriba).
  const sobreVisita = activas(conds, {
    ...(tipo && !pariente ? { tipo } : {}),
    ...(decisor && !pariente ? { decisor } : {}),
    ...(hora ? { hora } : {}),
  });
  const rango = (col: string) => (anio ? `${col} >= DATE '${anio}-01-01' AND ${col} < DATE '${Number(anio) + 1}-01-01'` : "true");
  const dir = p.orden === "antiguo" ? "ASC" : "DESC";
  const cuantas = p.size + 1;
  const vals: unknown[] = [ruc];

  // Lo buscado: las organizaciones de la entidad que lo nombran, o la elegida en «Ver sus visitas» (con las dos, la
  // elegida si lo buscado la nombra).
  let orgs: string[] | null = null;
  if (p.q || org) {
    if (!cap.pre) return vacia(p);
    if (org) orgs = !p.q || sinTildes(org).includes(sinTildes(p.q)) ? [org] : [];
    else {
      const r = await pool.query<{ org: string }>(
        `SELECT org FROM entidad_visita_org WHERE entidad_ruc = $1 AND (unaccent(org) ILIKE unaccent($2) OR (ruc = $3 AND ruc LIKE '20%'))`,
        [ruc, patron(p.q!), digitos(p.q!)],
      );
      orgs = r.rows.map((x) => x.org);
    }
  }
  const cifras = await cifrasVisitas(ruc, cap);
  const base: Omit<ResultadoLista, "filas" | "total" | "hayMas"> = {
    que: p.que, page: p.page, size: p.size, facetas: facetasVisitas(p, cifras), anios: cifras.anios.map((x) => x.anio),
    ...(orgs && !org ? { organizaciones: orgs.length } : {}),
  };
  if (orgs && !orgs.length) return { ...base, total: 0, hayMas: false, filas: [] };

  let sql: string;
  if (pariente) {
    // Sus familiares: desde su tabla (a lo más ~6,800 en el Congreso), con la fecha y quien decide de ella.
    const decP = decisor ? (decisor === "si" ? "p.decisor" : "NOT p.decisor") : "true";
    let porOrg = "true";
    if (orgs) {
      vals.push(orgs);
      porOrg = `v.entidad_visitante IS NOT NULL AND upper(btrim(v.entidad_visitante)) = ANY($2::text[])`;
    }
    sql = `SELECT ${COLUMNAS_VISITA(cap)}
             FROM entidad_visita_pariente p JOIN visitas_entidades v ON v.id = p.visita_id
            WHERE p.entidad_ruc = $1 AND ${decP} AND ${rango("p.fecha")} AND ${porOrg} AND ${y(Object.values(sobreVisita))}
            ORDER BY p.fecha ${dir}, p.visita_id ${dir} LIMIT ${cuantas} OFFSET ${p.offset}`;
  } else if (orgs) {
    // Por organización: primero los id de TODAS sus visitas en la entidad, por el índice de upper(entidad_visitante) que
    // ya existe junto con el de la entidad (BitmapAnd: SALOG en EsSalud, 3 ms; TECNICA INGENIEROS en el Congreso, 13,800
    // visitas, ~3 s en frío), y después la página. MATERIALIZED: con el LIMIT adentro y una sola organización, Postgres
    // recorría el índice de fechas de las 10,8 M visitas del país esperando dar pronto con 16 (más de 10 s). La
    // organización se guarda sin espacios en los bordes (entidad_visita_org) y el índice es del texto tal cual: van también
    // sus variantes con un espacio antes o después (las que trae el registro).
    vals.push(conBordes(orgs));
    sql = `WITH ids AS MATERIALIZED (
             SELECT v.id, v.fecha_visita FROM visitas_entidades v
              WHERE v.entidad_visitada = ANY (ARRAY(SELECT entidad_visitada FROM visita_entidad_ruc WHERE ruc = $1))
                AND v.entidad_visitante IS NOT NULL AND v.tipo_entidad_visitante <> 'persona_natural'
                AND upper(v.entidad_visitante) = ANY ($2::text[]) AND v.fecha_visita IS NOT NULL
                AND ${rango("v.fecha_visita")} AND ${y(Object.values(sobreVisita))}),
           pagina AS (SELECT id, fecha_visita FROM ids ORDER BY fecha_visita ${dir}, id ${dir} LIMIT ${cuantas} OFFSET ${p.offset})
           SELECT ${COLUMNAS_VISITA(cap)}, (SELECT count(*) FROM ids)::int AS "_cuantas"
             FROM pagina JOIN visitas_entidades v ON v.id = pagina.id
            ORDER BY pagina.fecha_visita ${dir}, pagina.id ${dir}`;
  } else {
    // Las más recientes (o antiguas) de cada nombre de la entidad (el índice entidad_visitada + fecha las da en orden, sin
    // leer las demás) y de ellas, la página. Con «IN (nombres)» la base leía TODAS las visitas de la entidad para
    // ordenarlas: el Congreso (1,2 M) o el MIMP (357 mil) pasaban los 10 s.
    sql = `SELECT ${COLUMNAS_VISITA(cap)}
             FROM visita_entidad_ruc m
             CROSS JOIN LATERAL (
               SELECT v.* FROM visitas_entidades v
                WHERE v.entidad_visitada = m.entidad_visitada AND v.fecha_visita IS NOT NULL AND ${rango("v.fecha_visita")} AND ${y(Object.values(sobreVisita))}
                ORDER BY v.fecha_visita ${dir}, v.id ${dir} LIMIT ${p.offset + cuantas}) v
            WHERE m.ruc = $1
            ORDER BY v.fecha_visita ${dir}, v.id ${dir} LIMIT ${cuantas} OFFSET ${p.offset}`;
  }
  const r = await pool.query(sql, vals);
  const hayMas = r.rows.length > p.size;
  const filas = r.rows.slice(0, p.size).map(({ _cuantas, ...x }) => x);
  // Por organización la consulta cuenta todas las que encontró (con los demás filtros); vacía en la primera página, 0.
  const exacto = orgs && !pariente ? (r.rows[0]?._cuantas ?? (p.offset === 0 ? 0 : null)) : null;
  return { ...base, total: exacto ?? totalVisitas(p, cifras), hayMas, filas };
}

/** Las organizaciones como las guarda entidad_visita_org y con un espacio antes, después o a los dos lados. */
export const conBordes = (orgs: string[]) => [...new Set(orgs.flatMap((o) => [o, `${o} `, ` ${o}`, ` ${o} `]))];

/**
 * El total de la lista de visitas cuando sale de lo precalculado sin recorrer nada: sin filtros, por año, por tipo, a quien
 * decide, por horario o de familiares. Con filtros combinados, null (vale `hayMas`).
 */
export function totalVisitas(p: Pick<PedidoLista, "f" | "q">, c: { r: ResumenVisitas | null; anios: MesVisitas[] }): number | null {
  const { r } = c;
  const dims = Object.keys(p.f);
  const solo = (...permitidas: string[]) => dims.every((d) => permitidas.includes(d));
  // Por organización la cuenta la misma consulta de la página.
  if (p.q || p.f.org) return null;
  if (!r) return null;
  if (!dims.length) return r.total;
  const anio = p.f.anio ? c.anios.find((x) => String(x.anio) === p.f.anio) ?? null : null;
  if (solo("anio")) return anio?.visitas ?? 0;
  if (solo("anio", "tipo") && p.f.tipo === "privada") return anio?.privadas ?? 0;
  if (solo("tipo")) {
    return p.f.tipo === "privada" ? r.privadas : p.f.tipo === "publica" ? r.publicas : p.f.tipo === "persona_natural" ? r.personas : r.parientes;
  }
  if (solo("decisor")) return p.f.decisor === "si" ? r.decisores : r.total - r.decisores;
  if (solo("hora")) return p.f.hora === "fuera" ? r.fuera : r.total - r.fuera;
  return null;
}

/**
 * Cuántas visitas da cada opción, sólo cuando se sabe sin recorrer (ningún otro filtro puesto): el tipo, quien decide y el
 * horario del resumen; los años, de las visitas por mes. Con otros filtros, null: el desplegable va sin número.
 */
export function facetasVisitas(p: Pick<PedidoLista, "f" | "q">, c: { r: ResumenVisitas | null; anios: MesVisitas[] }): ResultadoLista["facetas"] {
  const { r } = c;
  const otros = (dim: string) => !p.q && Object.keys(p.f).every((d) => d === dim);
  const porAnio = (campo: "visitas" | "privadas") => Object.fromEntries(c.anios.map((x) => [String(x.anio), x[campo]]));
  return {
    tipo: r && otros("tipo")
      ? { privada: r.privadas, publica: r.publicas, persona_natural: r.personas, ...(r.parientes != null ? { pariente: r.parientes } : {}) }
      : null,
    decisor: r && otros("decisor") ? { si: r.decisores, no: r.total - r.decisores } : null,
    hora: r && otros("hora") ? { fuera: r.fuera, dentro: r.total - r.fuera } : null,
    anio: otros("anio")
      ? porAnio("visitas")
      : !p.q && Object.keys(p.f).every((d) => d === "anio" || d === "tipo") && p.f.tipo === "privada"
        ? porAnio("privadas")
        : null,
  };
}

const vacia = (p: PedidoLista): ResultadoLista => ({ que: p.que, page: p.page, size: p.size, total: 0, hayMas: false, filas: [], facetas: {} });

/** La página pedida de una lista. Las visitas devuelven sus filas crudas (las publica la ruta: nombres, motivo, enlace). */
export async function paginaLista(ruc: string, p: PedidoLista): Promise<ResultadoLista | { error: string }> {
  const cap = await capacidades();
  switch (p.que) {
    case "empresas":
      return listaEmpresas(ruc, p, cap);
    case "organizaciones":
      return listaOrganizaciones(ruc, p, cap);
    case "areas":
      return listaAreas(ruc, p, cap);
    case "parientes":
      return listaParientes(ruc, p, cap);
    case "visitas":
      return listaVisitas(ruc, p, cap);
  }
}
