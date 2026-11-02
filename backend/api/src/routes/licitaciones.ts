import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { busquedaOece, procesoOece } from "../lib/fuentes.js";
import { palabrasBusqueda } from "./personas.js";

/**
 * licitaciones.gobserva.cloud (Gobserva Licitaciones, 2026-11-01): las convocatorias del SEACE para quien le vende al
 * Estado, con la inteligencia de mercado que Vigía ya tiene (adjudicaciones y postores de CONOSCE, precios por CUBSO).
 *
 *   GET /licitaciones/resumen               la portada: convocadas hoy, en la semana y en 15 días, valor referencial en
 *                                           juego, por tipo y región, las recién convocadas y las de mayor valor, y la
 *                                           competencia de los últimos 12 meses (postores por proceso, un solo postor).
 *   GET /licitaciones/oportunidades         la lista con filtros (texto, región, tipo, valor, días, entidad, orden) y
 *                                           sus conteos por tipo y región.
 *   GET /licitaciones/oportunidades/:ocid   la ficha: la convocatoria entera (ítems con CUBSO, documentos, consultas) y la
 *                                           inteligencia: la entidad en 12 meses (sus proveedores, un solo postor, cuánto
 *                                           se adjudica frente al referencial) y procesos parecidos con sus precios.
 *   GET /licitaciones/mercado?q=            un rubro en 12 meses: procesos, monto, serie por mes, quién compra, quién
 *                                           gana, cuántos compiten y en qué regiones.
 *
 * Lo que el dato NO trae no se inventa: la fecha de `tenderPeriod` del OCDS es la de publicación, no el plazo para
 * ofertar (el cronograma completo está en el SEACE); de los ganadores, nombre y RUC sólo de una empresa (RUC 20); un
 * consorcio o una persona natural se cuentan sin nombrarlos. Todo sale por `publicar()`.
 */
export const licitacionesRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const CACHE_LARGO = cachePublico(3600, { maxAge: 600, swr: 21600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "licitaciones", ttlMs: 600_000, staleMs: 1_800_000, max: 400 });
const memoLargo = new Memo<Record<string, unknown>>({ nombre: "licitaciones-largo", ttlMs: 6 * 3_600_000, staleMs: 6 * 3_600_000, max: 300 });
/** Las fichas (null: no existe; un proceso recién cargado tarda como mucho 10 min en aparecer). */
const memoFicha = new Memo<Record<string, unknown> | null>({ nombre: "licitaciones-ficha", ttlMs: 600_000, staleMs: 1_800_000, max: 600 });

const TIPOS = ["bienes", "servicios", "obras", "consultoria"] as const;
const RUC20 = `'^20[0-9]{9}$'`;
const esRuc20 = (v: unknown) => typeof v === "string" && /^20\d{9}$/.test(v);
const anioDesde = () => new Date().getUTCFullYear() - 1;

/** Lo que se busca: objeto, entidad, descripción y los ítems (con su CUBSO), sin tildes y en mayúsculas. */
const TEXTO_CONVOCATORIA = `immutable_unaccent(upper(concat_ws(' ', c.objeto, e.nombre, c.ocds_payload->'tender'->>'description', (c.ocds_payload->'tender'->'items')::text)))`;

// Columnas de una oportunidad en las listas.
const COLS_OPORTUNIDAD = `c.ocid, c.codigo, c.objeto, c.tipo_contratacion AS tipo, c.ocds_payload->'tender'->>'procurementMethodDetails' AS procedimiento,
  NULLIF(c.cuantia_referencial, 0)::float AS valor, to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, c.entidad_ruc::text AS "entidadRuc",
  e.nombre AS entidad, left(c.ubigeo_zona, 2) AS region,
  substr(c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate', 1, 10) AS "consultasHasta",
  jsonb_array_length(COALESCE(c.ocds_payload->'tender'->'items', '[]'::jsonb))::int AS items`;

// ─── GET /licitaciones/resumen ───────────────────────────────────────────────
licitacionesRouter.get("/resumen", async (c) => {
  const cuerpo = await memo.obtener("resumen", async () => {
    const [cifras, recientes, mayores, competencia] = await Promise.all([
      pool.query(
        `WITH v AS (
           SELECT c.fecha_convocatoria AS f, c.cuantia_referencial AS valor, c.entidad_ruc, c.tipo_contratacion AS tipo, left(c.ubigeo_zona, 2) AS region
             FROM convocatorias c
            WHERE c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 14 AND c.fecha_convocatoria <= current_date
         )
         SELECT (SELECT to_char(max(f), 'YYYY-MM-DD') FROM v) AS "ultimoDia",
                (SELECT count(*) FROM v WHERE f = (SELECT max(f) FROM v))::int AS "delUltimoDia",
                (SELECT count(*) FROM v WHERE f >= current_date - 6)::int AS semana,
                (SELECT count(*) FROM v)::int AS quince,
                (SELECT count(*) FROM v WHERE valor > 0)::int AS "conValor",
                (SELECT COALESCE(sum(valor), 0) FROM v WHERE valor > 0)::float AS "valorEnJuego",
                (SELECT count(DISTINCT entidad_ruc) FROM v)::int AS entidades,
                (SELECT COALESCE(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT tipo AS clave, count(*)::int AS n, COALESCE(sum(valor) FILTER (WHERE valor > 0), 0)::float AS valor FROM v GROUP BY 1) t) AS "porTipo",
                (SELECT COALESCE(json_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT region AS clave, count(*)::int AS n FROM v WHERE region IS NOT NULL GROUP BY 1) t) AS "porRegion",
                (SELECT COALESCE(json_agg(t ORDER BY t.f), '[]') FROM (SELECT to_char(f, 'YYYY-MM-DD') AS f, count(*)::int AS n FROM v GROUP BY f) t) AS "porDia"`,
      ),
      pool.query(
        `SELECT ${COLS_OPORTUNIDAD}
           FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
          WHERE c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 6 AND c.fecha_convocatoria <= current_date
          ORDER BY c.fecha_convocatoria DESC, c.cuantia_referencial DESC NULLS LAST, c.ocid DESC
          LIMIT 6`,
      ),
      pool.query(
        `SELECT ${COLS_OPORTUNIDAD}
           FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
          WHERE c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 14 AND c.fecha_convocatoria <= current_date AND c.cuantia_referencial > 0
          ORDER BY c.cuantia_referencial DESC, c.ocid DESC
          LIMIT 5`,
      ),
      memoLargo.obtener("competencia", async () => {
        const r = await pool.query(
          `WITH p AS (
             SELECT codigo_convocatoria, count(DISTINCT ruc_postor) AS n FROM conosce_postores
              WHERE anio >= $1 AND fecha_convocatoria >= current_date - 365 GROUP BY 1
           ), a AS (
             SELECT monto_adjudicado AS adj, monto_referencial AS ref FROM conosce_adjudicaciones
              WHERE anio >= $1 AND fecha_buenapro >= current_date - 365 AND fecha_buenapro <= current_date
           )
           SELECT (SELECT count(*) FROM p)::int AS procesos, (SELECT avg(n) FROM p)::float AS "postoresPromedio",
                  (SELECT count(*) FILTER (WHERE n = 1) FROM p)::int AS "unSoloPostor",
                  (SELECT COALESCE(sum(adj), 0) FROM a)::float AS adjudicado,
                  (SELECT sum(adj) FILTER (WHERE ref > 0 AND adj > 0) / NULLIF(sum(ref) FILTER (WHERE ref > 0 AND adj > 0), 0) FROM a)::float AS "adjSobreRef"`,
          [anioDesde()],
        );
        return r.rows[0] ?? {};
      }),
    ]);
    return publicar({ ...cifras.rows[0], recientes: recientes.rows, mayores: mayores.rows, competencia });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /licitaciones/oportunidades ─────────────────────────────────────────
const QOportunidades = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
  tipo: z.enum(TIPOS).optional(),
  min: z.coerce.number().min(0).max(1e12).optional(),
  max: z.coerce.number().min(0).max(1e12).optional(),
  dias: z.coerce.number().int().min(1).max(60).default(15),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  /** El plazo de consultas y observaciones: «abiertas» (todavía se puede preguntar) o «semana» (vence en 7 días). */
  consultas: z.enum(["abiertas", "semana"]).optional(),
  orden: z.enum(["reciente", "valor", "consultas"]).default("reciente"),
  page: z.coerce.number().int().min(1).max(50).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
type QOp = z.infer<typeof QOportunidades>;

/** El fin del plazo de consultas del OCDS («YYYY-MM-DD»), el mismo texto que la columna «consultasHasta». */
const FIN_CONSULTAS = `substr(c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate', 1, 10)`;
const HOY_TEXTO = `to_char((now() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD')`;
const SEMANA_TEXTO = `to_char((now() AT TIME ZONE 'America/Lima')::date + 7, 'YYYY-MM-DD')`;

/** El orden de la lista: «consultas» pone primero lo que vence antes y todavía está abierto (lo cerrado, al final). */
function ordenOportunidades(orden: QOp["orden"]): string {
  if (orden === "valor") return `c.cuantia_referencial DESC NULLS LAST, c.fecha_convocatoria DESC, c.ocid DESC`;
  if (orden === "consultas") return `(${FIN_CONSULTAS} >= ${HOY_TEXTO}) DESC NULLS LAST, ${FIN_CONSULTAS} ASC NULLS LAST, c.fecha_convocatoria DESC, c.ocid DESC`;
  return `c.fecha_convocatoria DESC, c.cuantia_referencial DESC NULLS LAST, c.ocid DESC`;
}

/** Las condiciones de una búsqueda, sin la dimensión `sin` (para contar sus opciones con los demás filtros). */
function condiciones(q: QOp, sin?: "tipo" | "region", nuevasDesde?: Date) {
  const conds = [`c.etapa = 'convocada'`, `c.fecha_convocatoria >= current_date - $1::int`, `c.fecha_convocatoria <= current_date`];
  const vals: unknown[] = [q.dias];
  // Lo nuevo para una alerta: lo que entró a la base después del último aviso.
  if (nuevasDesde) { vals.push(nuevasDesde.toISOString()); conds.push(`c.created_at > $${vals.length}::timestamptz`); }
  if (q.tipo && sin !== "tipo") { vals.push(q.tipo); conds.push(`c.tipo_contratacion = $${vals.length}`); }
  if (q.region && sin !== "region") { vals.push(q.region); conds.push(`left(c.ubigeo_zona, 2) = $${vals.length}`); }
  if (q.min != null) { vals.push(q.min); conds.push(`c.cuantia_referencial >= $${vals.length}`); }
  if (q.max != null) { vals.push(q.max); conds.push(`c.cuantia_referencial > 0 AND c.cuantia_referencial <= $${vals.length}`); }
  if (q.entidad) { vals.push(q.entidad); conds.push(`c.entidad_ruc = $${vals.length}::char(11)`); }
  if (q.consultas === "abiertas") conds.push(`${FIN_CONSULTAS} >= ${HOY_TEXTO}`);
  if (q.consultas === "semana") conds.push(`${FIN_CONSULTAS} BETWEEN ${HOY_TEXTO} AND ${SEMANA_TEXTO}`);
  for (const w of palabrasBusqueda(q.q)) { vals.push(`%${w}%`); conds.push(`${TEXTO_CONVOCATORIA} LIKE $${vals.length}`); }
  return { conds, vals };
}

/** Los filtros de una alerta o de una descarga, validados como los de la lista (lo que no sirve, se descarta). */
export function filtrosOportunidades(f: Record<string, unknown>): QOp | null {
  const p = QOportunidades.safeParse(Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== "" && v != null && k !== "page" && k !== "size")));
  return p.success ? p.data : null;
}

/**
 * Las oportunidades de una búsqueda, hasta `limite` (alertas y CSV de lib/gobservaAlertas.ts), con las columnas de la
 * lista. Con `nuevasDesde`, sólo las que entraron después de ese momento (en los últimos 60 días de convocatoria).
 */
export async function filasOportunidades(q: QOp, limite: number, nuevasDesde?: Date): Promise<Record<string, unknown>[]> {
  const { conds, vals } = condiciones(nuevasDesde ? { ...q, dias: 60 } : q, undefined, nuevasDesde);
  // Una alerta va siempre de lo más reciente; la descarga, en el orden de la lista.
  const orden = ordenOportunidades(nuevasDesde ? "reciente" : q.orden);
  const r = await pool.query(
    `SELECT ${COLS_OPORTUNIDAD} FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
      WHERE ${conds.join(" AND ")} ORDER BY ${orden} LIMIT ${Math.max(1, Math.min(5000, Math.floor(limite)))}`,
    vals,
  );
  return publicar(r.rows) as Record<string, unknown>[];
}

licitacionesRouter.get("/oportunidades", async (c) => {
  const p = QOportunidades.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const q = p.data;
  const cuerpo = await memo.obtener(`op:${JSON.stringify(q)}`, async () => {
    const todo = condiciones(q);
    const sinTipo = condiciones(q, "tipo");
    const sinRegion = condiciones(q, "region");
    const desde = `FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc`;
    const orden = ordenOportunidades(q.orden);
    const [filas, resumen, porTipo, porRegion] = await Promise.all([
      pool.query(`SELECT ${COLS_OPORTUNIDAD} ${desde} WHERE ${todo.conds.join(" AND ")} ORDER BY ${orden} LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`, todo.vals),
      pool.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.cuantia_referencial > 0)::int AS "conValor",
                COALESCE(sum(c.cuantia_referencial) FILTER (WHERE c.cuantia_referencial > 0), 0)::float AS "valorTotal",
                count(DISTINCT c.entidad_ruc)::int AS entidades
           ${desde} WHERE ${todo.conds.join(" AND ")}`,
        todo.vals,
      ),
      pool.query(`SELECT c.tipo_contratacion AS clave, count(*)::int AS n ${desde} WHERE ${sinTipo.conds.join(" AND ")} GROUP BY 1 ORDER BY 2 DESC`, sinTipo.vals),
      pool.query(`SELECT left(c.ubigeo_zona, 2) AS clave, count(*)::int AS n ${desde} WHERE ${sinRegion.conds.join(" AND ")} AND c.ubigeo_zona IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, sinRegion.vals),
    ]);
    const r = resumen.rows[0] ?? { total: 0 };
    return publicar({ ...q, total: r.total, resumen: r, data: filas.rows, porTipo: porTipo.rows, porRegion: porRegion.rows });
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /licitaciones/oportunidades/:ocid ───────────────────────────────────
interface ItemOcds {
  position?: string;
  description?: string;
  quantity?: number;
  unit?: { name?: string };
  classification?: { id?: string; scheme?: string; description?: string };
  totalValue?: { amount?: number };
  statusDetails?: string;
}
interface DocOcds {
  title?: string;
  url?: string;
  documentType?: string;
  datePublished?: string;
  format?: string;
}

const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

licitacionesRouter.get("/oportunidades/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[A-Za-z0-9-]{4,80}$/.test(ocid)) return c.json({ error: "not_found" }, 404);
  const cuerpo = await memoFicha.obtener(`ficha:${ocid}`, async () => {
    const r = await pool.query(
      `SELECT c.ocid, c.codigo, c.objeto, c.tipo_contratacion AS tipo, c.etapa, NULLIF(c.cuantia_referencial, 0)::float AS valor,
              to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha, c.entidad_ruc::text AS "entidadRuc", e.nombre AS entidad,
              e.region AS "entidadRegion", e.provincia AS "entidadProvincia", left(c.ubigeo_zona, 2) AS region, c.ocds_payload->'tender' AS tender
         FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
        WHERE c.ocid = $1`,
      [ocid],
    );
    const k = r.rows[0];
    if (!k) return null;
    const tender = (k.tender ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(tender.items) ? (tender.items as ItemOcds[]) : []).map((i, n) => ({
      posicion: Number(i.position) || n + 1,
      descripcion: i.description ?? null,
      cantidad: typeof i.quantity === "number" ? i.quantity : null,
      unidad: i.unit?.name ?? null,
      cubso: i.classification?.scheme === "CUBSO" ? i.classification.id ?? null : null,
      cubsoNombre: i.classification?.description ?? null,
      valor: typeof i.totalValue?.amount === "number" && i.totalValue.amount > 0 ? i.totalValue.amount : null,
      estado: i.statusDetails ?? null,
    }));
    const documentos = (Array.isArray(tender.documents) ? (tender.documents as DocOcds[]) : [])
      .filter((d) => typeof d.url === "string" && /^https:\/\/[a-z0-9.-]+\.gob\.pe\//i.test(d.url))
      .map((d) => ({ titulo: d.title ?? "Documento", url: d.url, tipo: d.documentType ?? null, fecha: dia(d.datePublished), formato: d.format ?? null }))
      .slice(0, 30);
    const consultas = tender.enquiryPeriod as { startDate?: string; endDate?: string } | undefined;
    const cubsos = [...new Set(items.map((i) => i.cubso).filter((x): x is string => !!x))].slice(0, 20);
    const entidadRuc = typeof k.entidadRuc === "string" ? k.entidadRuc.trim() : null;

    const [entidad, parecidos, precios] = await Promise.all([
      entidadRuc ? inteligenciaEntidad(entidadRuc) : Promise.resolve(null),
      cubsos.length
        ? pool.query(
            `SELECT p.ocid, p.codigo, p.descripcion, p.objeto, p.entidad_ruc AS "entidadRuc", e.nombre AS entidad, p.departamento,
                    to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.unidad, p.cantidad::float, p.unit_ref::float AS "unitRef", p.unit_adj::float AS "unitAdj",
                    p.adjudicado::float, p.ruc_proveedor AS ruc, p.proveedor
               FROM precio_item p LEFT JOIN entidades e ON e.ruc = p.entidad_ruc
              WHERE p.cubso = ANY($1::text[]) AND p.anio >= $2 AND p.adjudicado > 0 AND p.ocid <> $3
              ORDER BY p.fecha DESC NULLS LAST
              LIMIT 10`,
            [cubsos, anioDesde(), k.ocid],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      cubsos.length
        ? pool.query(
            // Lo adjudicado antes que lo referencial (base), el año más reciente y la muestra más grande.
            `SELECT DISTINCT ON (cubso, unidad) cubso, unidad, anio, base, n, entidades, p25::float, mediana::float, p75::float
               FROM precio_referencia WHERE cubso = ANY($1::text[]) AND n >= 3
              ORDER BY cubso, unidad, (base = 'adjudicado') DESC, anio DESC, n DESC`,
            [cubsos],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    return publicar({
      ocid: k.ocid,
      codigo: k.codigo,
      objeto: k.objeto,
      descripcion: typeof tender.description === "string" ? tender.description : null,
      tipo: k.tipo,
      etapa: k.etapa,
      procedimiento: typeof tender.procurementMethodDetails === "string" ? tender.procurementMethodDetails : null,
      valor: k.valor,
      fecha: k.fecha,
      consultas: consultas ? { desde: dia(consultas.startDate), hasta: dia(consultas.endDate) } : null,
      entidadRuc,
      entidad: k.entidad,
      entidadRegion: k.entidadRegion,
      entidadProvincia: k.entidadProvincia,
      region: k.region,
      items,
      documentos,
      enlaces: { oece: procesoOece(k.ocid), busqueda: k.codigo ? busquedaOece(k.codigo) : null },
      inteligencia: entidad,
      // Ganador con nombre sólo si es una empresa (RUC 20).
      parecidos: parecidos.rows.map((x) => ({ ...x, ruc: esRuc20(x.ruc) ? x.ruc : null, proveedor: esRuc20(x.ruc) ? x.proveedor : null })),
      precios: precios.rows,
    });
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** La entidad en los últimos 12 meses (CONOSCE): procesos adjudicados, monto, sus proveedores (RUC 20) y la competencia. */
async function inteligenciaEntidad(ruc: string) {
  return memoLargo.obtener(`entidad:${ruc}`, async () => {
    const r = await pool.query(
      `WITH a AS MATERIALIZED (
         SELECT codigo_convocatoria AS codigo, ruc_proveedor, proveedor, monto_adjudicado AS adj, monto_referencial AS ref
           FROM conosce_adjudicaciones
          WHERE entidad_ruc = $1 AND anio >= $2 AND fecha_buenapro >= current_date - 365 AND fecha_buenapro <= current_date
       ), p AS (
         SELECT codigo_convocatoria, count(DISTINCT ruc_postor) AS n FROM conosce_postores
          WHERE codigo_convocatoria IN (SELECT DISTINCT codigo FROM a) GROUP BY 1
       )
       SELECT (SELECT count(DISTINCT codigo) FROM a)::int AS procesos,
              (SELECT COALESCE(sum(adj), 0) FROM a)::float AS monto,
              (SELECT sum(adj) FILTER (WHERE ref > 0 AND adj > 0) / NULLIF(sum(ref) FILTER (WHERE ref > 0 AND adj > 0), 0) FROM a)::float AS "adjSobreRef",
              (SELECT count(*) FROM p)::int AS "conPostores",
              (SELECT avg(n) FROM p)::float AS "postoresPromedio",
              (SELECT count(*) FILTER (WHERE n = 1) FROM p)::int AS "unSoloPostor",
              (SELECT COALESCE(json_agg(t ORDER BY t.monto DESC NULLS LAST), '[]') FROM (
                 SELECT ruc_proveedor AS ruc, max(proveedor) AS nombre, count(DISTINCT codigo)::int AS procesos, sum(adj)::float AS monto
                   FROM a WHERE ruc_proveedor ~ ${RUC20} GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 6) t) AS proveedores`,
      [ruc, anioDesde()],
    );
    return r.rows[0] ?? {};
  });
}

// ─── GET /licitaciones/mercado ───────────────────────────────────────────────
const QMercado = z.object({ q: z.string().trim().min(3).max(80) });

licitacionesRouter.get("/mercado", async (c) => {
  const p = QMercado.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const palabras = palabrasBusqueda(p.data.q);
  if (!palabras.length) return c.json({ error: "invalid_query" }, 400);
  const clave = palabras.join(" ");
  const cuerpo = await memoLargo.obtener(`mercado:${clave}`, async () => {
    const vals: unknown[] = [anioDesde()];
    const conds = palabras.map((w) => {
      vals.push(`%${w}%`);
      return `immutable_unaccent(upper(concat_ws(' ', a.descripcion_item, a.descripcion_proceso))) LIKE $${vals.length}`;
    });
    const r = await pool.query(
      `WITH a AS MATERIALIZED (
         SELECT a.codigo_convocatoria AS codigo, a.entidad_ruc, a.entidad, a.entidad_departamento AS dep, a.ruc_proveedor, a.proveedor,
                a.monto_adjudicado AS adj, a.monto_referencial AS ref, a.fecha_buenapro AS f, a.descripcion_item AS item, a.objeto
           FROM conosce_adjudicaciones a
          WHERE a.anio >= $1 AND a.fecha_buenapro >= current_date - 365 AND a.fecha_buenapro <= current_date AND ${conds.join(" AND ")}
       ), p AS (
         SELECT codigo_convocatoria, count(DISTINCT ruc_postor) AS n FROM conosce_postores
          WHERE codigo_convocatoria IN (SELECT DISTINCT codigo FROM a) GROUP BY 1
       )
       SELECT (SELECT count(DISTINCT codigo) FROM a)::int AS procesos,
              (SELECT count(*) FROM a)::int AS items,
              (SELECT COALESCE(sum(adj), 0) FROM a)::float AS monto,
              (SELECT sum(adj) FILTER (WHERE ref > 0 AND adj > 0) / NULLIF(sum(ref) FILTER (WHERE ref > 0 AND adj > 0), 0) FROM a)::float AS "adjSobreRef",
              (SELECT count(DISTINCT entidad_ruc) FROM a)::int AS entidades,
              (SELECT count(DISTINCT ruc_proveedor) FROM a WHERE ruc_proveedor IS NOT NULL)::int AS ganadores,
              (SELECT COALESCE(sum(adj), 0) FROM a WHERE ruc_proveedor ~ ${RUC20})::float AS "montoEmpresas",
              (SELECT count(*) FROM p)::int AS "conPostores",
              (SELECT avg(n) FROM p)::float AS "postoresPromedio",
              (SELECT count(*) FILTER (WHERE n = 1) FROM p)::int AS "unSoloPostor",
              (SELECT COALESCE(json_agg(s ORDER BY s.mes), '[]') FROM (
                 SELECT to_char(date_trunc('month', f), 'YYYY-MM') AS mes, count(DISTINCT codigo)::int AS procesos, COALESCE(sum(adj), 0)::float AS monto
                   FROM a GROUP BY 1) s) AS serie,
              (SELECT COALESCE(json_agg(t ORDER BY t.monto DESC NULLS LAST), '[]') FROM (
                 SELECT entidad_ruc AS ruc, max(entidad) AS nombre, count(DISTINCT codigo)::int AS procesos, sum(adj)::float AS monto
                   FROM a GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 10) t) AS compradores,
              (SELECT COALESCE(json_agg(t ORDER BY t.monto DESC NULLS LAST), '[]') FROM (
                 SELECT ruc_proveedor AS ruc, max(proveedor) AS nombre, count(DISTINCT codigo)::int AS procesos, sum(adj)::float AS monto
                   FROM a WHERE ruc_proveedor ~ ${RUC20} GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 10) t) AS ganadores_top,
              (SELECT COALESCE(json_agg(t ORDER BY t.procesos DESC), '[]') FROM (
                 SELECT dep AS nombre, count(DISTINCT codigo)::int AS procesos, COALESCE(sum(adj), 0)::float AS monto
                   FROM a WHERE dep IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25) t) AS regiones,
              (SELECT COALESCE(json_agg(t ORDER BY t.fecha DESC), '[]') FROM (
                 SELECT codigo, max(item) AS item, max(entidad) AS entidad, to_char(max(f), 'YYYY-MM-DD') AS fecha, sum(adj)::float AS monto,
                        CASE WHEN bool_and(ruc_proveedor ~ ${RUC20}) THEN max(proveedor) END AS ganador,
                        CASE WHEN bool_and(ruc_proveedor ~ ${RUC20}) THEN max(ruc_proveedor) END AS ruc
                   FROM a GROUP BY codigo ORDER BY max(f) DESC LIMIT 8) t) AS recientes`,
      vals,
    );
    const x = r.rows[0] ?? {};
    const { ganadores_top: ganadoresTop, ...resto } = x as Record<string, unknown>;
    return publicar({ q: p.data.q, palabras, ...resto, ganadoresTop });
  });
  c.header("Cache-Control", CACHE_LARGO);
  return c.json(cuerpo);
});
