import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * Las compras por los Catálogos Electrónicos de Perú Compras (migraciones 236-237): qué compró cada orden, producto por
 * producto, a cuánto la unidad y cómo se compara con lo que pagaron las demás entidades por la misma ficha-producto ese
 * año. CONOSCE y el SEACE registran cada orden sólo por su total; ésta es la única fuente con el detalle.
 *   GET /catalogo?entidad=<RUC>       → la vista «Catálogo» en la pestaña Contratos de una entidad
 *   GET /catalogo?proveedor=<RUC>     → la misma vista en las ventas de una empresa
 *   GET /catalogo/ficha/:ficha        → quién más compró ese producto y a cuánto
 * Un proveedor persona natural (RUC 10, ~1 de cada 5 líneas) sale tapado por publicar(), como en las demás listas.
 * Lo que no se guarda (el DNI e IP de quien creó la orden, las direcciones) no está en la base: ver la migración 236.
 */
export const catalogoRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "catalogo:lista", ttlMs: 600_000, staleMs: 3_600_000, max: 300 });
const memoFicha = new Memo<Record<string, unknown> | null>({ nombre: "catalogo:ficha", ttlMs: 600_000, staleMs: 3_600_000, max: 300 });

/** El producto de una línea: el archivo de su ficha sin «.pdf» ni la marca de cuándo se actualizó (migración 237). */
const FICHA = (col: string) => `regexp_replace(${col}, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', '')`;

/** Los PDF de la orden (la orden física y el «Informe Sustento» con las proformas) en el almacén público de Perú Compras. */
const BLOB = "https://saeusceprod01.blob.core.windows.net/contentidad/uploads/";

/**
 * El estado de la orden, en cinco grupos. El portal tiene 30 estados («ENTREGADA C/CONFORMIDAD RETRASADA», «PENALIZADA
 * C/PAGO RETRASADO»…): el retraso puede ser del proveedor (entrega, penalidad) o de la entidad (conformidad, pago).
 */
export const ESTADO_CATALOGO = {
  pagada: `x.estado LIKE 'PAGADA%'`,
  retraso: `(x.estado LIKE '%RETRASAD%' OR x.estado LIKE '%PENALIZADA%')`,
  resuelta: `(x.estado LIKE 'RESUELTA%' OR x.estado LIKE 'EN SOLUCI%')`,
  anulada: `x.estado IN ('ORDEN DE COMPRA NULA', 'RECHAZADA')`,
  en_curso: `(x.estado NOT LIKE 'PAGADA%' AND x.estado NOT LIKE '%RETRASAD%' AND x.estado NOT LIKE '%PENALIZADA%'
              AND x.estado NOT LIKE 'RESUELTA%' AND x.estado NOT LIKE 'EN SOLUCI%' AND x.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA'))`,
} as const;
const GRUPO_ESTADO = `CASE ${Object.entries(ESTADO_CATALOGO).map(([k, sql]) => `WHEN ${sql} THEN '${k}'`).join(" ")} END`;

export const ListaCatalogoQuery = z.object({
  q: z.string().trim().min(3).max(80).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  proveedor: z.string().regex(/^\d{11}$/).optional(),
  anio: z.coerce.number().int().min(2015).max(2100).optional(),
  estado: z.enum(Object.keys(ESTADO_CATALOGO) as [keyof typeof ESTADO_CATALOGO, ...(keyof typeof ESTADO_CATALOGO)[]]).optional(),
  sobreprecio: z.enum(["si"]).optional(),
  orden: z.enum(["reciente", "monto", "sobreprecio"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
export type FiltrosCatalogo = z.infer<typeof ListaCatalogoQuery>;

type Faceta = "anio" | "estado" | "sobreprecio";

/** ¿Ya están las tablas de las migraciones 236 y 237? Presentes, no se vuelve a preguntar; ausentes, cada minuto. */
let tablas: { ok: boolean; at: number } | null = null;
export async function hayCatalogo(): Promise<boolean> {
  if (tablas && (tablas.ok || Date.now() - tablas.at < 60_000)) return tablas.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT to_regclass('public.perucompras_orden') IS NOT NULL AND to_regclass('public.perucompras_sobreprecio') IS NOT NULL AS ok`);
    tablas = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch {
    return false;
  }
  return tablas.ok;
}

/**
 * Las órdenes de la lista, con lo que filtra ya calculado: su año y si alguna de sus líneas pagó el doble de la mediana
 * o más (un IN sin correlación: Postgres arma su tabla hash una vez). La entidad y el proveedor (11 dígitos validados)
 * van como literales, para que el planificador use su índice (entidad o proveedor, fecha).
 */
function condiciones(q: FiltrosCatalogo, vals: unknown[]) {
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const ancla: string[] = [];
  const anclaS: string[] = [];
  if (q.entidad) { ancla.push(`o.entidad_ruc = '${q.entidad}'`); anclaS.push(`s.entidad_ruc = '${q.entidad}'`); }
  if (q.proveedor) { ancla.push(`o.proveedor_ruc = '${q.proveedor}'`); anclaS.push(`s.proveedor_ruc = '${q.proveedor}'`); }
  const filas = `SELECT o.*, extract(year FROM o.fecha_publicacion)::int AS anio,
                        (o.orden IN (SELECT s.orden FROM perucompras_sobreprecio s${anclaS.length ? ` WHERE ${anclaS.join(" AND ")}` : ""})) AS sobre
                   FROM perucompras_orden o${ancla.length ? ` WHERE ${ancla.join(" AND ")}` : ""}`;
  const filtros: { faceta: Faceta | null; sql: string }[] = [];
  if (q.anio) filtros.push({ faceta: "anio", sql: `x.fecha_publicacion >= DATE '${q.anio}-01-01' AND x.fecha_publicacion < DATE '${q.anio + 1}-01-01'` });
  if (q.estado) filtros.push({ faceta: "estado", sql: ESTADO_CATALOGO[q.estado] });
  if (q.sobreprecio) filtros.push({ faceta: "sobreprecio", sql: `x.sobre` });
  // La búsqueda, sólo en una ficha (una entidad o un proveedor): en todo el país recorrería 3,8 millones de líneas.
  if (ancla.length) {
    for (const w of palabrasBusqueda(q.q)) {
      const v = p(`%${w}%`);
      filtros.push({
        faceta: null,
        sql: `(upper(immutable_unaccent(x.orden || ' ' || COALESCE(x.proveedor, '') || ' ' || COALESCE(x.nro_orden_fisica, ''))) LIKE ${v}
               OR EXISTS (SELECT 1 FROM perucompras_item i WHERE i.orden = x.orden AND i.version = 0
                           AND upper(immutable_unaccent(COALESCE(i.descripcion, '') || ' ' || COALESCE(i.marca, '') || ' ' || COALESCE(i.nro_parte, ''))) LIKE ${v}))`,
      });
    }
  }
  return { filas, filtros };
}

const sinVacios = (c: Parameters<typeof parametros>[0]) =>
  Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));

/** Las líneas de lo pedido que van en la fila (las demás, en el PDF de la orden). */
const LINEAS_FILA = 15;

catalogoRouter.get("/", async (c) => {
  const parsed = ListaCatalogoQuery.safeParse(sinVacios(c));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  if (!(await hayCatalogo())) {
    c.header("Cache-Control", cachePublico(60));
    return c.json({ page: q.page, size: q.size, hayMas: false, disponible: false, facetas: null, data: [] });
  }
  const cuerpo = await memo.obtener(JSON.stringify(q), async () => {
    const vals: unknown[] = [];
    const { filas, filtros } = condiciones(q, vals);
    const where = filtros.length ? `WHERE ${filtros.map((f) => f.sql).join(" AND ")}` : "";
    const orden = q.orden === "monto"
      ? `x.total DESC NULLS LAST, x.orden DESC`
      : q.orden === "sobreprecio"
        ? `(SELECT sum(s.exceso) FROM perucompras_sobreprecio s WHERE s.orden = x.orden) DESC NULLS LAST, x.fecha_publicacion DESC, x.orden DESC`
        : `x.fecha_publicacion DESC NULLS LAST, x.orden DESC`;
    const ordenY = orden.replace(/\bx\./g, "y.");
    const sql = `WITH x AS (${filas}),
                      y AS (SELECT x.* FROM x ${where} ORDER BY ${orden} LIMIT ${q.size + 1} OFFSET ${(q.page - 1) * q.size})
      SELECT y.orden, y.acuerdo_codigo AS "acuerdoCodigo", y.acuerdo, y.tipo, y.entidad_ruc AS "entidadRuc", y.entidad,
             y.proveedor_ruc AS "proveedorRuc", y.proveedor, y.procedimiento, y.tipo_compra AS "tipoCompra", y.estado,
             ${GRUPO_ESTADO.replace(/\bx\./g, "y.")} AS "estadoGrupo",
             y.nro_orden_fisica AS "ordenFisica", to_char(y.fecha_publicacion, 'YYYY-MM-DD') AS fecha,
             to_char(y.fecha_aceptacion, 'YYYY-MM-DD') AS aceptada, y.subtotal::float AS subtotal, y.igv::float AS igv,
             y.total::float AS total, y.versiones,
             CASE WHEN y.pdf_orden IS NOT NULL THEN '${BLOB}' || replace(y.pdf_orden, ' ', '%20') END AS "pdfOrden",
             CASE WHEN y.pdf_sustento IS NOT NULL THEN '${BLOB}' || replace(y.pdf_sustento, ' ', '%20') END AS "pdfSustento",
             (SELECT count(*) FROM perucompras_item i WHERE i.orden = y.orden AND i.version = 0)::int AS lineas,
             -- Lo pedido, línea por línea, con el precio de referencia de su ficha ese año (migración 237).
             (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'linea', i.linea, 'descripcion', i.descripcion, 'marca', i.marca, 'nroParte', i.nro_parte,
                       'categoria', i.categoria, 'ficha', ${FICHA("i.link_ficha")},
                       'cantidad', i.cantidad::float, 'precio', CASE WHEN i.cantidad > 0 THEN round(i.subtotal / i.cantidad, 2)::float END,
                       'subtotal', i.subtotal::float,
                       'ref', CASE WHEN r.ficha IS NOT NULL THEN jsonb_build_object('mediana', round(r.mediana, 2)::float, 'p25', round(r.p25, 2)::float,
                                                                                    'p75', round(r.p75, 2)::float, 'entidades', r.entidades, 'lineas', r.lineas) END,
                       'sobreprecio', CASE WHEN s.orden IS NOT NULL THEN jsonb_build_object('veces', s.veces::float, 'exceso', s.exceso::float) END
                     ) ORDER BY i.linea), '[]'::jsonb)
                FROM (SELECT * FROM perucompras_item i WHERE i.orden = y.orden AND i.version = 0 ORDER BY i.linea LIMIT ${LINEAS_FILA}) i
                LEFT JOIN perucompras_precio_ref r ON r.ficha = ${FICHA("i.link_ficha")} AND r.anio = y.anio
                LEFT JOIN perucompras_sobreprecio s ON s.orden = i.orden AND s.linea = i.linea) AS items,
             (SELECT jsonb_build_object('lineas', count(*), 'exceso', sum(s.exceso)::float, 'veces', max(s.veces)::float)
                FROM perucompras_sobreprecio s WHERE s.orden = y.orden HAVING count(*) > 0) AS sobreprecio,
             -- Las entregas (la versión 1 en adelante): cuántas y hasta cuándo debían llegar.
             (SELECT jsonb_build_object('entregas', count(DISTINCT i.nro_entrega), 'hasta', to_char(max(i.fecha_fin_entrega), 'YYYY-MM-DD'),
                                        'plazo', max(i.plazo_entrega))
                FROM perucompras_item i WHERE i.orden = y.orden AND i.version > 0 HAVING count(*) > 0) AS entregas
        FROM y ORDER BY ${ordenY}`;
    const f = sqlFacetas(q);
    const [r, fa] = await Promise.all([
      consultaConPlazo(sql, vals),
      // Sin conteos, la barra igual filtra (sin números): un error aquí no tumba la lista.
      consultaConPlazo(f.sql, f.vals).catch((e) => { console.warn(`[catalogo] facetas: ${(e as Error).message}`); return null; }),
    ]);
    const hayMas = r.rows.length > q.size;
    const fr = fa?.rows[0] as { anio: Record<string, number> | null; estado: Record<string, number> | null; sobreprecio: number; total: number; monto: number | null; exceso: number | null } | undefined;
    return publicar({
      page: q.page, size: q.size, hayMas, disponible: true,
      ancla: q.proveedor ? "proveedor" : q.entidad ? "entidad" : null,
      facetas: fr ? { anio: fr.anio ?? {}, estado: fr.estado ?? {}, sobreprecio: { si: fr.sobreprecio } } : null,
      // Lo que cumple los filtros: cuántas órdenes, por cuánto y cuánto pagaron sus líneas marcadas por encima de la mediana.
      resumen: fr ? { ordenes: fr.total, monto: fr.monto ?? 0, exceso: fr.exceso ?? 0 } : null,
      data: r.rows.slice(0, q.size),
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/**
 * Los conteos de cada filtro con los DEMÁS puestos (como en Menores), en una pasada: cada condición se evalúa una vez por
 * fila (`y`, materializada) y los conteos sólo combinan esos booleanos.
 */
function sqlFacetas(q: FiltrosCatalogo): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { filas, filtros } = condiciones(q, vals);
  const sin = (f: Faceta | null) => filtros.map((x, i) => (f === null || x.faceta !== f ? `y.f${i}` : null)).filter(Boolean) as string[];
  const donde = (conds: string[]) => (conds.length ? `WHERE ${conds.join(" AND ")}` : "");
  const y = [...filtros.map((x, i) => `(${x.sql}) AS f${i}`), "x.anio", "x.sobre", `${GRUPO_ESTADO} AS grupo`, "x.total", "x.orden"];
  return {
    sql: `WITH x AS (${filas}), y AS MATERIALIZED (SELECT ${y.join(", ")} FROM x)
          SELECT (SELECT jsonb_object_agg(a.anio, a.n) FROM (SELECT y.anio, count(*)::int AS n FROM y ${donde([...sin("anio"), "y.anio IS NOT NULL"])} GROUP BY 1) a) AS anio,
                 (SELECT jsonb_object_agg(e.grupo, e.n) FROM (SELECT y.grupo, count(*)::int AS n FROM y ${donde([...sin("estado"), "y.grupo IS NOT NULL"])} GROUP BY 1) e) AS estado,
                 (SELECT count(*)::int FROM y ${donde([...sin("sobreprecio"), "y.sobre"])}) AS sobreprecio,
                 (SELECT count(*)::int FROM y ${donde(sin(null))}) AS total,
                 (SELECT sum(y.total)::float FROM y ${donde(sin(null))}) AS monto,
                 (SELECT sum(s.exceso)::float FROM perucompras_sobreprecio s WHERE s.orden IN (SELECT y.orden FROM y ${donde([...sin(null), "y.sobre"])})) AS exceso`,
    vals,
  };
}

/**
 * Un producto (su ficha): qué es, el precio de referencia de cada año y quién lo compró, del precio más alto al más bajo
 * del año pedido (o del último con compras). Las líneas de esa ficha salen por el índice de la migración 237.
 */
catalogoRouter.get("/ficha/:ficha", async (c) => {
  const ficha = c.req.param("ficha");
  if (!/^[0-9A-Za-z]{1,40}$/.test(ficha)) return c.json({ error: "ficha_invalida" }, 400);
  const anioQ = Number(c.req.query("anio")) || null;
  if (anioQ != null && (anioQ < 2015 || anioQ > 2100)) return c.json({ error: "anio_invalido" }, 400);
  if (!(await hayCatalogo())) return c.json({ error: "sin_catalogo" }, 404);
  const cuerpo = await memoFicha.obtener(`${ficha}:${anioQ ?? ""}`, async () => {
    const refs = await consultaConPlazo(
      `SELECT anio, lineas, entidades, round(p25, 2)::float AS p25, round(mediana, 2)::float AS mediana, round(p75, 2)::float AS p75
         FROM perucompras_precio_ref WHERE ficha = $1 ORDER BY anio DESC`, [ficha]);
    if (!refs.rows.length) return null;
    const anio = anioQ ?? (refs.rows[0] as { anio: number }).anio;
    const compras = await consultaConPlazo(
      `SELECT i.orden, i.linea, i.descripcion, i.marca, i.nro_parte AS "nroParte", i.categoria, i.cantidad::float AS cantidad,
              round(i.subtotal / i.cantidad, 2)::float AS precio, i.subtotal::float AS subtotal,
              to_char(o.fecha_publicacion, 'YYYY-MM-DD') AS fecha, o.entidad_ruc AS "entidadRuc", o.entidad,
              o.proveedor_ruc AS "proveedorRuc", o.proveedor, o.estado, o.acuerdo_codigo AS "acuerdoCodigo",
              s.veces::float AS veces, s.exceso::float AS exceso
         FROM perucompras_item i
         JOIN perucompras_orden o USING (orden)
         LEFT JOIN perucompras_sobreprecio s ON s.orden = i.orden AND s.linea = i.linea
        WHERE ${FICHA("i.link_ficha")} = $1 AND i.version = 0 AND i.cantidad > 0 AND i.subtotal > 0
          AND o.fecha_publicacion >= make_date($2::int, 1, 1) AND o.fecha_publicacion < make_date($2::int + 1, 1, 1)
          AND o.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA')
        ORDER BY i.subtotal / i.cantidad DESC, o.fecha_publicacion DESC
        LIMIT 200`, [ficha, anio]);
    const filas = compras.rows as { descripcion: string | null; marca: string | null; nroParte: string | null; categoria: string | null }[];
    const muestra = filas[0];
    return publicar({
      ficha, anio,
      producto: muestra ? { descripcion: muestra.descripcion, marca: muestra.marca, nroParte: muestra.nroParte, categoria: muestra.categoria } : null,
      referencias: refs.rows,
      compras: compras.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
