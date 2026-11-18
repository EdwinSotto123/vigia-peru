import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";
import { ANTECEDENTES_ORDEN, ORDEN_LISTADA, filasOrdenes, ordenesLigeras, sqlListaOrdenes, type ClaveOrden } from "./ordenes.js";
import { clavesCatalogo, filasCatalogo } from "./catalogo.js";
import { clavesMenores, filasMenores } from "./menores.js";
import { clavesContratos, filasContratos } from "./contratos.js";
import { ListQuery } from "./contratos_sql.js";
import { contratosDeEmpresa } from "./empresas.js";

/**
 * Las compras de una entidad (o las ventas de una empresa) en UNA lista, una fila por compra (migración 240). Antes eran
 * cuatro listas que se repetían: Contratos (procesos de selección), Órdenes (CONOSCE), Menores (≤ 8 UIT) y Catálogo
 * (Perú Compras). Ahora:
 *   · proceso   el proceso de selección, con sus pagos (las órdenes que lo pagan: las de proceso único y, aparte, las que
 *               pueden ser de él o de otro proceso de la misma empresa en la entidad);
 *   · catalogo  la orden de Perú Compras con su orden del SEACE, si la entidad la registró (o la orden del SEACE «por
 *               catálogo» que no se encontró en Perú Compras);
 *   · menor     el contrato menor con su orden del SEACE;
 *   · directa   la orden del SEACE sin concurso que no es nada de lo anterior;
 *   · pago      la orden que dice pagar un proceso de selección sin ningún proceso posible en los datos.
 * Una página en dos pasos: cada fuente da sus llaves (fecha y monto) con su índice de entidad o proveedor, se mezclan y se
 * corta la página, y sólo esas filas se arman con el SQL de cada lista (routes/ordenes.ts, catalogo.ts, menores.ts,
 * contratos.ts y empresas.ts): mismas columnas, mismos antecedentes.
 *   GET /compras?entidad=<RUC>     la pestaña Compras de una entidad
 *   GET /compras?proveedor=<RUC>   las ventas al Estado de una empresa
 * Una bandera o un filtro que sólo tiene una fuente (el sobreprecio del catálogo, los antecedentes de una orden, los
 * filtros de contratos de los enlaces viejos) deja sólo esas compras.
 */
export const comprasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "compras:lista", ttlMs: 600_000, staleMs: 3_600_000, max: 400 });
const memoResumen = new Memo<FilaResumen[]>({ nombre: "compras:resumen", ttlMs: 600_000, staleMs: 3_600_000, max: 400 });

export const CLASES_COMPRA = ["proceso", "catalogo", "menor", "directa", "pago"] as const;
export type ClaseCompra = (typeof CLASES_COMPRA)[number];
type Fuente = "proceso" | "catalogo" | "menor" | "orden";

/** Las banderas que se pueden filtrar y la fuente que las tiene: sólo esas compras pueden llevarlas. */
const BANDERAS = ["sobreprecio", "antecedentes", "sunat", ...ANTECEDENTES_ORDEN] as const;
const FUENTE_BANDERA: Record<(typeof BANDERAS)[number], Fuente> = {
  sobreprecio: "catalogo",
  antecedentes: "proceso",
  sunat: "menor",
  ...(Object.fromEntries(ANTECEDENTES_ORDEN.map((a) => [a, "orden"])) as Record<(typeof ANTECEDENTES_ORDEN)[number], Fuente>),
};

/** Los filtros de la lista de contratos de una entidad que traen los enlaces de sus banderas: dejan sólo procesos. */
const FILTROS_PROCESO = ListQuery.pick({ cruces: true, cruce: true, lectura: true, riesgo: true, tipo: true, etapa: true,
                                         operativo: true, obra: true, desde: true, hasta: true });
const CLAVES_PROCESO = Object.keys(FILTROS_PROCESO.shape) as (keyof z.infer<typeof FILTROS_PROCESO>)[];
const RUC = z.string().regex(/^\d{11}$/);
/** La contraparte o el proveedor por el que se filtra: nunca un RUC 10 (se calcula desde un DNI). */
const RUC_NO_PERSONA = z.string().regex(/^(?!10)\d{11}$/);

export const ComprasQuery = FILTROS_PROCESO.extend({
  entidad: RUC.optional(),
  proveedor: RUC_NO_PERSONA.optional(),
  q: z.string().trim().min(3).max(80).optional(),
  anio: z.coerce.number().int().min(2015).max(2100).optional(),
  como: z.enum(CLASES_COMPRA).optional(),
  // La contraparte: el proveedor en la ficha de una entidad, la entidad en la de una empresa.
  con: RUC_NO_PERSONA.optional(),
  bandera: z.enum(BANDERAS).optional(),
  // Con una bandera de la orden: sólo las de personas naturales (RUC 10) o de empresas (RUC 20), como la lista de órdenes.
  persona: z.enum(["natural", "empresa"]).optional(),
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
}).refine((x) => !!x.entidad !== !!x.proveedor, { message: "entidad o proveedor, uno de los dos" });
export type FiltrosCompras = z.infer<typeof ComprasQuery>;

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

/** ¿Ya está la migración 240? Presente, no se vuelve a preguntar; ausente, cada minuto. */
let tablas: { ok: boolean; at: number } | null = null;
export async function hayCompras(): Promise<boolean> {
  if (tablas && (tablas.ok || Date.now() - tablas.at < 60_000)) return tablas.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT to_regclass('public.compra_vinculo') IS NOT NULL AND to_regclass('public.compra_resumen') IS NOT NULL
              AND to_regclass('public.perucompras_orden') IS NOT NULL AS ok`);
    tablas = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch {
    return false;
  }
  return tablas.ok;
}

/** Una compra de la página antes de armarla: de qué fuente es, su llave y por qué se ordena. */
interface Clave { clase: ClaseCompra; fuente: Fuente; id: string; fecha: string | null; monto: number | null; adjudicado?: number | null; fila?: Record<string, unknown>; llave?: ClaveOrden }

/** La fuente que manda: la de la bandera o la de un filtro que sólo tienen los procesos. Sin ellos, todas. */
export function fuenteFija(q: FiltrosCompras): Fuente | null {
  if (q.bandera) return FUENTE_BANDERA[q.bandera];
  if (CLAVES_PROCESO.some((k) => q[k] != null)) return "proceso";
  return null;
}

comprasRouter.get("/", async (c) => {
  const parsed = ComprasQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  if (!(await hayCompras())) {
    c.header("Cache-Control", cachePublico(60));
    return c.json({ page: q.page, size: q.size, hayMas: false, disponible: false, resumen: null, facetas: null, data: [] });
  }
  const cuerpo = await memo.obtener(JSON.stringify(q), () => armar(q));
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** Cuánto tardó cada paso (ms), en la respuesta: para ver qué se demora en una ficha grande sin instrumentar la base. */
type Tiempos = Record<string, number>;
const cronometro = (t: Tiempos) => <T>(nombre: string, p: Promise<T>): Promise<T> => {
  const t0 = Date.now();
  return p.finally(() => { t[nombre] = Date.now() - t0; });
};

async function armar(q: FiltrosCompras): Promise<Record<string, unknown>> {
  const tiempos: Tiempos = {};
  const medir = cronometro(tiempos);
  const ancla = q.entidad ? "entidad" : "proveedor";
  const ruc = (q.entidad ?? q.proveedor)!;
  const dir = q.orden === "antiguo" ? "ASC" : "DESC";
  const offset = (q.page - 1) * q.size;
  const fija = fuenteFija(q);
  const conResumen = !q.q && !q.bandera && !q.con && !fija;
  const resumen = conResumen ? medir("resumen", resumenDe(ancla, ruc, q)).catch((e) => { console.warn(`[compras] resumen: ${(e as Error).message}`); return null; }) : null;

  let claves: Clave[];
  let hayMas: boolean;
  // Una rama que se pasa de su plazo (procesos con «servicio» en Ate: 500 en toda la lista, 2026-11-07) no tumba a las
  // demás: la lista sale con lo que hubo y `incompleto` dice qué faltó. Otro error sí corta (es un error de verdad).
  const incompleto: string[] = [];
  const tolerante = (nombre: string, rama: Promise<Clave[]>): Promise<Clave[]> => medir(nombre, rama).catch((e: unknown) => {
    const m = String((e as Error)?.message ?? e);
    if (!/statement timeout|Query read timeout/i.test(m)) throw e;
    console.warn(`[compras] ${nombre}: ${m}`);
    incompleto.push(nombre);
    return [];
  });
  if (fija === "orden") {
    // Una bandera de la orden (nepotismo, al borde del tope…): la lista de órdenes con esa bandera, cada una como la
    // compra de la que es parte. Su paginación es la de la lista de órdenes.
    ({ claves, hayMas } = await medir("ordenes_bandera", paginaDeOrdenes(q)));
  } else {
    const n = offset + q.size + 1;
    const quiere = (cl: ClaseCompra) => !q.como || q.como === cl;
    const ramas: Promise<Clave[]>[] = [];
    if ((!fija || fija === "proceso") && quiere("proceso")) ramas.push(tolerante("procesos", ramaProcesos(q, ancla, ruc, n, dir)));
    if ((!fija || fija === "catalogo") && quiere("catalogo")) ramas.push(tolerante("catalogo", ramaCatalogo(q, n, dir)));
    if ((!fija || fija === "menor") && quiere("menor") && (!q.anio || q.anio >= 2024)) ramas.push(tolerante("menores", ramaMenores(q, n, dir)));
    if (!fija && (quiere("directa") || quiere("pago") || quiere("catalogo")) && (!q.anio || q.anio >= 2018)) ramas.push(tolerante("ordenes", ramaOrdenes(q, n, dir)));
    const todas = (await Promise.all(ramas)).flat();
    if (ramas.length && incompleto.length === ramas.length) throw new Error(`compras: todas las ramas pasaron su plazo (${incompleto.join(", ")})`);
    todas.sort((a, b) => compararFecha(a.fecha, b.fecha, dir) || (dir === "DESC" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)));
    claves = todas.slice(offset, offset + q.size);
    hayMas = todas.length > offset + q.size;
  }
  const data = await armarFilas(claves, ancla, ruc, medir);
  const r = await resumen;
  return publicar({
    page: q.page, size: q.size, hayMas, disponible: true, ancla,
    resumen: r ? r.resumen : null,
    facetas: r ? r.facetas : null,
    data,
    ...(incompleto.length ? { incompleto } : {}),
    tiempos,
  });
}

/** Sin fecha, al final en los dos sentidos. */
export function compararFecha(a: string | null, b: string | null, dir: "DESC" | "ASC"): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "DESC" ? (a < b ? 1 : -1) : (a < b ? -1 : 1);
}

// ─── Las ramas: llaves de cada fuente ─────────────────────────────────────────────────────────────────────────────────

async function ramaProcesos(q: FiltrosCompras, ancla: "entidad" | "proveedor", ruc: string, n: number, dir: "DESC" | "ASC"): Promise<Clave[]> {
  if (ancla === "entidad") {
    const filtrosProceso = Object.fromEntries(CLAVES_PROCESO.filter((k) => q[k] != null).map((k) => [k, q[k]]));
    const conFecha = q.anio && !q.desde && !q.hasta ? { desde: `${q.anio}-01-01`, hasta: `${q.anio}-12-31` } : {};
    const k = await clavesContratos({ q: q.q, ...filtrosProceso, ...conFecha,
                                      ...(q.bandera === "antecedentes" ? { cruces: "con" } : {}) }, n, dir, q.con, ruc);
    return k.map((x) => ({ clase: "proceso", fuente: "proceso", id: `p:${x.ocid}`, fecha: x.fecha, monto: x.monto, adjudicado: x.adjudicado }));
  }
  // Una empresa: sus procesos (también en consorcio) ya armados, con su fecha de buena pro.
  const r = await contratosDeEmpresa(ruc, {
    q: q.q && q.q.length >= 2 ? q.q : undefined, anio: q.anio, entidad: q.con, orden: dir === "ASC" ? "antiguo" : "reciente",
    page: 1, size: n, ...(q.bandera === "antecedentes" ? { cruce: "con" } : {}),
  });
  return r.data.map((f) => ({ clase: "proceso", fuente: "proceso", id: `p:${f.codigo}:${f.entidadRuc}`, fecha: (f.fecha as string) ?? null,
                              monto: (f.monto as number) ?? null, adjudicado: (f.monto as number) ?? null, fila: f }));
}

async function ramaCatalogo(q: FiltrosCompras, n: number, dir: "DESC" | "ASC"): Promise<Clave[]> {
  const k = await clavesCatalogo({ entidad: q.entidad, proveedor: q.proveedor, q: q.q, anio: q.anio,
                                   sobreprecio: q.bandera === "sobreprecio" ? "si" : undefined }, n, dir, q.con);
  return k.map((x) => ({ clase: "catalogo", fuente: "catalogo", id: `c:${x.orden}`, fecha: x.fecha, monto: x.monto }));
}

async function ramaMenores(q: FiltrosCompras, n: number, dir: "DESC" | "ASC"): Promise<Clave[]> {
  const k = await clavesMenores({ entidad: q.entidad, proveedor: q.proveedor, q: q.q, anio: q.anio,
                                  antecedente: q.bandera === "sunat" ? "con" : undefined }, n, dir, q.con);
  return k.map((x) => ({ clase: "menor", fuente: "menor", id: `m:${x.id}`, fecha: x.fecha, monto: x.monto }));
}

/**
 * Las órdenes del SEACE que no se juntaron con nada (ni gemela de un catálogo o un menor, ni pago de un proceso posible):
 * la misma ventana por el índice de entidad (o proveedor) y fecha que la lista de órdenes, con el dedup de sus versiones.
 * Con texto, como esa lista, en las más recientes. En cualquier moneda, como esa lista (pedido del usuario del 2026-11-05:
 * las de EsSalud a la OPS en dólares canadienses no salían): el monto de la llave es sólo en soles (NULL en otra moneda;
 * la fila lo trae en la suya). compra_vinculo (240) sólo junta órdenes en soles, así que una en otra moneda sale sola,
 * por cómo se contrató.
 */
async function ramaOrdenes(q: FiltrosCompras, n: number, dir: "DESC" | "ASC"): Promise<Clave[]> {
  const vals: unknown[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  // Los RUC son 11 dígitos validados: como literales, para que el planificador use su índice (ver sqlListaOrdenes).
  const conds = [ORDEN_LISTADA, q.entidad ? `o.entidad_ruc = '${q.entidad}'` : `o.ruc_contratista = '${q.proveedor}'`,
    `NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)`];
  if (q.con) conds.push(q.entidad ? `o.ruc_contratista = '${q.con}'` : `o.entidad_ruc = '${q.con}'`);
  if (q.anio) conds.push(`o.fecha_emision >= make_date(${q.anio}, 1, 1) AND o.fecha_emision < make_date(${q.anio + 1}, 1, 1)`);
  // Con las mismas expresiones que los índices parciales de la migración 240 (pago y catálogo son pocas: sin su índice, una
  // entidad grande recorría todas sus órdenes buscándolas).
  if (q.como === "pago") conds.push(`o.tipo_contratacion ~* '${PAGO}'`);
  else if (q.como === "catalogo") conds.push(`o.tipo_contratacion ~* '${CATALOGO}'`);
  else if (q.como === "directa") conds.push(`COALESCE(o.tipo_contratacion, '') !~* '${PAGO}' AND COALESCE(o.tipo_contratacion, '') !~* '${CATALOGO}'`);
  const palabras = palabrasBusqueda(q.q);
  // Sin el nombre de una persona natural (RUC 10): buscar por su apellido tapado lo destapaba (auditoría del 2026-11-17).
  const texto = palabras.map((w) =>
    `mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || CASE WHEN o.ruc_contratista LIKE '10%' THEN '' ELSE COALESCE(o.contratista, '') END || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
  const ventana = texto.length ? Math.max(1500, n * 6) : Math.ceil(n * 1.02) + 20;
  const columnas = `o.entidad_ruc, o.orden, o.fecha_emision, o.anio, o.mes, o.monto, o.monto_dudoso, o.moneda, o.tipo_contratacion,
                    o.ruc_contratista, o.descripcion, o.entidad, o.contratista, o.nro_orden`;
  // Con texto, además de la ventana de las más recientes (que es donde se busca el proveedor), lo que se compró y el número
  // de orden en TODOS los años: antes sólo en la ventana, y en una entidad grande 1 500 órdenes son unos meses (Ate:
  // «aniversario» daba 2 órdenes, y había 24 desde 2018; el enlace a una orden de 2023 caía en una lista vacía).
  const historia = condicionHistoria(palabras, p);
  const r = await consultaConPlazo(historia
    ? `WITH a AS (SELECT ${columnas}, true AS h FROM conosce_ordenes o WHERE ${conds.join(" AND ")} AND ${historia} LIMIT ${TOPE_HISTORIA}),
            w AS (SELECT ${columnas}, false AS h FROM conosce_ordenes o WHERE ${conds.join(" AND ")} ORDER BY o.fecha_emision ${dir} LIMIT ${ventana}),
            c AS (SELECT x.*, bool_or(x.h) OVER (PARTITION BY x.entidad_ruc, x.orden, x.fecha_emision) AS en_historia
                    FROM (SELECT * FROM a UNION ALL SELECT * FROM w) x),
            d AS (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.* FROM c o
                   ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
       SELECT o.entidad_ruc AS e, o.orden AS n, to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.ruc_contratista AS p,
              CASE WHEN o.moneda = 'Nuevos Soles' THEN COALESCE(o.monto, o.monto_dudoso)::float END AS monto,
              clase_orden(o.tipo_contratacion) AS clase
         FROM d o WHERE o.en_historia OR (${texto.join(" AND ")})
        ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${n}`
    : `WITH c AS (SELECT ${columnas} FROM conosce_ordenes o WHERE ${conds.join(" AND ")} ORDER BY o.fecha_emision ${dir} LIMIT ${ventana}),
          d AS (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.* FROM c o
                 ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
     SELECT o.entidad_ruc AS e, o.orden AS n, to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.ruc_contratista AS p,
            CASE WHEN o.moneda = 'Nuevos Soles' THEN COALESCE(o.monto, o.monto_dudoso)::float END AS monto,
            clase_orden(o.tipo_contratacion) AS clase
       FROM d o ${texto.length ? `WHERE ${texto.join(" AND ")}` : ""}
      ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${n}`, vals);
  return (r.rows as { e: string; n: string; fecha: string; p: string | null; monto: number | null; clase: ClaseCompra }[]).map((x) => ({
    clase: x.clase, fuente: "orden", id: `o:${x.e}:${x.fecha}:${x.n}`, fecha: x.fecha, monto: x.monto,
    llave: { entidad: x.e, orden: x.n, fecha: x.fecha, proveedor: x.p },
  }));
}

/**
 * Cuántas órdenes que calzan con el texto se miran en toda la historia. Sin ORDER BY: así el planificador elige solo. Con
 * una palabra rara cruza el índice de texto con el de la entidad (Ate, «aniversario»: 24 órdenes, 0,16 s); con una común
 * («servicio», 17 mil en Ate) recorre el de la entidad y para en el tope (0,34 s), y las más recientes salen de la ventana.
 */
const TOPE_HISTORIA = 3001;

/** El texto que indexa la migración 255 (gasto.ts usa el mismo): tiene que coincidir al carácter para usar el índice. */
const TSV_DESCRIPCION = "to_tsvector('spanish'::regconfig, translate(lower(coalesce(o.descripcion, '')), 'áéíóúüñ', 'aeiouun'))";

/** Palabras que to_tsquery descarta (y con «:*» dejarían la consulta vacía): no se buscan en la descripción. */
const VACIAS_TEXTO = new Set(["DEL", "LAS", "LOS", "POR", "CON", "UNA", "SIN", "PARA", "UNOS", "UNAS"]);

/**
 * La condición para buscar en toda la historia, o null si no hay qué buscar ahí. Las palabras (ya en mayúsculas, sin
 * tildes y sólo letras y cifras: palabrasBusqueda) van TODAS en la descripción, por prefijo y en español («aniversario»
 * también encuentra «aniversarios»). Un número solo es un número de orden («6076»: los enlaces a una orden lo usan).
 */
export function condicionHistoria(palabras: string[], p: (v: unknown) => string): string | null {
  const utiles = palabras.filter((w) => !VACIAS_TEXTO.has(w));
  if (!utiles.length) return null;
  if (utiles.every((w) => /^\d+$/.test(w))) return `o.nro_orden = ANY(${p(utiles)}::text[])`;
  return `${TSV_DESCRIPCION} @@ to_tsquery('spanish', ${p(utiles.map((w) => `${w.toLowerCase()}:*`).join(" & "))})`;
}

/** Cómo se contrató una orden que es pago de un proceso o compra por catálogo (las expresiones de clase_orden, migración 240). */
const PAGO = "^deviene de";
const CATALOGO = "^derivad[oa] de contrataci.n por cat.logo";

/** Con una bandera de la orden: la página de la lista de órdenes con esa bandera (sqlListaOrdenes, tal cual). */
async function paginaDeOrdenes(q: FiltrosCompras): Promise<{ claves: Clave[]; hayMas: boolean }> {
  if (q.anio && q.anio < 2018) return { claves: [], hayMas: false };
  const entidad = q.entidad ?? q.con;
  const proveedor = q.proveedor ?? (q.entidad ? q.con : undefined);
  const s = sqlListaOrdenes({
    entidad, proveedor: q.proveedor ? q.proveedor : proveedor, anio: q.anio, q: q.q,
    antecedente: q.bandera as (typeof ANTECEDENTES_ORDEN)[number], persona: q.persona, orden: q.orden, page: q.page, size: q.size,
  });
  const r = await consultaConPlazo(s.sql, s.vals, 45_000);
  const filas = r.rows as Record<string, unknown>[];
  return {
    hayMas: filas.length > q.size,
    claves: filas.slice(0, q.size).map((f) => ({
      clase: "directa", fuente: "orden", id: `o:${f.entidadRuc}:${f.fecha}:${f.orden}`, fecha: f.fecha as string, monto: f.monto as number,
      fila: f, llave: { entidad: f.entidadRuc as string, orden: f.orden as string, fecha: f.fecha as string, proveedor: (f.rucContratista as string) ?? null },
    })),
  };
}

// ─── Armar las filas de la página ─────────────────────────────────────────────────────────────────────────────────────

interface Vinculo { clase: "catalogo" | "menor" | "proceso"; ref: string | null; candidatos: number; e: string; n: string; fecha: string; p: string | null }

/** Cuántos pagos de un proceso van en su fila (los demás se cuentan). */
const PAGOS_FILA = 24;

async function armarFilas(claves: Clave[], ancla: "entidad" | "proveedor", ruc: string,
                          medir: ReturnType<typeof cronometro>): Promise<Record<string, unknown>[]> {
  if (!claves.length) return [];
  const de = (f: Fuente) => claves.filter((k) => k.fuente === f);
  const ocids = ancla === "entidad" ? de("proceso").map((k) => k.id.slice(2)) : [];
  const ordenesCat = de("catalogo").map((k) => k.id.slice(2));
  const idsMen = de("menor").map((k) => Number(k.id.slice(2)));
  const llaves = de("orden").map((k) => k.llave!);

  // Con qué se juntó cada orden de la página (las de una bandera pueden ser gemelas de un catálogo o un menor) y la orden
  // del SEACE de cada catálogo y menor de la página.
  const [vinOrdenes, gemelas] = await medir("vinculos", Promise.all([
    llaves.length
      ? consultaConPlazo(
          `SELECT v.clase, v.ref, v.candidatos, v.entidad_ruc AS e, v.orden AS n, to_char(v.fecha_emision, 'YYYY-MM-DD') AS fecha, v.proveedor_ruc AS p
             FROM unnest($1::text[], $2::text[], $3::date[]) AS k(e, n, f)
             JOIN compra_vinculo v ON v.entidad_ruc = k.e AND v.orden = k.n AND v.fecha_emision = k.f`,
          [llaves.map((k) => k.entidad), llaves.map((k) => k.orden), llaves.map((k) => k.fecha)]).then((r) => r.rows as Vinculo[])
      : Promise.resolve([] as Vinculo[]),
    ordenesCat.length || idsMen.length
      ? consultaConPlazo(
          `SELECT v.clase, v.ref, v.candidatos, v.entidad_ruc AS e, v.orden AS n, to_char(v.fecha_emision, 'YYYY-MM-DD') AS fecha, v.proveedor_ruc AS p
             FROM compra_vinculo v
            WHERE (v.clase = 'catalogo' AND v.ref = ANY($1::text[])) OR (v.clase = 'menor' AND v.ref = ANY($2::text[]))`,
          [ordenesCat, idsMen.map(String)]).then((r) => r.rows as Vinculo[])
      : Promise.resolve([] as Vinculo[]),
  ]));
  const vinDe = new Map(vinOrdenes.map((v) => [`${v.e}:${v.fecha}:${v.n}`, v]));
  // Las órdenes de una bandera que son la orden del SEACE de un catálogo o un menor se muestran como esa compra.
  for (const k of claves) {
    if (k.fuente !== "orden") continue;
    const v = vinDe.get(`${k.llave!.entidad}:${k.llave!.fecha}:${k.llave!.orden}`);
    if (v?.clase === "catalogo" && v.ref) { k.clase = "catalogo"; ordenesCat.push(v.ref); gemelas.push(v); }
    else if (v?.clase === "menor" && v.ref) { k.clase = "menor"; idsMen.push(Number(v.ref)); gemelas.push(v); }
    else if (v?.clase === "proceso") k.clase = "pago";
    else if (k.fila) k.clase = claseDeOrden(k.fila.tipoContratacion as string | null);
  }
  const llavesGemelas = gemelas.map((v) => ({ entidad: v.e, orden: v.n, fecha: v.fecha, proveedor: v.p }));
  const sinFila = [...llaves.filter((l) => !claves.some((k) => k.llave === l && k.fila)), ...llavesGemelas];

  const [procesos, catalogo, menores, ordenes] = await Promise.all([
    medir("filas_procesos", filasContratos(ocids)),
    medir("filas_catalogo", filasCatalogo([...new Set(ordenesCat)])),
    medir("filas_menores", filasMenores([...new Set(idsMen)])),
    medir("filas_ordenes", filasOrdenes(unicas(sinFila))),
  ]);
  const porOcid = new Map(procesos.map((f) => [String(f.ocid), f]));
  const porOrdenCat = new Map(catalogo.map((f) => [String(f.orden), f]));
  const porMenor = new Map(menores.map((f) => [String(f.id), f]));
  const llaveDe = (f: Record<string, unknown>) => `${f.entidadRuc}:${f.fecha}:${f.orden}`;
  const porOrden = new Map(ordenes.map((f) => [llaveDe(f), f]));
  for (const k of claves) if (k.fila && k.fuente === "orden") porOrden.set(llaveDe(k.fila), k.fila);
  const gemelaDe = new Map(gemelas.map((v) => [`${v.clase}:${v.ref}`, porOrden.get(`${v.e}:${v.fecha}:${v.n}`) ?? null]));

  // Los pagos de los procesos de la página.
  const filasProceso = claves.filter((k) => k.fuente === "proceso").map((k) => (ancla === "entidad" ? porOcid.get(k.id.slice(2)) : k.fila)).filter(Boolean) as Record<string, unknown>[];
  const pagos = await medir("pagos", pagosDe(filasProceso, ancla, ruc)).catch((e) => { console.warn(`[compras] pagos: ${(e as Error).message}`); return new Map<string, unknown>(); });
  // De qué proceso es el pago (las órdenes de una bandera que pagan un proceso).
  const procesoDePago = await medir("proceso_de_pago", procesosDePago(vinOrdenes.filter((v) => v.clase === "proceso"))).catch(() => new Map<string, unknown>());

  return claves.map((k) => {
    const base = { clase: k.clase, id: k.id, fecha: k.fecha, monto: k.monto };
    if (k.fuente === "proceso") {
      const fila = ancla === "entidad" ? porOcid.get(k.id.slice(2)) : k.fila;
      return { ...base, adjudicado: k.adjudicado ?? null, proceso: fila ?? null, pagos: fila ? pagos.get(String(fila.codigo)) ?? null : null };
    }
    if (k.fuente === "catalogo") {
      const ref = k.id.slice(2);
      return { ...base, catalogo: porOrdenCat.get(ref) ?? null, orden: gemelaDe.get(`catalogo:${ref}`) ?? null };
    }
    if (k.fuente === "menor") {
      const ref = k.id.slice(2);
      return { ...base, menor: porMenor.get(ref) ?? null, orden: gemelaDe.get(`menor:${ref}`) ?? null };
    }
    // Una orden: sola, o (con una bandera) como su catálogo, su menor o el pago de un proceso.
    const clave = `${k.llave!.entidad}:${k.llave!.fecha}:${k.llave!.orden}`;
    const orden = porOrden.get(clave) ?? null;
    const v = vinDe.get(clave);
    if (k.clase === "catalogo" && v?.ref) return { ...base, catalogo: porOrdenCat.get(v.ref) ?? null, orden };
    if (k.clase === "menor" && v?.ref) return { ...base, menor: porMenor.get(v.ref) ?? null, orden };
    return { ...base, orden, pagoDe: v?.clase === "proceso" ? procesoDePago.get(clave) ?? { candidatos: v.candidatos } : null };
  });
}

const unicas = (ks: ClaveOrden[]) => [...new Map(ks.map((k) => [`${k.entidad}:${k.fecha}:${k.orden}`, k])).values()];

/** La clase de una orden por cómo se contrató (la misma regla que clase_orden() de la migración 240). */
export function claseDeOrden(tipo: string | null): ClaseCompra {
  if (tipo && /^deviene de/i.test(tipo)) return "pago";
  if (tipo && /^derivad[oa] de contrataci.n por cat.logo/i.test(tipo)) return "catalogo";
  return "directa";
}

/**
 * Los pagos de cada proceso de la página, por su código: las órdenes de proceso único (las de ese proceso, hasta
 * PAGOS_FILA y el total) y, aparte, las que pueden ser de él o de otro proceso que la misma empresa ganó en la entidad
 * (cuántas y las más recientes), de la buena pro de cada ganador en adelante (3 años, la regla de la migración 240).
 */
async function pagosDe(filas: Record<string, unknown>[], ancla: "entidad" | "proveedor", ruc: string): Promise<Map<string, unknown>> {
  const codigos = [...new Set(filas.map((f) => f.codigo).filter(Boolean).map(String))];
  if (!codigos.length) return new Map();
  const [unicos, pagado, ganadores] = await Promise.all([
    consultaConPlazo(
      `SELECT v.ref, v.entidad_ruc AS e, v.orden AS n, to_char(v.fecha_emision, 'YYYY-MM-DD') AS fecha, v.proveedor_ruc AS p,
              count(*) OVER (PARTITION BY v.ref)::int AS total
         FROM compra_vinculo v WHERE v.clase = 'proceso' AND v.ref = ANY($1::text[])
        ORDER BY v.ref, v.fecha_emision DESC`, [codigos]),
    // Cuánto suman todas sus órdenes (cada una en su versión más nueva, sin las de monto dudoso). Sólo las en soles: hoy
    // compra_vinculo no junta otras, pero si un día lo hace, un dólar no se suma como un sol.
    consultaConPlazo(
      `SELECT v.ref, sum(o.monto) FILTER (WHERE o.moneda = 'Nuevos Soles')::float AS pagado
         FROM compra_vinculo v
         CROSS JOIN LATERAL (SELECT x.monto, x.moneda FROM conosce_ordenes x
                              WHERE x.entidad_ruc = v.entidad_ruc AND x.ruc_contratista = v.proveedor_ruc AND x.fecha_emision = v.fecha_emision
                                AND x.orden = v.orden
                              ORDER BY x.anio DESC, x.mes DESC LIMIT 1) o
        WHERE v.clase = 'proceso' AND v.ref = ANY($1::text[])
        GROUP BY v.ref`, [codigos]),
    consultaConPlazo(
      // Cada ítem una vez (CONOSCE lo repite en los archivos de cada año): la buena pro y lo adjudicado a cada ganador.
      `WITH a AS (SELECT DISTINCT ON (codigo_convocatoria, n_item, ruc_proveedor) codigo_convocatoria, entidad_ruc, ruc_proveedor,
                         fecha_buenapro, monto_adjudicado, moneda
                    FROM conosce_adjudicaciones
                   WHERE codigo_convocatoria = ANY($1::text[]) AND ruc_proveedor ~ '^[0-9]{11}$'
                     ${ancla === "proveedor" ? `AND ruc_proveedor = '${ruc}'` : ""}
                   ORDER BY codigo_convocatoria, n_item, ruc_proveedor, anio DESC)
       SELECT codigo_convocatoria AS codigo, entidad_ruc AS e, ruc_proveedor AS p, to_char(min(fecha_buenapro), 'YYYY-MM-DD') AS f,
              sum(monto_adjudicado) FILTER (WHERE moneda IN ('Soles', 'Nuevos Soles'))::float AS adjudicado
         FROM a WHERE fecha_buenapro IS NOT NULL GROUP BY 1, 2, 3`, [codigos]),
  ]);
  const g = ganadores.rows as { codigo: string; e: string; p: string; f: string; adjudicado: number | null }[];
  const posibles = g.length
    ? (await consultaConPlazo(
        `SELECT k.codigo, x.n, y.muestra
           FROM unnest($1::text[], $2::text[], $3::text[], $4::date[]) AS k(codigo, e, p, f)
           CROSS JOIN LATERAL (
             SELECT count(*)::int AS n FROM compra_vinculo v
              WHERE v.clase = 'proceso' AND v.candidatos > 1 AND v.entidad_ruc = k.e AND v.proveedor_ruc = k.p
                AND v.fecha_emision BETWEEN k.f AND k.f + 1095) x
           -- Las 5 más recientes, por el índice (sin juntar las miles de una empresa grande para quedarse con 5).
           CROSS JOIN LATERAL (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('e', m.entidad_ruc, 'n', m.orden, 'fecha', to_char(m.fecha_emision, 'YYYY-MM-DD'),
                                                          'p', m.proveedor_ruc, 'candidatos', m.candidatos) ORDER BY m.fecha_emision DESC), '[]') AS muestra
               FROM (SELECT v.* FROM compra_vinculo v
                      WHERE v.clase = 'proceso' AND v.candidatos > 1 AND v.entidad_ruc = k.e AND v.proveedor_ruc = k.p
                        AND v.fecha_emision BETWEEN k.f AND k.f + 1095
                      ORDER BY v.fecha_emision DESC LIMIT 5) m) y
          WHERE x.n > 0`,
        [g.map((x) => x.codigo), g.map((x) => x.e), g.map((x) => x.p), g.map((x) => x.f)])).rows as
        { codigo: string; n: number; muestra: { e: string; n: string; fecha: string; p: string | null; candidatos: number }[] }[]
    : [];
  const filasUnicas = unicos.rows as { ref: string; e: string; n: string; fecha: string; p: string | null; total: number }[];
  const recortadas: typeof filasUnicas = [];
  const vistos = new Map<string, number>();
  for (const u of filasUnicas) {
    const c = (vistos.get(u.ref) ?? 0) + 1;
    vistos.set(u.ref, c);
    if (c <= PAGOS_FILA) recortadas.push(u);
  }
  const ligeras = await ordenesLigeras(unicas([
    ...recortadas.map((u) => ({ entidad: u.e, orden: u.n, fecha: u.fecha, proveedor: u.p })),
    ...posibles.flatMap((x) => x.muestra.map((m) => ({ entidad: m.e, orden: m.n, fecha: m.fecha, proveedor: m.p }))),
  ]));
  const porLlave = new Map(ligeras.map((o) => [`${o.entidadRuc}:${o.fecha}:${o.orden}`, o]));
  const out = new Map<string, unknown>();
  for (const codigo of codigos) {
    const mios = recortadas.filter((u) => u.ref === codigo);
    const pos = posibles.filter((x) => x.codigo === codigo);
    if (!mios.length && !pos.length) continue;
    const adj = g.filter((x) => x.codigo === codigo && x.adjudicado != null);
    out.set(codigo, {
      // Lo adjudicado a sus ganadores en CONOSCE, para decir cuánto de eso ya se pagó.
      adjudicado: adj.length ? adj.reduce((s, x) => s + (x.adjudicado ?? 0), 0) : null,
      total: filasUnicas.find((u) => u.ref === codigo)?.total ?? 0,
      pagado: (pagado.rows as { ref: string; pagado: number | null }[]).find((x) => x.ref === codigo)?.pagado ?? null,
      lista: mios.map((u) => porLlave.get(`${u.e}:${u.fecha}:${u.n}`)).filter(Boolean),
      posibles: pos.length
        ? {
            n: pos.reduce((s, x) => s + x.n, 0),
            muestra: pos.flatMap((x) => x.muestra.map((m) => ({ ...(porLlave.get(`${m.e}:${m.fecha}:${m.n}`) ?? {}), candidatos: m.candidatos })))
              .filter((m) => "orden" in m).slice(0, 5),
          }
        : null,
    });
  }
  return out;
}

/** El proceso que paga cada orden de proceso único (su código, su OCID y de qué trata), por la llave de la orden. */
async function procesosDePago(vins: Vinculo[]): Promise<Map<string, unknown>> {
  const conRef = vins.filter((v) => v.ref);
  const out = new Map<string, unknown>();
  for (const v of vins) if (!v.ref) out.set(`${v.e}:${v.fecha}:${v.n}`, { candidatos: v.candidatos });
  if (!conRef.length) return out;
  const r = await consultaConPlazo(
    `SELECT DISTINCT ON (c.codigo) c.codigo, c.ocid, c.objeto AS titulo FROM convocatorias c WHERE c.codigo = ANY($1::text[])
      ORDER BY c.codigo, c.ocid`, [[...new Set(conRef.map((v) => v.ref!))]]);
  const porCodigo = new Map((r.rows as { codigo: string; ocid: string; titulo: string | null }[]).map((x) => [x.codigo, x]));
  for (const v of conRef) out.set(`${v.e}:${v.fecha}:${v.n}`, { candidatos: 1, codigo: v.ref, ocid: porCodigo.get(v.ref!)?.ocid ?? null,
                                                                titulo: porCodigo.get(v.ref!)?.titulo ?? null });
  return out;
}

// ─── El resumen: cuántas compras de cada clase y año (cada una una vez) ──────────────────────────────────────────────

interface FilaResumen { clase: ClaseCompra; anio: number; compras: number; monto: number }

/**
 * Los números de la cabecera y de los filtros, con los demás filtros puestos: de una entidad, de compra_resumen (migración
 * 240); de una empresa, en vivo (tiene índice por proveedor en cada fuente). Sin texto ni bandera ni contraparte: con
 * ellos, la lista no los muestra.
 */
async function resumenDe(ancla: "entidad" | "proveedor", ruc: string, q: FiltrosCompras) {
  const filas = await memoResumen.obtener(`${ancla}:${ruc}`, async () => {
    if (ancla === "entidad") {
      const r = await consultaConPlazo(`SELECT clase, anio, compras, monto::float AS monto FROM compra_resumen WHERE entidad_ruc = '${ruc}'`, []);
      return r.rows as FilaResumen[];
    }
    const r = await consultaConPlazo(sqlResumenProveedor(ruc), [], 25_000);
    return r.rows as FilaResumen[];
  });
  const pasaAnio = (f: FilaResumen) => !q.anio || f.anio === q.anio;
  const pasaComo = (f: FilaResumen) => !q.como || f.clase === q.como;
  const como: Record<string, number> = {};
  const anio: Record<string, number> = {};
  let compras = 0;
  let monto = 0;
  for (const f of filas) {
    if (pasaAnio(f)) como[f.clase] = (como[f.clase] ?? 0) + f.compras;
    if (pasaComo(f) && f.anio > 0) anio[f.anio] = (anio[f.anio] ?? 0) + f.compras;
    if (pasaAnio(f) && pasaComo(f)) { compras += f.compras; monto += f.monto; }
  }
  return { resumen: { compras, monto }, facetas: { como, anio } };
}

/**
 * El resumen de una empresa con las mismas reglas que compra_resumen: cada compra una vez, por clase y año. Las órdenes en
 * otra moneda cuentan (la lista las muestra: una empresa que sólo vende en dólares, como la OPS a EsSalud, decía «0
 * compras») pero no se suman a los soles. compra_resumen (240), el de una entidad, todavía no las cuenta.
 */
function sqlResumenProveedor(ruc: string): string {
  return `SELECT clase, anio, count(*)::int AS compras, COALESCE(sum(monto), 0)::float AS monto FROM (
      SELECT clase_orden(o.tipo_contratacion) AS clase, extract(year FROM o.fecha_emision)::int AS anio,
             CASE WHEN o.monto_dudoso IS NULL AND o.moneda = 'Nuevos Soles' THEN o.monto END AS monto
        FROM (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
                FROM conosce_ordenes o WHERE o.ruc_contratista = '${ruc}' AND ${ORDEN_LISTADA}
               ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC) o
       WHERE NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)
      UNION ALL
      SELECT 'catalogo', extract(year FROM p.fecha_publicacion)::int,
             CASE WHEN p.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA') THEN p.total END
        FROM perucompras_orden p WHERE p.proveedor_ruc = '${ruc}'
      UNION ALL
      SELECT 'menor', extract(year FROM m.fecha_suscripcion)::int, m.monto FROM seace_menores m WHERE m.proveedor_ruc = '${ruc}' AND m.monto > 0
      UNION ALL
      SELECT 'proceso', COALESCE(extract(year FROM max(a.fecha_buenapro))::int, 0),
             sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('PEN', 'Soles', 'SOLES', 'Nuevos Soles'))
        FROM (SELECT * FROM conosce_adjudicaciones WHERE ruc_proveedor = '${ruc}'
              UNION ALL
              SELECT * FROM conosce_adjudicaciones
               WHERE ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = '${ruc}')
                 AND ruc_proveedor !~ '^(10|20)[0-9]{9}$') a
       GROUP BY a.codigo_convocatoria, a.entidad_ruc
    ) x WHERE anio IS NOT NULL GROUP BY 1, 2`;
}
