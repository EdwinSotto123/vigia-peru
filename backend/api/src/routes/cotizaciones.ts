import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * Contrataciones menores ABIERTAS (≤8 UIT) para Gobserva Licitaciones (2026-11-07): lo que un proveedor todavía puede
 * cotizar en el SEACE (prod6). Las carga cada hora la fuente `seace_cotizaciones` del Worker de scrapers en
 * `seace_cotizacion` (migración 262).
 *
 *   GET /licitaciones/menores        la lista con filtros (texto, región, tipo, entidad, rubro CUBSO, cuándo cierran,
 *                                    orden) y sus conteos por tipo y región, con las cifras de cabecera.
 *   GET /licitaciones/menores/:id/requerimiento   el TDR o las especificaciones en PDF, desde R2 (lo copia la fuente:
 *                                    la API no puede pedirlo a prod6, cuyo WAF bloquea su salida).
 *   GET /licitaciones/menores/:id    la ficha: los ítems, el requerimiento (si se copió) y la inteligencia: qué compró
 *                                    esa entidad por contratos menores en 12 meses y a quién, y lo que se pagó por los
 *                                    mismos ítems (CUBSO) en contratos menores adjudicados y su precio de referencia en los
 *                                    procesos del Estado (precio_referencia).
 *
 * Lo que prod6 no trae no se inventa: no hay monto referencial (la entidad no lo publica). De los ganadores, nombre y
 * RUC sólo de empresas (RUC 20); una persona natural se cuenta sin nombrarla. Todo sale por `publicar()`.
 */
export const cotizacionesRouter = new Hono();

const CACHE = cachePublico(300, { maxAge: 60, swr: 900 });
const memo = new Memo<Record<string, unknown>>({ nombre: "cotizaciones", ttlMs: 300_000, staleMs: 900_000, max: 400 });
const memoFicha = new Memo<Record<string, unknown> | null>({ nombre: "cotizaciones-ficha", ttlMs: 300_000, staleMs: 900_000, max: 600 });

/** Los mismos nombres de tipo que las licitaciones; prod6 los escribe así. */
const TIPOS = { bienes: "Bien", servicios: "Servicio", obras: "Obra", consultoria: "Consultoría de Obra" } as const;
const TIPO_DE: Record<string, keyof typeof TIPOS> = Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [v, k as keyof typeof TIPOS]));
const RUC20 = `'^20[0-9]{9}$'`;

const TEXTO = `immutable_unaccent(upper(coalesce(x.descripcion, '') || ' ' || coalesce(x.entidad, '') || ' ' || coalesce(x.area_usuaria, '') || ' ' || coalesce(x.items::text, '')))`;
const ABIERTA = `x.estado = 'Vigente' AND x.fec_fin_cotizacion > now()`;
const HOY_FIN = `((now() AT TIME ZONE 'America/Lima')::date + 1)::timestamp AT TIME ZONE 'America/Lima'`;

const COLS = `x.id_prod6 AS id, x.codigo, x.objeto AS "objetoSeace", x.descripcion, x.entidad, x.entidad_ruc AS "entidadRuc",
  x.area_usuaria AS area, x.tipo_invitacion AS invitacion, x.fec_publica AS publicada, x.fec_ini_cotizacion AS "abreCotizacion",
  x.fec_fin_cotizacion AS cierra, x.consultas_hasta AS "consultasHasta", x.departamentos AS regiones,
  COALESCE(jsonb_array_length(x.items), 0)::int AS items,
  (SELECT array_agg(n) FROM (SELECT DISTINCT i->>'nombre' AS n FROM jsonb_array_elements(COALESCE(x.items, '[]'::jsonb)) i
                              WHERE i->>'nombre' IS NOT NULL LIMIT 3) t) AS rubros`;

const QMenores = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
  tipo: z.enum(Object.keys(TIPOS) as [keyof typeof TIPOS, ...(keyof typeof TIPOS)[]]).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  /** Un rubro: los primeros 2 a 8 dígitos del CUBSO (segmento, familia o clase). */
  cubso: z.string().regex(/^\d{2,8}$/).optional(),
  /** «hoy»: cierran antes de medianoche (Lima); «nuevas»: publicadas en las últimas 24 horas. */
  cuando: z.enum(["hoy", "nuevas"]).optional(),
  orden: z.enum(["cierra", "reciente"]).default("cierra"),
  page: z.coerce.number().int().min(1).max(100).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
type QM = z.infer<typeof QMenores>;

function condiciones(q: QM, sin?: "tipo" | "region", nuevasDesde?: Date) {
  const conds = [ABIERTA];
  const vals: unknown[] = [];
  if (nuevasDesde) { vals.push(nuevasDesde.toISOString()); conds.push(`x.primera_vez > $${vals.length}::timestamptz`); }
  if (q.tipo && sin !== "tipo") { vals.push(TIPOS[q.tipo]); conds.push(`x.objeto = $${vals.length}`); }
  if (q.region && sin !== "region") { vals.push(q.region); conds.push(`$${vals.length} = ANY(x.departamentos)`); }
  if (q.entidad) { vals.push(q.entidad); conds.push(`x.entidad_ruc = $${vals.length}`); }
  if (q.cubso) { vals.push(`${q.cubso}%`); conds.push(`EXISTS (SELECT 1 FROM unnest(x.cubso8) c WHERE c LIKE $${vals.length})`); }
  if (q.cuando === "hoy") conds.push(`x.fec_fin_cotizacion < ${HOY_FIN}`);
  if (q.cuando === "nuevas") conds.push(`x.fec_publica > now() - interval '24 hours'`);
  for (const w of palabrasBusqueda(q.q)) { vals.push(`%${w}%`); conds.push(`${TEXTO} LIKE $${vals.length}`); }
  return { conds, vals };
}

const ordenDe = (o: QM["orden"]) => (o === "reciente" ? "x.fec_publica DESC NULLS LAST, x.id_prod6 DESC" : "x.fec_fin_cotizacion ASC, x.id_prod6");

/** Con el tipo en palabras de la web («bienes»…) además del de prod6. */
const conTipo = (filas: Record<string, unknown>[]) => filas.map((f) => ({ ...f, tipo: TIPO_DE[String(f.objetoSeace)] ?? null }));

/** Los filtros de una alerta, validados como los de la lista (lo que no sirve, se descarta). */
export function filtrosMenores(f: Record<string, unknown>): QM | null {
  const p = QMenores.safeParse(Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== "" && v != null && k !== "page" && k !== "size")));
  return p.success ? p.data : null;
}

/** Las abiertas de una búsqueda, hasta `limite`; con `nuevasDesde`, sólo las que entraron después (alertas). */
export async function filasMenores(q: QM, limite: number, nuevasDesde?: Date): Promise<Record<string, unknown>[]> {
  const { conds, vals } = condiciones(q, undefined, nuevasDesde);
  const r = await pool.query(
    `SELECT ${COLS} FROM seace_cotizacion x WHERE ${conds.join(" AND ")} ORDER BY ${ordenDe(nuevasDesde ? "reciente" : q.orden)}
      LIMIT ${Math.max(1, Math.min(2000, Math.floor(limite)))}`, vals);
  return publicar(conTipo(r.rows)) as Record<string, unknown>[];
}

cotizacionesRouter.get("/", async (c) => {
  const p = QMenores.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`m:${JSON.stringify(q)}`, async () => {
    const todo = condiciones(q);
    const sinTipo = condiciones(q, "tipo");
    const sinRegion = condiciones(q, "region");
    const [filas, resumen, porTipo, porRegion, cabecera] = await Promise.all([
      pool.query(`SELECT ${COLS} FROM seace_cotizacion x WHERE ${todo.conds.join(" AND ")} ORDER BY ${ordenDe(q.orden)}
                   LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, todo.vals),
      pool.query(`SELECT count(*)::int AS total, count(DISTINCT x.entidad)::int AS entidades FROM seace_cotizacion x WHERE ${todo.conds.join(" AND ")}`, todo.vals),
      pool.query(`SELECT x.objeto AS clave, count(*)::int AS n FROM seace_cotizacion x WHERE ${sinTipo.conds.join(" AND ")} GROUP BY 1 ORDER BY 2 DESC`, sinTipo.vals),
      pool.query(`SELECT d AS clave, count(*)::int AS n FROM seace_cotizacion x, unnest(x.departamentos) d WHERE ${sinRegion.conds.join(" AND ")} GROUP BY 1 ORDER BY 2 DESC`, sinRegion.vals),
      // Las cifras de la cabecera, sin filtros: cuántas hay abiertas, cuántas cierran hoy y cuántas salieron en 24 h.
      pool.query(`SELECT count(*)::int AS abiertas, count(*) FILTER (WHERE x.fec_fin_cotizacion < ${HOY_FIN})::int AS "cierranHoy",
                         count(*) FILTER (WHERE x.fec_publica > now() - interval '24 hours')::int AS "nuevas24h",
                         max(x.visto_at) AS actualizado
                    FROM seace_cotizacion x WHERE ${ABIERTA}`),
    ]);
    return publicar({
      ...q, total: resumen.rows[0]?.total ?? 0, resumen: resumen.rows[0], cabecera: cabecera.rows[0], data: conTipo(filas.rows),
      porTipo: porTipo.rows.map((r) => ({ clave: TIPO_DE[r.clave] ?? r.clave, n: r.n })), porRegion: porRegion.rows,
    });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

cotizacionesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await memoFicha.obtener(`f:${id}`, async () => {
    const r = await pool.query(
      `SELECT ${COLS}, x.estado, x.items AS "itemsDetalle", x.distritos, x.primera_vez AS "vistaDesde",
              x.req_r2 AS "tieneRequerimiento", x.requerimiento_nombre AS "requerimientoNombre",
              (x.estado = 'Vigente' AND x.fec_fin_cotizacion > now()) AS abierta
         FROM seace_cotizacion x WHERE x.id_prod6 = $1`, [Number(id)]);
    const f = r.rows[0];
    if (!f) return null;
    const cubsos = [...new Set(((f.itemsDetalle ?? []) as { cubso?: string }[]).map((i) => i.cubso).filter((x): x is string => !!x && /^\d{16}$/.test(x)))];
    const [entidad, precios, referencia] = await Promise.all([
      f.entidadRuc
        ? pool.query(
            `WITH m AS (SELECT proveedor_ruc AS ruc, proveedor, monto FROM seace_menores
                         WHERE entidad_ruc = $1 AND moneda = 'PEN' AND fecha_suscripcion >= current_date - 365)
             SELECT (SELECT count(*) FROM m)::int AS contratos, (SELECT COALESCE(sum(monto), 0) FROM m)::float AS monto,
                    (SELECT count(DISTINCT ruc) FROM m)::int AS proveedores,
                    (SELECT count(*) FROM m WHERE ruc !~ ${RUC20})::int AS "aPersonas",
                    (SELECT COALESCE(json_agg(t ORDER BY t.monto DESC), '[]') FROM (
                       SELECT ruc, max(proveedor) AS nombre, count(*)::int AS contratos, sum(monto)::float AS monto
                         FROM m WHERE ruc ~ ${RUC20} GROUP BY 1 ORDER BY 4 DESC LIMIT 8) t) AS ganadores`,
            [f.entidadRuc])
        : null,
      cubsos.length
        ? pool.query(
            `SELECT i.cubso, max(i.cubso_nombre) AS nombre, max(i.unidad) AS unidad, count(*)::int AS veces,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY i.precio_unitario)::float AS mediana,
                    min(i.precio_unitario)::float AS minimo, max(i.precio_unitario)::float AS maximo,
                    to_char(max(m.fecha_suscripcion), 'YYYY-MM-DD') AS ultima
               FROM seace_menor_item i JOIN menor_item_con_precio v USING (id_contrato) JOIN seace_menores m USING (id_contrato)
              WHERE i.cubso = ANY($1::text[]) AND i.precio_unitario > 0 AND m.fecha_suscripcion >= current_date - 730
              GROUP BY i.cubso`,
            [cubsos])
        : null,
      // Y el precio de referencia de los procesos del Estado (OCDS; migración 84): el año más reciente de cada CUBSO.
      cubsos.length
        ? pool.query(
            `SELECT DISTINCT ON (cubso) cubso, unidad, anio, n::int AS veces, p25::float, mediana::float, p75::float
               FROM precio_referencia WHERE cubso = ANY($1::text[]) AND mediana > 0
              ORDER BY cubso, anio DESC, n DESC`,
            [cubsos])
        : null,
    ]);
    const { itemsDetalle, ...resto } = f as Record<string, unknown>;
    return publicar({
      ...conTipo([resto])[0], items: itemsDetalle ?? [], entidadMenores: entidad?.rows[0] ?? null, precios: precios?.rows ?? [],
      preciosProcesos: referencia?.rows ?? [],
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

interface ObjetoR2 { body: ReadableStream }
interface BucketR2Lectura { get(clave: string): Promise<ObjetoR2 | null> }

cotizacionesRouter.get("/:id/requerimiento", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return c.json({ error: "not_found" }, 404);
  const bucket = (c.env as { DOCUMENTOS?: BucketR2Lectura } | undefined)?.DOCUMENTOS;
  const obj = bucket ? await bucket.get(`seace/cotizaciones/req/${id}.pdf`) : null;
  if (!obj) return c.json({ error: "sin_requerimiento" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="requerimiento-${id}.pdf"`,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
});
