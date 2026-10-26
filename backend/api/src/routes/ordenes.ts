import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo } from "../lib/db.js";
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
 * DESC LIMIT`, las deduplica (un archivo mensual puede repetir una orden) y recién ahí aplica los filtros de texto/tipo/
 * estado y la paginación. Así nunca ordena ni dedup-ea las ~28 M filas enteras. Cada orden se muestra en un panel; no
 * tiene página propia.
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

const Lista = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  region: z.string().trim().min(2).max(40).optional(), // departamento (nombre); se compara normalizado
  tipo: z.enum(["compra", "servicio"]).optional(),
  estado: z.string().trim().min(3).max(30).optional(),
  dudosa: z.enum(["si"]).optional(),
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

ordenesRouter.get("/", async (c) => {
  const parsed = Lista.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    const anios = listaAnios();
    const anclado = !!(q.entidad || q.proveedor);
    const vals: unknown[] = [];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    // Filtros INDEXABLES (van en la ventana que elige el índice): entidad, proveedor, año.
    const base = [`o.moneda = 'Nuevos Soles'`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`,
                  `o.fecha_emision >= DATE '2018-01-01'`, `o.fecha_emision <= current_date + 31`, `o.entidad_ruc ~ '^[0-9]{11}$'`];
    // entidad/proveedor son 11 dígitos (validados por zod) → se inyectan como LITERAL, no como $param: con un parámetro,
    // Hyperdrive prepara la sentencia y el planner, sin conocer el valor, elige un plan genérico que ignora el índice de
    // entidad y recorre el de fecha (timeout). Con el literal usa el bitmap index por entidad (rápido). Solo dígitos: seguro.
    if (q.entidad) base.push(`o.entidad_ruc = '${q.entidad}'`);
    if (q.proveedor) base.push(`o.ruc_contratista = '${q.proveedor}'`);
    if (q.anio) base.push(`o.fecha_emision >= make_date(${p(q.anio)}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`);
    // Filtros NO indexables (se aplican DESPUÉS de deduplicar la ventana): tipo, estado, posible error, texto.
    const variables: string[] = [];
    if (q.tipo) variables.push(q.tipo === "compra" ? `o.tipo_orden ILIKE '%compra%'` : `o.tipo_orden NOT ILIKE '%compra%'`);
    if (q.estado) variables.push(`o.estado = ${p(q.estado)}`);
    if (q.dudosa) variables.push(`o.monto_dudoso IS NOT NULL`);
    // Región (departamento): no hay índice por departamento, así que es un filtro post-ventana (sobre las filas de la
    // ventana, normalizando tildes/mayúsculas). La ventana se agranda cuando hay región (abajo) para que la página llene.
    if (q.region) variables.push(`mef_norm(COALESCE(o.departamento, '')) = mef_norm(${p(q.region)})`);
    for (const w of palabrasBusqueda(q.q)) {
      variables.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.contratista, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
    }
    const dir = q.orden === "antiguo" ? "ASC" : "DESC";
    const offset = (q.page - 1) * q.size;
    const lim = q.size + 1; // una de más para saber si hay página siguiente
    // Candidatas que trae el índice por fecha antes de dedup/filtro. El dedup quita MUY poco (una orden casi no se repite
    // entre archivos: medido 3990 únicas de 4000), así que la ventana solo cubre la página pedida con margen para los
    // filtros post-ventana (tipo/estado/texto). El piso bajo mantiene rápida la 1ª página; el múltiplo crece en páginas
    // hondas. Cada fila completa es ~0,5 KB, así que la ventana es también el costo: no inflarla de más.
    // Con región (sin ancla de entidad/proveedor) la ventana se agranda: un departamento es ~1/25 del universo, así que
    // hace falta más margen para llenar la página tras el filtro post-ventana. Acotada: es un índice por fecha que para ahí.
    const ventana = q.region && !anclado ? Math.max(12000, (offset + lim) * 24) : Math.max(1500, (offset + lim) * 6);
    const despues = variables.length ? `WHERE ${variables.join(" AND ")}` : "";
    const COLS = `to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.departamento,
                  o.nro_orden AS numero, o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, o.contratista,
                  o.ruc_contratista AS "rucContratista", COALESCE(o.monto, o.monto_dudoso)::float AS monto,
                  o.monto_dudoso::float AS "montoDudoso", o.dudoso_motivo AS "dudosoMotivo",
                  o.tipo_contratacion AS "tipoContratacion", o.estado,
                  o.objeto, to_char(o.fecha_notificacion, 'YYYY-MM-DD') AS "fechaNotificacion",
                  to_char(o.fecha_compromiso, 'YYYY-MM-DD') AS "fechaCompromiso",
                  EXISTS (SELECT 1 FROM persona_senal ps WHERE ps.tipo = 'nepotismo'
                            AND ps.entidad_ruc = o.entidad_ruc AND ps.ruc = o.ruc_contratista) AS "conNepotismo"`;
    const dedupOrden = `o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC`;
    const salida = `SELECT ${COLS} FROM d o ${despues} ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${lim} OFFSET ${offset}`;
    // UNA sola consulta con VENTANA para los tres casos. El WHERE lleva el filtro de entidad/proveedor (o ninguno) y el
    // ORDER BY o.fecha_emision + LIMIT deja que el planner elija el índice que da ese orden YA filtrado, sin traer toda la
    // historia de la entidad/proveedor (una entidad grande tiene ~44 k filas; ordenarlas enteras en disco tardaba ~39 s):
    //   · entidad   → conosce_ordenes_entidad_fecha      (entidad_ruc, fecha_emision DESC)   [migración 128]
    //   · proveedor → conosce_ordenes_contratista_fecha  (ruc_contratista, fecha_emision DESC) [migración 111]
    //   · ninguno   → idx_conosce_ordenes_fecha_emision  (fecha_emision)                     [migración 127]
    // Se toma la ventana de candidatas más recientes (o las del año elegido), se dedup-ea (un archivo mensual repite una
    // orden) y recién ahí se filtra por tipo/estado/texto y se pagina.
    const sql = `WITH c AS (
         SELECT o.* FROM conosce_ordenes o WHERE ${base.join(" AND ")} ORDER BY o.fecha_emision ${dir} LIMIT ${ventana}
       ), d AS (
         SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.* FROM c o ORDER BY ${dedupOrden})
       ${salida}`;
    const r = await consultaConPlazo(sql, vals);
    const hayMas = r.rows.length > q.size;
    return publicar({ page: q.page, size: q.size, hayMas, anclado, anio: q.anio ?? null, anios, data: r.rows.slice(0, q.size) });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
