import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * Órdenes de compra y de servicio de TODO el Estado (CONOSCE), como subsección de Contratos. A diferencia de
 * /empresas/:ruc/ordenes y /personas/:codigo/ordenes, no está atada a un RUC: es la lista general.
 *
 * MVP de rendimiento: los índices rápidos de conosce_ordenes arrancan por ruc_contratista; sin un RUC solo quedan
 * BRIN(fecha_emision) y (anio, mes). Por eso se ACOTA: si no viene año/entidad/proveedor, se usa el último año. Y para
 * no contar millones de filas, se pagina por fecha con ventana (como /empresas/:ruc/ordenes en su camino «porFecha») y
 * se devuelve `hayMas` en vez de un total exacto. Con filtros variables (tipo/estado/texto) cae al dedup completo del
 * recorte, con plazo. Cada orden se deduplica (un archivo mensual puede repetirla).
 *   GET /ordenes
 */
export const ordenesRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "ordenes:lista", ttlMs: 600_000, staleMs: 600_000, max: 400 });
const aniosMemo = new Memo<number[]>({ nombre: "ordenes:anios", ttlMs: 3_600_000, staleMs: 3_600_000, max: 1 });

const Lista = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  anio: z.coerce.number().int().min(2018).max(2100).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  tipo: z.enum(["compra", "servicio"]).optional(),
  estado: z.string().trim().min(3).max(30).optional(),
  dudosa: z.enum(["si"]).optional(),
  orden: z.enum(["reciente", "antiguo"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

const anios = () =>
  aniosMemo.obtener("anios", async () => {
    // Barato: el máximo desde un agregado chico (NO escanear ~28 M de conosce_ordenes), y la lista 2018..max en JS.
    const r = await pool.query<{ m: number }>(`SELECT max(anio)::int AS m FROM empresa_orden_anual`);
    const max = Math.max(r.rows[0]?.m ?? new Date().getFullYear(), 2018);
    const list: number[] = [];
    for (let y = max; y >= 2018; y--) list.push(y);
    return list;
  });

ordenesRouter.get("/", async (c) => {
  const parsed = Lista.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    const aa = await anios();
    const vals: unknown[] = [];
    const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
    const base = [`o.moneda = 'Nuevos Soles'`, `o.estado IS DISTINCT FROM 'Anulada'`, `(o.monto > 0 OR o.monto_dudoso IS NOT NULL)`,
                  `o.fecha_emision >= DATE '2018-01-01'`, `o.fecha_emision <= current_date + 31`, `o.entidad_ruc ~ '^[0-9]{11}$'`];
    const fijos: string[] = [];
    if (q.entidad) fijos.push(`o.entidad_ruc = ${p(q.entidad)}`);
    if (q.proveedor) fijos.push(`o.ruc_contratista = ${p(q.proveedor)}`);
    // Acotación por rendimiento: los índices rápidos de conosce_ordenes empiezan por ruc_contratista/entidad_ruc; NO hay
    // btree global por fecha para ordenar ~28 M filas. Si está ANCLADO a una entidad o proveedor, usamos su índice (y el
    // año opcional); si NO, mostramos sólo las órdenes RECIENTES (ventana de 180 días por el BRIN de fecha_emision).
    const anclado = !!(q.entidad || q.proveedor);
    if (anclado) {
      if (q.anio) fijos.push(`o.fecha_emision >= make_date(${p(q.anio)}, 1, 1) AND o.fecha_emision < make_date($${vals.length} + 1, 1, 1)`);
    } else {
      fijos.push(`o.fecha_emision >= current_date - 180`);
    }
    const anio = anclado ? (q.anio ?? null) : null;
    const variables: string[] = [];
    if (q.tipo) variables.push(q.tipo === "compra" ? `o.tipo_orden ILIKE '%compra%'` : `o.tipo_orden NOT ILIKE '%compra%'`);
    if (q.estado) variables.push(`o.estado = ${p(q.estado)}`);
    if (q.dudosa) variables.push(`o.monto_dudoso IS NOT NULL`);
    for (const w of palabrasBusqueda(q.q)) {
      variables.push(`mef_norm(COALESCE(o.descripcion, '') || ' ' || COALESCE(o.entidad, '') || ' ' || COALESCE(o.contratista, '') || ' ' || COALESCE(o.nro_orden, '')) LIKE ${p(`%${w}%`)}`);
    }
    const donde = fijos.length ? `AND ${fijos.join(" AND ")}` : "";
    const despues = variables.length ? `WHERE ${variables.join(" AND ")}` : "";
    const COLS = `to_char(o.fecha_emision, 'YYYY-MM-DD') AS fecha, o.entidad, o.entidad_ruc AS "entidadRuc", o.departamento, o.nro_orden AS numero,
                  o.orden, o.tipo_orden AS "tipoOrden", o.descripcion, o.contratista, o.ruc_contratista AS "rucContratista",
                  COALESCE(o.monto, o.monto_dudoso)::float AS monto, o.monto_dudoso::float AS "montoDudoso",
                  o.dudoso_motivo AS "dudosoMotivo", o.tipo_contratacion AS "tipoContratacion", o.estado`;
    const DEDUP = `DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision)`;
    const DEDUP_ORDEN = `o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC`;
    const dir = q.orden === "antiguo" ? "ASC" : "DESC";
    const offset = (q.page - 1) * q.size;
    const lim = q.size + 1; // una de más para saber si hay página siguiente
    const porFecha = variables.length === 0;
    const ventana = (offset + lim) * 3 + 200;
    const r = porFecha
      ? await consultaConPlazo(
          `WITH c AS (
             SELECT o.* FROM conosce_ordenes o WHERE ${base.join(" AND ")} ${donde}
              ORDER BY o.fecha_emision ${dir}, ${DEDUP_ORDEN} LIMIT ${ventana}
           ), d AS (SELECT ${DEDUP} o.* FROM c o ORDER BY ${DEDUP_ORDEN})
           SELECT ${COLS} FROM d o ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${lim} OFFSET ${offset}`, vals)
      : await consultaConPlazo(
          `WITH o AS MATERIALIZED (
             SELECT ${DEDUP} o.* FROM conosce_ordenes o WHERE ${base.join(" AND ")} ${donde} ORDER BY ${DEDUP_ORDEN})
           SELECT ${COLS} FROM o ${despues} ORDER BY o.fecha_emision ${dir}, o.orden ${dir} LIMIT ${lim} OFFSET ${offset}`, vals);
    const hayMas = r.rows.length > q.size;
    const data = r.rows.slice(0, q.size);
    return publicar({ page: q.page, size: q.size, hayMas, anio: anio ?? null, anios: aa, data });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
