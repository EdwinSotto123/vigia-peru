import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, esErrorPg } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * Órdenes de compra y de servicio de TODO el Estado (CONOSCE), como subsección de Contratos. A diferencia de
 * /empresas/:ruc/ordenes y /personas/:codigo/ordenes, no está atada a un RUC: es la lista general.
 *
 * Rendimiento: se apoya en el índice btree conosce_ordenes(fecha_emision) (migración 127). La consulta toma una VENTANA
 * de candidatas por ese índice —las más recientes, o las del año/entidad/proveedor elegidos— con `ORDER BY fecha_emision
 * DESC LIMIT`, las deduplica (un archivo mensual puede repetir una orden) y pagina. Así nunca ordena ni dedup-ea las
 * ~28 M filas enteras. Cada orden se muestra en un panel; no tiene página propia.
 *   GET /ordenes
 */
export const ordenesRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "ordenes:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });

// La lista de años para el filtro, en JS (sin tocar la base): 2018..año actual. Evita cualquier escaneo global.
const listaAnios = (): number[] => {
  const max = new Date().getFullYear();
  const out: number[] = [];
  for (let y = max; y >= 2018; y--) out.push(y);
  return out;
};

/** Cómo escribe CONOSCE cada estado (las anuladas no se listan). En la URL, en minúsculas. */
export const ESTADOS_ORDEN = { emitida: "Emitida", comprometida: "Comprometida", devengada: "Devengada" } as const;

/**
 * Cómo se contrató (`tipo_contratacion`), por el COMIENZO del texto de CONOSCE: el resto cambia de un año a otro
 * («hasta 8 UIT (LEY 30225)(No incluye…)», «hasta 3 UIT (DL 1017)…»), y el de hasta 8 UIT nombra también al catálogo
 * electrónico. Las mismas formas que `tipoContratacion` de la web (lib/personas.ts). Lo raro (convenios entre entidades,
 * regímenes especiales, decretos de urgencia: 1 de cada 2 mil) no tiene opción.
 */
export const COMO_ORDEN = {
  hasta_uit: "^contrataciones hasta [0-9]+ uit",
  sin_proceso: "^otras contrataciones sin proceso",
  proceso: "^deviene de procesos de selecci",
  directa: "^deviene de exoneraci",
  catalogo: "^derivad[oa] de contrataci.n por cat.logo",
  servicio_publico: "^servicio p.blico",
} as const;

/**
 * El monto en tramos (soles), sobre `monto`: el dudoso (migración 98) es NULL ahí y no entra en ningún tramo. Como
 * literales: con ellos el planificador puede usar el índice parcial de las órdenes grandes (migración 143).
 */
export const MONTO_ORDEN = {
  hasta_1k: "o.monto <= 1000",
  "1k_10k": "o.monto > 1000 AND o.monto <= 10000",
  "10k_50k": "o.monto > 10000 AND o.monto <= 50000",
  "50k_500k": "o.monto > 50000 AND o.monto <= 500000",
  mas_500k: "o.monto > 500000",
} as const;

/** Antecedentes de la orden que se pueden filtrar: el parentesco con un funcionario y las órdenes partidas. */
export const ANTECEDENTES_ORDEN = ["nepotismo", "fraccionamiento"] as const;

const enumDe = <T extends Record<string, unknown>>(o: T) => z.enum(Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]]);

export const ListaOrdenesQuery = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  region: z.string().trim().min(2).max(40).optional(), // departamento (nombre); se compara normalizado
  tipo: z.enum(["compra", "servicio"]).optional(),
  // Antes texto libre comparado tal cual («Emitida»): ahora uno de los tres, en cualquier caja.
  estado: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), enumDe(ESTADOS_ORDEN)).optional(),
  dudosa: z.enum(["si"]).optional(),
  // Quién recibió la orden: una persona natural (RUC 10) o una empresa (RUC 20).
  persona: z.enum(["natural", "empresa"]).optional(),
  como: enumDe(COMO_ORDEN).optional(),
  monto: enumDe(MONTO_ORDEN).optional(),
  antecedente: z.enum(ANTECEDENTES_ORDEN).optional(),
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
export type FiltrosListaOrdenes = z.infer<typeof ListaOrdenesQuery>;

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

/** El departamento como lo compara el filtro: CONOSCE escribe «PROV.CONSTITUC.DEL CALLAO» y las entidades, «Callao». */
const DEPARTAMENTO = `mef_norm(replace(COALESCE(o.departamento, ''), 'PROV.CONSTITUC.DEL ', ''))`;

/** La orden es parte de un grupo de órdenes del mismo día que juntas pasan 8 UIT (ordenes_fraccionadas, migración 51). */
const FRACCIONADA = `FROM ordenes_fraccionadas f WHERE f.entidad_ruc = o.entidad_ruc AND f.fecha = o.fecha_emision
                      AND f.ruc_contratista = o.ruc_contratista AND f.detalle @> jsonb_build_array(jsonb_build_object('orden', o.orden))`;

/**
 * El proveedor estaba inhabilitado por el Tribunal de Contrataciones el día en que se emitió la orden: la misma regla que
 * la señal «inhabilitado» de las personas (migración 91), para personas y empresas.
 */
const INHABILITADO = `FROM osce_sancionados s WHERE s.ruc = o.ruc_contratista AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
                       AND o.fecha_emision BETWEEN s.fecha_desde AND COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END)`;

const COLS = `to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.departamento,
              o.nro_orden AS numero, o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, o.contratista,
              o.ruc_contratista AS "rucContratista", COALESCE(o.monto, o.monto_dudoso)::float AS monto,
              o.monto_dudoso::float AS "montoDudoso", o.dudoso_motivo AS "dudosoMotivo",
              o.tipo_contratacion AS "tipoContratacion", o.estado,
              o.objeto, to_char(o.fecha_notificacion, 'YYYY-MM-DD') AS "fechaNotificacion",
              to_char(o.fecha_compromiso, 'YYYY-MM-DD') AS "fechaCompromiso",
              EXISTS (SELECT 1 FROM persona_senal ps WHERE ps.tipo = 'nepotismo'
                        AND ps.entidad_ruc = o.entidad_ruc AND ps.ruc = o.ruc_contratista) AS "conNepotismo",
              -- La evidencia de cada antecedente de la fila, para su bandera y su panel (subconsultas por fila de la página).
              (SELECT jsonb_build_object('ordenes', f.ordenes, 'total', f.total::float, 'tope', f.tope::float,
                                         'mismaDescripcion', f.misma_descripcion, 'severidad', f.severidad, 'detalle', f.detalle)
                 ${FRACCIONADA} LIMIT 1) AS fraccionamiento,
              (SELECT jsonb_build_object('tipo', s.tipo, 'resolucion', s.resolucion, 'desde', to_char(s.fecha_desde, 'YYYY-MM-DD'),
                                         'hasta', to_char(s.fecha_hasta, 'YYYY-MM-DD'))
                 ${INHABILITADO} ORDER BY s.fecha_desde DESC LIMIT 1) AS inhabilitacion`;

/**
 * La consulta de una página. Filtros en dos lugares:
 *   · en la VENTANA (el `WHERE` que recorre el índice por fecha, o el de entidad/proveedor): entidad, proveedor y año
 *     (los acota el índice), el posible error (índice parcial conosce_ordenes_dudoso), el parentesco (se parte de las
 *     ~400 parejas de persona_senal) y, sin búsqueda de texto, todos los demás. El índice entrega sólo las que cumplen,
 *     así que basta una ventana del tamaño de la página (más un margen para el dedup, que quita 1 de cada 5 mil) y cada
 *     página sale llena: antes estado, tipo y región filtraban DESPUÉS de una ventana fija de 1 500 y una segunda página
 *     de «devengadas» salía con 20 y decía «de 48».
 *     Las columnas filtradas no cambian entre los archivos mensuales que repiten una orden, salvo el estado (1 orden de
 *     20 mil repetida con otro estado, medido 2026-10-26): filtrar antes o después del dedup da lo mismo.
 *   · DESPUÉS de la ventana (`acotada`): con búsqueda de texto siempre, y si la consulta completa no termina a tiempo
 *     (la ruta). Se buscan en las 1 500 más recientes (o más con región), como antes: un texto raro con un filtro raro,
 *     o un estado raro entre las órdenes recientes de una entidad enorme (EsSalud: la primera «devengada» después de 50
 *     mil órdenes, 14 s en frío), dentro del índice recorría media tabla.
 * `ventana` es cuántas órdenes recientes se revisaron cuando la lista quedó `acotada` (si no, null); `acotable`, si hay
 * una versión acotada a la que pasar (filtros dentro del índice que se pueden mover después de la ventana).
 */
export function sqlListaOrdenes(q: FiltrosListaOrdenes, forzarAcotada = false): { sql: string; vals: unknown[]; acotada: boolean; acotable: boolean; ventana: number | null } {
  const anclado = !!(q.entidad || q.proveedor);
  const vals: unknown[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const base = [`o.moneda = 'Nuevos Soles'`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`,
                `o.fecha_emision >= DATE '2018-01-01'`, `o.fecha_emision <= current_date + 31`, `o.entidad_ruc ~ '^[0-9]{11}$'`];
  // entidad/proveedor son 11 dígitos (validados por zod) → se inyectan como LITERAL, no como $param: con un parámetro,
  // Hyperdrive prepara la sentencia y el planner, sin conocer el valor, elige un plan genérico que ignora el índice de
  // entidad y recorre el de fecha (timeout). Con el literal usa el bitmap index por entidad (rápido). Solo dígitos: seguro.
  // Lo mismo los valores de los filtros de abajo: salen de listas cerradas (zod), nunca del texto de la URL.
  if (q.entidad) base.push(`o.entidad_ruc = '${q.entidad}'`);
  if (q.proveedor) base.push(`o.ruc_contratista = '${q.proveedor}'`);
  if (q.anio) base.push(`o.fecha_emision >= make_date(${p(q.anio)}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`);
  if (q.dudosa) base.push(`o.monto_dudoso IS NOT NULL`);
  const columnas: string[] = [];
  if (q.tipo) columnas.push(q.tipo === "compra" ? `o.tipo_orden ILIKE '%compra%'` : `o.tipo_orden NOT ILIKE '%compra%'`);
  if (q.estado) columnas.push(`o.estado = '${ESTADOS_ORDEN[q.estado]}'`);
  if (q.persona) columnas.push(`o.ruc_contratista LIKE '${q.persona === "natural" ? "10" : "20"}%'`);
  if (q.como) columnas.push(`o.tipo_contratacion ~* '${COMO_ORDEN[q.como]}'`);
  if (q.monto) columnas.push(MONTO_ORDEN[q.monto]);
  // Región (departamento): no hay índice por departamento; normaliza tildes, mayúsculas y el Callao de CONOSCE.
  if (q.region) columnas.push(`${DEPARTAMENTO} = mef_norm(${p(q.region)})`);
  // Subconsulta con LIMIT (no un EXISTS): así se evalúa fila por fila mientras recorre el índice por fecha (1 de cada
  // 130 órdenes recientes, ~50 ms la primera página). Con un EXISTS el planificador la volvía un semi-join que leía las
  // 128 mil filas de ordenes_fraccionadas y las ordenaba en disco (1,2 s).
  if (q.antecedente === "fraccionamiento") columnas.push(`(SELECT true ${FRACCIONADA} LIMIT 1) IS NOT NULL`);
  const texto = palabrasBusqueda(q.q).map((w) =>
    `mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.contratista, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
  const acotada = texto.length > 0 || (forzarAcotada && columnas.length > 0);
  const enVentana = acotada ? base : [...base, ...columnas];
  const despuesDe = acotada ? [...columnas, ...texto] : [];
  // El parentesco parte de persona_senal: ~400 parejas entidad × persona y ~2 mil órdenes en total (50 ms con la caché
  // caliente). Recorrer el índice por fecha buscando esas parejas leía cientos de miles de órdenes recientes.
  const desde = q.antecedente === "nepotismo"
    ? `persona_senal ps JOIN conosce_ordenes o ON o.entidad_ruc = ps.entidad_ruc AND o.ruc_contratista = ps.ruc`
    : `conosce_ordenes o`;
  if (q.antecedente === "nepotismo") enVentana.unshift(`ps.tipo = 'nepotismo'`);
  const dir = q.orden === "antiguo" ? "ASC" : "DESC";
  const offset = (q.page - 1) * q.size;
  const lim = q.size + 1; // una de más para saber si hay página siguiente
  // Candidatas que trae el índice antes del dedup. Sin filtros después de la ventana: la página y un margen. Con texto,
  // la ventana de siempre: cubre la página pedida con margen para el filtro (el múltiplo crece en páginas hondas) y,
  // con región (un departamento es ~1/25 del universo), más. Cada fila completa es ~0,5 KB: no inflarla de más.
  const ventana = !despuesDe.length
    ? Math.ceil((offset + lim) * 1.02) + 20
    : q.region && !anclado ? Math.max(12000, (offset + lim) * 24) : Math.max(1500, (offset + lim) * 6);
  const despues = despuesDe.length ? `WHERE ${despuesDe.join(" AND ")}` : "";
  const dedupOrden = `o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC`;
  // UNA sola consulta con VENTANA para todos los casos. El WHERE lleva el filtro de entidad/proveedor (o ninguno) y el
  // ORDER BY o.fecha_emision + LIMIT deja que el planner elija el índice que da ese orden YA filtrado, sin traer toda la
  // historia de la entidad/proveedor (una entidad grande tiene ~44 k filas; ordenarlas enteras en disco tardaba ~39 s):
  //   · entidad   → conosce_ordenes_entidad_fecha      (entidad_ruc, fecha_emision DESC)   [migración 128]
  //   · proveedor → conosce_ordenes_contratista_fecha  (ruc_contratista, fecha_emision DESC) [migración 111]
  //   · ninguno   → idx_conosce_ordenes_fecha_emision  (fecha_emision)                     [migración 127]
  //   · posible error → conosce_ordenes_dudoso (parcial, ~1 300 órdenes)                  [migración 98]
  //   · monto de más de S/ 50 mil → conosce_ordenes_grandes_fecha (parcial), si existe     [migración 143]
  const sql = `WITH c AS (
       SELECT o.* FROM ${desde} WHERE ${enVentana.join(" AND ")} ORDER BY o.fecha_emision ${dir} LIMIT ${ventana}
     ), d AS (
       SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.* FROM c o ORDER BY ${dedupOrden})
     SELECT ${COLS} FROM d o ${despues} ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${lim} OFFSET ${offset}`;
  return { sql, vals, acotada, acotable: !acotada && columnas.length > 0, ventana: acotada ? ventana : null };
}

/**
 * Cuánto se le da a la consulta completa (los filtros dentro del índice) antes de pasar a la acotada: casi todas tardan
 * menos de 300 ms; las que no, recorren cientos de miles de órdenes de una entidad grande buscando un valor raro.
 */
const PLAZO_COMPLETA_MS = 2_500;

ordenesRouter.get("/", async (c) => {
  const parsed = ListaOrdenesQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    let consulta = sqlListaOrdenes(q);
    let r: Awaited<ReturnType<typeof consultaConPlazo>>;
    try {
      r = await consultaConPlazo(consulta.sql, consulta.vals, consulta.acotable ? PLAZO_COMPLETA_MS : undefined);
    } catch (e) {
      // Se pasó del plazo (57014): la misma página con los filtros sobre las órdenes más recientes, y la web lo dice.
      if (!consulta.acotable || !esErrorPg(e, "57014")) throw e;
      consulta = sqlListaOrdenes(q, true);
      r = await consultaConPlazo(consulta.sql, consulta.vals);
    }
    const hayMas = r.rows.length > q.size;
    // `revisadas`: con la lista acotada, cuántas órdenes recientes se revisaron (puede haber más antes de esas).
    return publicar({ page: q.page, size: q.size, hayMas, anclado: !!(q.entidad || q.proveedor), anio: q.anio ?? null, anios: listaAnios(),
                      revisadas: consulta.ventana, data: r.rows.slice(0, q.size) });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
