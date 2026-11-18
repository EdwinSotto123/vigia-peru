import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, esErrorPg } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";
import { ambitoPedido } from "../lib/plataforma.js";

/**
 * Órdenes de compra y de servicio de TODO el Estado (CONOSCE), como subsección de Contratos. A diferencia de
 * /empresas/:ruc/ordenes y /personas/:codigo/ordenes, no está atada a un RUC: es la lista general.
 *
 * Rendimiento: se apoya en el índice btree conosce_ordenes(fecha_emision) (migración 127). La consulta toma una VENTANA
 * de candidatas por ese índice —las más recientes, o las del año/entidad/proveedor elegidos— con `ORDER BY fecha_emision
 * DESC LIMIT`, las deduplica (un archivo mensual puede repetir una orden) y pagina. Así nunca ordena ni dedup-ea las
 * ~28 M filas enteras. Cada orden se muestra en un panel; no tiene página propia. Cada fila trae la evidencia de sus
 * banderas (COLS) y, si es pago de un proceso, los procesos que puede estar pagando (`procesosPago`, 2026-11-05).
 *   GET /ordenes
 *   GET /ordenes/resumen   las cifras de la cabecera de la vista (tablas precalculadas), de todo o de un año o una entidad
 *
 * Moneda: se listan en cualquier moneda (las ~13 mil en dólares, euros… no salían en ninguna lista, pedido del usuario
 * del 2026-11-05), cada una con la suya (`montoOtraMoneda` y `otraMoneda`; `monto` es sólo en soles). Nada en otra moneda
 * se suma ni entra en un tramo de soles: los resúmenes y las tablas precalculadas cuentan sólo las órdenes en soles.
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

/**
 * Antecedentes de la orden que se pueden filtrar. Los de la persona (RUC 10) con la entidad que le dio la orden, de
 * persona_senal (migraciones 91, 137, 177 y 179): el parentesco con un funcionario, haber financiado la campaña o
 * postulado con el partido que gobierna, ser autoridad electa y cobrar casi siempre al borde del tope (de éste, sólo las
 * órdenes de la franja). Los de la orden misma: partida con otras del mismo día y emitida a un proveedor inhabilitado.
 */
export const ANTECEDENTES_ORDEN = ["nepotismo", "financio_campana", "candidato_gobierna", "autoridad_contratada", "al_borde_del_tope",
                                   "fraccionamiento", "inhabilitado", "repetida", "pariente_socio"] as const;
const DE_PERSONA = new Set<string>(["nepotismo", "financio_campana", "candidato_gobierna", "autoridad_contratada", "al_borde_del_tope"]);
/** Las señales de la persona con la entidad que la fila muestra como bandera (el nepotismo va aparte, en `conNepotismo`). */
const SENALES_FILA = ["financio_campana", "candidato_gobierna", "autoridad_contratada", "aporte_gobierna", "nepotismo_gobierno"];

const enumDe = <T extends Record<string, unknown>>(o: T) => z.enum(Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]]);

export const ListaOrdenesQuery = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^(?!10)\d{11}$/).optional(), // nunca un RUC 10 (sale de un DNI)
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

/**
 * La orden es en soles: la única moneda que se suma o se compara con un monto en soles (un tramo, un tope). CONOSCE
 * publica unas pocas en otra (unas 13 mil desde 2018, 1 de cada 2 mil: casi todas en dólares estadounidenses o
 * canadienses, algún euro, libra o franco suizo; muestra del 2026-11-05): se listan con la suya y nunca se convierten.
 */
const EN_SOLES = `o.moneda = 'Nuevos Soles'`;

/** El monto en soles (NULL en otra moneda) y, aparte, el de otra moneda con su nombre en CONOSCE («Dólar Canadiense»). */
const MONTOS = `CASE WHEN ${EN_SOLES} THEN COALESCE(o.monto, o.monto_dudoso)::float END AS monto,
              CASE WHEN NOT ${EN_SOLES} THEN COALESCE(o.monto, o.monto_dudoso)::float END AS "montoOtraMoneda",
              CASE WHEN NOT ${EN_SOLES} THEN o.moneda END AS "otraMoneda"`;

/** La orden es parte de un grupo de órdenes del mismo día que juntas pasan 8 UIT (ordenes_fraccionadas, migración 51). */
const FRACCIONADA = `FROM ordenes_fraccionadas f WHERE f.entidad_ruc = o.entidad_ruc AND f.fecha = o.fecha_emision
                      AND f.ruc_contratista = o.ruc_contratista AND f.detalle @> jsonb_build_array(jsonb_build_object('orden', o.orden))`;

/**
 * La misma compra repetida en semanas (migraciones 348 y 349): la orden es una de varias al mismo proveedor, por el mismo
 * monto y con la misma descripción, de 7 a 90 días entre la primera y la última. Sólo las de severidad alta o media (juntas
 * pasan el tope de 8 UIT, o todas se devengaron); las demás se ven en Patrones. Se ata por la fecha que guarda `detalle`,
 * el proveedor y el monto, no por el texto de la orden: la misma orden puede venir con otra oficina en el nombre.
 */
const REPETIDA = `FROM ordenes_repetidas r WHERE r.ruc_contratista = o.ruc_contratista AND r.entidad_ruc = o.entidad_ruc
                    AND r.monto = o.monto AND o.moneda = 'Nuevos Soles' AND o.fecha_emision BETWEEN r.desde AND r.hasta
                    AND r.severidad IN ('alta', 'media') AND r.detalle @> jsonb_build_array(jsonb_build_object('fecha', o.fecha_emision))`;

/**
 * La empresa de un pariente (migración 350): un socio, representante o directivo de la empresa es pariente que un
 * funcionario de esta misma entidad declaró en su DJI. Sólo órdenes de 2023 en adelante (las DJI son de quienes están hoy
 * en el cargo) y con el pariente ya en la empresa (RNP) ese día.
 */
const PARIENTE_SOCIO = `FROM empresa_pariente_funcionario x WHERE x.entidad_ruc = o.entidad_ruc AND x.ruc_empresa = o.ruc_contratista
                          AND o.fecha_emision >= DATE '2023-01-01' AND o.fecha_emision >= COALESCE(x.en_empresa_desde, DATE '1900-01-01')`;
/** Una autoridad electa tiene nombre público: su cargo con un parentesco de sangre destaparía un apellido tapado. */
const CARGO_ELECTO = `x.cargo ~* '(ALCALDE|REGIDOR|GOBERNADOR|CONSEJER|CONGRESISTA|PRESIDENTE REGIONAL)'`;

/**
 * El proveedor estaba inhabilitado por el Tribunal de Contrataciones el día en que se emitió la orden: la misma regla que
 * la señal «inhabilitado» de las personas (migración 91), para personas y empresas.
 */
const INHABILITADO = `FROM osce_sancionados s WHERE s.ruc = o.ruc_contratista AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
                       AND o.fecha_emision BETWEEN s.fecha_desde AND COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END)`;

/**
 * Los periodos de inhabilitación de cada RUC (la misma regla), con los que se superponen fundidos en uno: unidos a las
 * órdenes sin fundir, una orden dentro de dos sanciones salía dos veces y la página quedaba corta (61 → 20 tras el dedup).
 * Son ~13 mil sanciones: la ventana se calcula en cada consulta (unos ms). Con un proveedor elegido, sólo los suyos (su
 * RUC son 11 dígitos validados: va como literal).
 */
const periodosInhabilitado = (ruc?: string) => `
  SELECT ruc, min(desde) AS desde, max(hasta) AS hasta FROM (
    SELECT ruc, desde, hasta, sum(nuevo) OVER (PARTITION BY ruc ORDER BY desde, hasta) AS isla FROM (
      SELECT ruc, desde, hasta,
             CASE WHEN desde <= max(hasta) OVER (PARTITION BY ruc ORDER BY desde, hasta ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
                  THEN 0 ELSE 1 END AS nuevo
        FROM (SELECT s.ruc, s.fecha_desde AS desde, COALESCE(s.fecha_hasta, DATE '9999-12-31') AS hasta FROM osce_sancionados s
               WHERE s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
                 AND (s.fecha_hasta IS NOT NULL OR s.tipo = 'definitivo')${ruc ? ` AND s.ruc = '${ruc}'` : ""}) s0) s1) s2
   GROUP BY ruc, isla`;

/**
 * El tope de la orden: el que dice su texto («hasta 8 UIT»; «hasta 9 UIT» con el D.U. 016-2022); sin el dato, 8 UIT,
 * salvo en 2022, cuando pudo ser cualquiera de los dos (NULL). La misma regla que la señal «al borde del tope» (179).
 */
const TOPE_ORDEN = `(CASE WHEN o.tipo_contratacion ~ 'hasta [0-9]+ UIT'
                            THEN substring(o.tipo_contratacion FROM 'hasta ([0-9]+) UIT')::int * uit_soles(extract(year FROM o.fecha_emision)::int)
                          WHEN extract(year FROM o.fecha_emision) <> 2022 THEN 8 * uit_soles(extract(year FROM o.fecha_emision)::int) END)`;
/**
 * La orden quedó entre el 95 % y el 100 % de su tope: una de las que sostienen «al borde del tope». De una persona, sus
 * órdenes de servicio (179); de una empresa, de compra o de servicio (migración 207). Sólo en soles: el tope es en soles
 * y una orden de 42 mil dólares no está «al borde» de 44 mil soles.
 */
const EN_EL_BORDE = `${EN_SOLES} AND (o.ruc_contratista LIKE '20%' OR o.tipo_orden = 'Orden de Servicio') AND o.monto >= 0.95 * ${TOPE_ORDEN} AND o.monto < ${TOPE_ORDEN}`;
/** Los pares entidad-proveedor al borde del tope: las personas (persona_senal, 179) y las empresas (empresa_borde_tope, 207). */
const PARES_BORDE = `(SELECT entidad_ruc, ruc, tipo FROM persona_senal WHERE tipo = 'al_borde_del_tope'
                       UNION ALL SELECT entidad_ruc, ruc, 'al_borde_del_tope' FROM empresa_borde_tope)`;

/** Lo adjudicado en soles de un grupo de ítems de conosce_adjudicaciones (CONOSCE escribe «Soles» o «Nuevos Soles»). */
const ADJUDICADO_SOLES = `sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))`;

/**
 * Qué proceso paga una orden «Deviene de procesos de selección / exoneraciones…» (pedido del usuario del 2026-11-05: el
 * panel decía «paga uno de los 5 procesos que esta empresa ganó en la entidad: el SEACE no dice cuál» y no nombraba
 * ninguno). Son los procesos que su proveedor ganó en la entidad en los 3 años anteriores a la orden, con la misma regla
 * que compra_vinculo (migración 240: la primera buena pro de cada proceso, contada desde el 1 de enero del año de la orden
 * menos 1 095 días, entre la orden y 1 095 días antes), así que `total` es su `candidatos`. Del más cercano al más lejano:
 * el de lo adjudicado igual al monto de la orden (±S/ 1), los que alcanzan para pagarla y, dentro de cada grupo, la buena
 * pro más reciente. Los 8 primeros, con su OCID para la ficha. Una orden que se juntó con un catálogo o un contrato menor
 * (compra_vinculo) no es pago de un proceso: null. Va por el índice (ruc_proveedor, entidad_ruc) de las adjudicaciones y
 * sólo en las órdenes de pago (~6 %): una página de 20 órdenes de pago de EsSalud, 64 ms en caliente (medido 2026-11-05).
 */
const PROCESOS_PAGO = `CASE WHEN o.tipo_contratacion ~* '^deviene de'
           AND NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden
                             AND v.fecha_emision = o.fecha_emision AND v.clase <> 'proceso')
          THEN (SELECT jsonb_build_object('total', COALESCE(max(t.total), 0), 'lista', COALESCE(jsonb_agg(jsonb_build_object(
                         'codigo', t.codigo, 'nomenclatura', t.nomenclatura, 'descripcion', t.descripcion,
                         'buenaPro', to_char(t.f, 'YYYY-MM-DD'), 'adjudicado', t.adjudicado::float, 'mismoMonto', t.mismo,
                         'ocid', (SELECT c.ocid FROM convocatorias c WHERE c.codigo = t.codigo ORDER BY c.ocid LIMIT 1)) ORDER BY t.rn), '[]'::jsonb))
                  FROM (SELECT p.*, count(*) OVER () AS total,
                               row_number() OVER (ORDER BY p.mismo DESC, p.alcanza DESC, p.f DESC, p.codigo) AS rn
                          FROM (SELECT a.codigo_convocatoria AS codigo, max(a.nomenclatura) AS nomenclatura,
                                       max(a.descripcion_proceso) AS descripcion, min(a.fecha_buenapro) AS f,
                                       ${ADJUDICADO_SOLES} AS adjudicado,
                                       COALESCE(${EN_SOLES} AND abs(${ADJUDICADO_SOLES} - o.monto) <= 1, false) AS mismo,
                                       COALESCE(${EN_SOLES} AND ${ADJUDICADO_SOLES} >= o.monto, false) AS alcanza
                                  FROM (SELECT DISTINCT ON (a.codigo_convocatoria, a.n_item) a.codigo_convocatoria, a.nomenclatura,
                                               a.descripcion_proceso, a.fecha_buenapro, a.monto_adjudicado, a.moneda
                                          FROM conosce_adjudicaciones a
                                         WHERE a.ruc_proveedor = o.ruc_contratista AND a.entidad_ruc = o.entidad_ruc
                                           AND a.codigo_convocatoria IS NOT NULL
                                           AND a.fecha_buenapro >= make_date(extract(year FROM o.fecha_emision)::int, 1, 1) - 1095
                                           AND a.fecha_buenapro <= o.fecha_emision
                                         ORDER BY a.codigo_convocatoria, a.n_item, a.anio DESC) a
                                 GROUP BY a.codigo_convocatoria
                                HAVING min(a.fecha_buenapro) >= o.fecha_emision - 1095) p
                         ORDER BY rn LIMIT 8) t) END`;

const COLS = `to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.departamento,
              o.nro_orden AS numero, o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, o.contratista,
              o.ruc_contratista AS "rucContratista", ${MONTOS},
              o.monto_dudoso::float AS "montoDudoso", o.dudoso_motivo AS "dudosoMotivo",
              o.tipo_contratacion AS "tipoContratacion", o.estado,
              o.objeto, to_char(o.fecha_notificacion, 'YYYY-MM-DD') AS "fechaNotificacion",
              to_char(o.fecha_compromiso, 'YYYY-MM-DD') AS "fechaCompromiso",
              EXISTS (SELECT 1 FROM persona_senal ps WHERE ps.tipo = 'nepotismo'
                        AND ps.entidad_ruc = o.entidad_ruc AND ps.ruc = o.ruc_contratista) AS "conNepotismo",
              -- Las demás señales de la persona con esta entidad (sólo el tipo y la severidad: la evidencia está en su ficha).
              (SELECT jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad) ORDER BY ps.tipo)
                 FROM persona_senal ps WHERE ps.entidad_ruc = o.entidad_ruc AND ps.ruc = o.ruc_contratista
                  AND ps.tipo IN (${SENALES_FILA.map((t) => `'${t}'`).join(", ")})) AS "senalesPersona",
              -- Esta orden es una de las que sostienen «al borde del tope»: su tope, para decir a qué porcentaje quedó.
              CASE WHEN ${EN_EL_BORDE}
                        AND ((o.ruc_contratista LIKE '10%' AND EXISTS (SELECT 1 FROM persona_senal ps WHERE ps.tipo = 'al_borde_del_tope'
                                                                         AND ps.entidad_ruc = o.entidad_ruc AND ps.ruc = o.ruc_contratista))
                          OR (o.ruc_contratista LIKE '20%' AND EXISTS (SELECT 1 FROM empresa_borde_tope eb
                                                                         WHERE eb.entidad_ruc = o.entidad_ruc AND eb.ruc = o.ruc_contratista)))
                   THEN jsonb_build_object('tope', ${TOPE_ORDEN}::float) END AS "alBorde",
              -- La ficha de la persona (un código al azar, no su RUC), donde está la evidencia de sus señales.
              CASE WHEN o.ruc_contratista LIKE '10%'
                   THEN (SELECT pc.codigo FROM persona_codigo pc WHERE pc.ruc = o.ruc_contratista) END AS "personaCodigo",
              -- La evidencia de cada antecedente de la fila, para su bandera y su panel (subconsultas por fila de la página).
              (SELECT jsonb_build_object('ordenes', f.ordenes, 'total', f.total::float, 'tope', f.tope::float,
                                         'mismaDescripcion', f.misma_descripcion, 'severidad', f.severidad, 'detalle', f.detalle)
                 ${FRACCIONADA} LIMIT 1) AS fraccionamiento,
              (SELECT jsonb_build_object('ordenes', r.ordenes, 'total', r.total::float, 'tope', r.tope::float, 'dias', r.dias,
                                         'devengadas', r.devengadas, 'severidad', r.severidad, 'detalle', r.detalle)
                 ${REPETIDA} ORDER BY r.total DESC LIMIT 1) AS repetida,
              (SELECT jsonb_build_object('parentesco', CASE WHEN ${CARGO_ELECTO} THEN 'pariente' ELSE x.parentesco END,
                                         'cargo', CASE WHEN ${CARGO_ELECTO} THEN NULL ELSE x.cargo END,
                                         'rol', x.rol, 'desde', to_char(x.en_empresa_desde, 'YYYY-MM-DD'), 'parientes', x.parientes,
                                         'ordenes', x.ordenes, 'monto', x.monto::float, 'severidad', x.severidad)
                 ${PARIENTE_SOCIO} LIMIT 1) AS "parienteSocio",
              -- Con la infracción por la que lo inhabilitó (pedido del usuario del 2026-11-05: el panel no decía por qué).
              (SELECT jsonb_build_object('tipo', s.tipo, 'resolucion', s.resolucion, 'desde', to_char(s.fecha_desde, 'YYYY-MM-DD'),
                                         'hasta', to_char(s.fecha_hasta, 'YYYY-MM-DD'), 'infraccion', left(s.infraccion, 900))
                 ${INHABILITADO} ORDER BY s.fecha_desde DESC LIMIT 1) AS inhabilitacion,
              ${PROCESOS_PAGO} AS "procesosPago"`;

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
  // En cualquier moneda conocida (antes sólo en soles: las órdenes de EsSalud a la OPS en dólares canadienses no salían
  // en ninguna lista; pedido del usuario del 2026-11-05). Ningún índice dependía de la moneda (pg_indexes, 2026-11-05):
  // el plan es el mismo (EsSalud, página 1: 3 ms; página 200: 0,4 s en caliente, antes y después).
  const base = [`o.moneda IS NOT NULL`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`,
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
  // Los tramos son en soles: una orden de 155 dólares canadienses no es de «hasta S/ 1 mil». La condición de soles va
  // aparte del literal del tramo, que sigue igual para el índice parcial de las grandes (migración 143).
  if (q.monto) columnas.push(`${MONTO_ORDEN[q.monto]} AND ${EN_SOLES}`);
  // Región (departamento): no hay índice por departamento; normaliza tildes, mayúsculas y el Callao de CONOSCE.
  if (q.region) columnas.push(`${DEPARTAMENTO} = mef_norm(${p(q.region)})`);
  // Subconsulta con LIMIT (no un EXISTS): así se evalúa fila por fila mientras recorre el índice por fecha (1 de cada
  // 130 órdenes recientes, ~50 ms la primera página). Con un EXISTS el planificador la volvía un semi-join que leía las
  // 128 mil filas de ordenes_fraccionadas y las ordenaba en disco (1,2 s).
  if (q.antecedente === "fraccionamiento") columnas.push(`(SELECT true ${FRACCIONADA} LIMIT 1) IS NOT NULL`);
  // El nombre de una persona natural (RUC 10) no se busca: sale con un apellido tapado, y buscar por el apellido oculto
  // y ver si la fila sigue ahí lo destapaba letra por letra (auditoría del 2026-11-17). Como en entidades, menores y partidos.
  const texto = palabrasBusqueda(q.q).map((w) =>
    `mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || CASE WHEN o.ruc_contratista LIKE '10%' THEN '' ELSE COALESCE(o.contratista, '') END || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
  const acotada = texto.length > 0 || (forzarAcotada && columnas.length > 0);
  const enVentana = acotada ? base : [...base, ...columnas];
  const despuesDe = acotada ? [...columnas, ...texto] : [];
  // Los antecedentes de la persona parten de persona_senal (de 600 a 11 mil parejas entidad × persona según el tipo) y la
  // inhabilitación, de sus periodos: el índice por proveedor trae sólo esas órdenes (de 4 mil a 87 mil). Recorrer el índice
  // por fecha buscando esas parejas leía cientos de miles de órdenes recientes (nepotismo 7 s, candidato del que gobierna
  // 35 s, inhabilitados de EsSalud 39 s en frío).
  const dePersona = !!q.antecedente && DE_PERSONA.has(q.antecedente);
  const desde = dePersona
    ? `${q.antecedente === "al_borde_del_tope" ? `${PARES_BORDE} ps` : "persona_senal ps"} JOIN conosce_ordenes o ON o.entidad_ruc = ps.entidad_ruc AND o.ruc_contratista = ps.ruc`
    : q.antecedente === "inhabilitado"
      // LATERAL con OFFSET 0: siempre desde los periodos y por el índice del proveedor. Con una entidad elegida, un JOIN
      // dejaba al planificador recorrer todas las órdenes de la entidad buscando proveedores sancionados (EsSalud: más
      // de 45 s); así lee sólo las ~64 mil órdenes emitidas a inhabilitados y después filtra la entidad (unos segundos).
      ? `(${periodosInhabilitado(q.proveedor)}) s CROSS JOIN LATERAL (SELECT x.* FROM conosce_ordenes x WHERE x.ruc_contratista = s.ruc
           AND x.fecha_emision BETWEEN s.desde AND s.hasta OFFSET 0) o`
      : q.antecedente === "pariente_socio"
        // Desde los ~700 pares entidad-empresa de la migración 350, por el índice del proveedor.
        // Con una entidad o un proveedor elegidos, sólo sus pares: el LATERAL (con OFFSET 0) no deja pasar ese filtro hacia
        // adentro y recorría las 700 empresas (7 s en frío, medido el 2026-11-17). Son 11 dígitos validados por zod.
        ? `(SELECT * FROM empresa_pariente_funcionario WHERE true${q.entidad ? ` AND entidad_ruc = '${q.entidad}'` : ""}${q.proveedor ? ` AND ruc_empresa = '${q.proveedor}'` : ""}) x
           CROSS JOIN LATERAL (SELECT y.* FROM conosce_ordenes y WHERE y.ruc_contratista = x.ruc_empresa
             AND y.entidad_ruc = x.entidad_ruc AND y.fecha_emision >= GREATEST(DATE '2023-01-01', COALESCE(x.en_empresa_desde, DATE '1900-01-01')) OFFSET 0) o`
      : q.antecedente === "repetida"
        // Desde las ~5 mil órdenes de ordenes_repetidas (proveedor, entidad, fecha y monto), por el índice del proveedor.
        // Recorrer el índice por fecha probando cada orden tardaba 7 s la primera página (medido 2026-11-17).
        ? `(SELECT DISTINCT r.entidad_ruc, r.ruc_contratista, r.monto, (e->>'fecha')::date AS fecha
              FROM ordenes_repetidas r, jsonb_array_elements(r.detalle) e
             WHERE r.severidad IN ('alta', 'media')${q.entidad ? ` AND r.entidad_ruc = '${q.entidad}'` : ""}${q.proveedor ? ` AND r.ruc_contratista = '${q.proveedor}'` : ""}) rr
           CROSS JOIN LATERAL (SELECT x.* FROM conosce_ordenes x WHERE x.ruc_contratista = rr.ruc_contratista
             AND x.fecha_emision = rr.fecha AND x.entidad_ruc = rr.entidad_ruc AND x.monto = rr.monto AND x.moneda = 'Nuevos Soles' OFFSET 0) o`
        : `conosce_ordenes o`;
  if (dePersona) enVentana.unshift(`ps.tipo = '${q.antecedente}'`);
  if (q.antecedente === "al_borde_del_tope") enVentana.push(EN_EL_BORDE);
  // Con esos puntos de partida se ordena por `fecha_emision + 0`: una expresión sin índice, para que el planificador no
  // vuelva a recorrer el de fecha con el LIMIT (un top-N sobre las candidatas: 0,2-0,6 s en caliente, medido 2026-10-27).
  const porFecha = dePersona || q.antecedente === "inhabilitado" || q.antecedente === "repetida" || q.antecedente === "pariente_socio"
    ? "o.fecha_emision + 0" : "o.fecha_emision";
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
       SELECT o.* FROM ${desde} WHERE ${enVentana.join(" AND ")} ORDER BY ${porFecha} ${dir} LIMIT ${ventana}
     ), d AS (
       SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.* FROM c o ORDER BY ${dedupOrden})
     SELECT ${COLS} FROM d o ${despues} ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${lim} OFFSET ${offset}`;
  return { sql, vals, acotada, acotable: !acotada && columnas.length > 0, ventana: acotada ? ventana : null };
}

/** La llave efectiva de una orden de CONOSCE (no tiene id): entidad, texto de la orden y fecha de emisión. */
export interface ClaveOrden { entidad: string; orden: string; fecha: string; proveedor: string | null }

/**
 * Las condiciones de una orden que se lista (las de sqlListaOrdenes), sobre `o`: en cualquier moneda conocida. Lo que se
 * suma, sólo en soles (`o.moneda = 'Nuevos Soles'`, como entidad_orden_anual y _mes, 148 y 187, y compra_resumen, 240).
 */
export const ORDEN_LISTADA = `o.moneda IS NOT NULL AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
  AND o.fecha_emision >= DATE '2018-01-01' AND o.fecha_emision <= current_date + 31 AND o.entidad_ruc ~ '^[0-9]{11}$'`;

/**
 * Las filas de unas órdenes por su llave, con las mismas columnas y antecedentes que la lista (la lista de compras de
 * routes/compras.ts arma su página así: primero las llaves, después sólo esas filas). Cada una en su versión más nueva.
 * Con el proveedor en la llave, por el índice (entidad, proveedor, fecha) de la migración 201: por (entidad, fecha) leía
 * todas las órdenes de ese día de una entidad grande (1,4 s para 20 filas de un proveedor de EsSalud).
 */
export async function filasOrdenes(claves: ClaveOrden[]): Promise<Record<string, unknown>[]> {
  if (!claves.length) return [];
  const r = await consultaConPlazo(
    `WITH k AS (SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::text[]) AS k(e, n, f, p)),
          d AS (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
                  FROM k JOIN conosce_ordenes o ON o.entidad_ruc = k.e AND o.ruc_contratista = k.p AND o.fecha_emision = k.f AND o.orden = k.n
                 ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC)
     SELECT ${COLS} FROM d o`,
    [claves.map((k) => k.entidad), claves.map((k) => k.orden), claves.map((k) => k.fecha), claves.map((k) => k.proveedor)]);
  return r.rows as Record<string, unknown>[];
}

/**
 * Lo justo de unas órdenes para listarlas como pagos de un proceso (sin los antecedentes de cada una). Con el monto en
 * soles y el de otra moneda aparte, como la lista (hoy compra_vinculo sólo junta órdenes en soles).
 */
export async function ordenesLigeras(claves: ClaveOrden[]): Promise<Record<string, unknown>[]> {
  if (!claves.length) return [];
  const r = await consultaConPlazo(
    `WITH k AS (SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::text[]) AS k(e, n, f, p))
     SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision)
            to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad_ruc AS "entidadRuc", o.nro_orden AS numero, o.orden,
            o.tipo_orden AS "tipoOrden", ${MONTOS}, o.estado,
            to_char(o.fecha_compromiso, 'YYYY-MM-DD') AS "fechaCompromiso"
       FROM k JOIN conosce_ordenes o ON o.entidad_ruc = k.e AND o.ruc_contratista = k.p AND o.fecha_emision = k.f AND o.orden = k.n
      ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC`,
    [claves.map((k) => k.entidad), claves.map((k) => k.orden), claves.map((k) => k.fecha), claves.map((k) => k.proveedor)]);
  return r.rows as Record<string, unknown>[];
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
  // Los antecedentes que parten de las parejas o de las sanciones leen órdenes dispersas por la tabla: menos de 1 s en
  // caliente, de 3 a 12 s en frío y más de 20 s con la base ocupada en un refresco (medido 2026-10-27). Son filtros raros
  // y después quedan en la caché: mejor una primera respuesta lenta que un error.
  const plazoAntecedente = q.antecedente && q.antecedente !== "fraccionamiento" ? 45_000 : undefined;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    let consulta = sqlListaOrdenes(q);
    let r: Awaited<ReturnType<typeof consultaConPlazo>>;
    try {
      r = await consultaConPlazo(consulta.sql, consulta.vals, consulta.acotable ? PLAZO_COMPLETA_MS : plazoAntecedente);
    } catch (e) {
      // Se pasó del plazo (57014): la misma página con los filtros sobre las órdenes más recientes, y la web lo dice.
      if (!consulta.acotable || !esErrorPg(e, "57014")) throw e;
      consulta = sqlListaOrdenes(q, true);
      r = await consultaConPlazo(consulta.sql, consulta.vals, plazoAntecedente);
    }
    const hayMas = r.rows.length > q.size;
    // `revisadas`: con la lista acotada, cuántas órdenes recientes se revisaron (puede haber más antes de esas).
    return publicar({ page: q.page, size: q.size, hayMas, anclado: !!(q.entidad || q.proveedor), anio: q.anio ?? null, anios: listaAnios(),
                      revisadas: consulta.ventana, data: r.rows.slice(0, q.size) });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /ordenes/resumen — las cifras de la cabecera de la vista ──────────────────────────────────────────────────────

/**
 * La vista Órdenes era la única lista sin cifras, sin total en el paginador y sin número en su pestaña (pedido del usuario
 * del 2026-11-05). Contarlas en vivo no se puede (~29 M filas; una entidad de 5 mil órdenes tarda 3 s en frío, una de 20
 * mil, 12 s: medido ese día), así que todo sale de tablas precalculadas que se refrescan con cada carga de CONOSCE:
 *   · entidad_orden_mes (187): cuántas y por cuánto, a personas naturales, de cuántas entidades. Las mismas condiciones y
 *     el mismo dedup que la lista, pero sólo en soles: las de otra moneda (~1 de cada 2 mil) se listan y no se cuentan. Es
 *     la tabla al día: entidad_orden_anual (148) se quedó atrás en 2026 (1,98 M contra 2,19 M, medido 2026-11-05).
 *   · ordenes_fraccionadas (51): las compras partidas el mismo día (grupos que juntos pasan 8 UIT), desde 2018.
 *   · persona_senal (179) y empresa_borde_tope (207): los proveedores al borde del tope (de toda su historia, sin año).
 * Con un año o una entidad, las del alcance (la llave de entidad_orden_mes es (entidad_ruc, mes)); los demás filtros de la
 * lista no están en esas tablas. Toda la base: ~0,2 s; una entidad: unos ms. Unas horas en caché: cambian una vez por semana.
 */
const ResumenOrdenesQuery = z.object({
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
});
const memoResumen = new Memo<Record<string, unknown>>({ nombre: "ordenes:resumen", ttlMs: 21_600_000, staleMs: 86_400_000, max: 300 });

async function resumenOrdenes(q: z.infer<typeof ResumenOrdenesQuery>, noGuardar: () => void): Promise<Record<string, unknown>> {
  // El año y la entidad están validados (un entero, 11 dígitos): como literales, para que el planificador use la llave.
  const desde = `DATE '${q.anio ?? 2018}-01-01'`;
  const meses = [`mes >= ${desde}`, q.anio ? `mes < DATE '${q.anio + 1}-01-01'` : `mes <= current_date + 31`];
  const dias = [`f.fecha >= ${desde}`, q.anio ? `f.fecha < DATE '${q.anio + 1}-01-01'` : `f.fecha <= current_date + 31`];
  const deEntidad = (col: string) => (q.entidad ? ` AND ${col} = '${q.entidad}'` : "");
  // Las cifras de apoyo, si fallan, no tumban las principales: la cabecera sale sin esa cifra, y esa respuesta no se
  // guarda (la próxima vuelve a intentarlo). ordenes_fraccionadas pesa 218 MB por su detalle: 70 ms en caliente, hasta 8 s
  // en frío (medido 2026-11-05).
  const apoyo = <T>(nombre: string, p: Promise<{ rows: unknown[] }>) =>
    p.then((r) => (r.rows[0] as T) ?? null).catch((e) => {
      console.warn(`[ordenes] resumen ${nombre}: ${(e as Error).message}`);
      noGuardar();
      return null;
    });
  const [t, partidas, alBorde] = await Promise.all([
    consultaConPlazo(
      `SELECT COALESCE(sum(ordenes), 0)::int AS ordenes, COALESCE(sum(monto), 0)::float AS monto,
              COALESCE(sum(dudosas), 0)::int AS dudosas, COALESCE(sum(a_personas), 0)::int AS "aPersonas",
              COALESCE(sum(monto_personas), 0)::float AS "montoPersonas",
              count(DISTINCT entidad_ruc) FILTER (WHERE ordenes > 0)::int AS entidades,
              to_char(min(mes), 'YYYY-MM') AS desde, to_char(max(mes), 'YYYY-MM') AS hasta
         FROM entidad_orden_mes WHERE ${meses.join(" AND ")}${deEntidad("entidad_ruc")}`, []),
    apoyo<{ grupos: number; ordenes: number; graves: number }>("partidas", consultaConPlazo(
      `SELECT count(*)::int AS grupos, COALESCE(sum(f.ordenes), 0)::int AS ordenes, count(*) FILTER (WHERE f.severidad = 'alta')::int AS graves
         FROM ordenes_fraccionadas f WHERE ${dias.join(" AND ")}${deEntidad("f.entidad_ruc")}`, [], 15_000)),
    apoyo<{ personas: number; empresas: number }>("al borde", consultaConPlazo(
      `SELECT (SELECT count(DISTINCT ruc) FROM persona_senal WHERE tipo = 'al_borde_del_tope'${deEntidad("entidad_ruc")})::int AS personas,
              (SELECT count(DISTINCT ruc) FROM empresa_borde_tope WHERE true${deEntidad("entidad_ruc")})::int AS empresas`, [], 15_000)),
  ]);
  return { anio: q.anio ?? null, entidad: q.entidad ?? null, ...(t.rows[0] as Record<string, unknown>), partidas, alBorde };
}

ordenesRouter.get("/resumen", async (c) => {
  const parsed = ResumenOrdenesQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const cuerpo = await memoResumen.obtener(JSON.stringify(parsed.data), (ctl) => resumenOrdenes(parsed.data, ctl.noGuardar));
  // Sin alguna cifra de apoyo (no respondió a tiempo), un minuto: que la próxima la traiga entera.
  const entera = cuerpo.partidas != null && cuerpo.alBorde != null;
  c.header("Cache-Control", entera ? cachePublico(3600, { maxAge: 600, swr: 86_400 }) : cachePublico(60));
  return c.json(cuerpo);
});

// ─── GET /ordenes/siaf — el expediente SIAF de sus órdenes de un mes, a pedido ─────────────────────────────────────────

/**
 * Las órdenes de compra y de servicio de una entidad en un mes con su N.º de expediente SIAF, que CONOSCE no trae, del
 * reporte «ongei» del SEACE (buscadorPublicoOCOS). Sólo a pedido: lo llama el botón del panel de una orden, no la lista,
 * así que un robot que recorre las fichas no dispara nada. Va por el Worker de Zúrich (backend/seace-zrh-worker, service
 * binding SEACE_ZRH): el SEACE filtra por la IP de salida y por ahí pasa; el mes de una entidad son dos pedidos al SEACE y
 * queda un día en caché. Del proveedor no se devuelve nada: la orden se reconoce por su tipo y su número.
 */
const memoSiaf = new Memo<Record<string, unknown>>({ nombre: "ordenes:siaf", ttlMs: 3_600_000, staleMs: 86_400_000, max: 300 });

/** «S/. 6251.64» → 6251.64. */
const montoSeace = (v: string | undefined) => {
  const t = (v ?? "").replace(/^\s*S\/\.?\s*/i, "").replace(/,/g, "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
};

ordenesRouter.get("/siaf", async (c) => {
  const entidad = c.req.query("entidad") ?? "";
  const anio = Number(c.req.query("anio"));
  const mes = Number(c.req.query("mes"));
  if (!/^\d{11}$/.test(entidad) || !(anio >= 2018 && anio <= 2100) || !(mes >= 1 && mes <= 12)) return c.json({ error: "invalid_query" }, 400);
  const binding = ambitoPedido.getStore()?.servicio?.("seace_zrh");
  const token = process.env.SEACE_ZRH_TOKEN;
  if (!binding || !token) return c.json({ error: "sin_seace" }, 503);
  try {
    const cuerpo = await memoSiaf.obtener(`${entidad}:${anio}:${mes}`, async () => {
      const r = await binding.fetch("https://vigia-seace-zrh/ongei", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reporte: "ocos", ruc: entidad, anio, mes }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; total?: number; columnas?: string[]; filas?: string[][] } | null;
      if (!d?.ok || !d.columnas || !d.filas) throw new Error(`seace: ${d?.error ?? r.status}`);
      const col = (n: string) => d.columnas!.indexOf(n);
      const k = { tipo: col("Tipo de Orden"), numero: col("Número de orden"), siaf: col("Nro. Exp. SIAF"), emision: col("Fecha de Emisión"),
                  compromiso: col("Fecha de Compromiso"), estado: col("Estado"), monto: col("Monto") };
      if (Object.values(k).some((i) => i < 0)) throw new Error(`seace: columnas ${d.columnas.join(", ")}`);
      const ordenes = d.filas.map((f) => ({
        tipo: f[k.tipo] || null, numero: f[k.numero] || null, siaf: f[k.siaf] || null,
        emision: f[k.emision]?.slice(0, 10) || null, compromiso: f[k.compromiso]?.slice(0, 10) || null,
        estado: f[k.estado] || null, monto: montoSeace(f[k.monto]),
      }));
      return { entidad, anio, mes, total: d.total ?? ordenes.length, ordenes, consultado: new Date().toISOString() };
    });
    c.header("Cache-Control", cachePublico(86_400, { maxAge: 3600, swr: 604_800 }));
    return c.json(cuerpo);
  } catch (e) {
    console.warn(`[ordenes] siaf ${entidad} ${anio}-${mes}: ${(e as Error).message}`);
    c.header("Cache-Control", "no-store");
    return c.json({ error: "seace_no_respondio" }, 502);
  }
});
