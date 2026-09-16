/**
 * Contratos (convocatorias SEACE) — lista paginada, agregado geográfico y detalle.
 * Plan: docs/superpowers/plans/2026-09-15-seace-escala.md · Workstream F
 *
 *   GET /contratos?page=1&size=50&q=&tipo=&etapa=&ubigeo=15&entidad=<ruc>&monto_min=&monto_max=
 *                 &riesgo=alto|medio|bajo|sin_analizar&orden=fecha|monto|score
 *       → { data: ContratoResumen[], total, page, size }
 *   GET /contratos/geo?nivel=distrito|provincia|departamento&ubigeo=15&tipo=&etapa=&riesgo=
 *       → { data: { ubigeo, nombre, nivel, lat, lon, total, sinAnalizar, procesados, conSenales, enCola, documentosListos, enRevision }[] }
 *         (enCola / documentosListos = estado operativo de la migración 19 sobre lo aún sin analizar; conSenales solo cuenta alertas publicadas)
 *   GET /contratos/:ocid
 *       → ContratoResumen & { items, documentos, alerta, procesamiento, clasificacion }
 *
 * Columnas de clasificación (migración 13: tipo_contratacion, etapa, modalidad, procesable,
 * motivo_no_procesable, agentes_aplicables, validaciones_pendientes, proveedor_ruc) pueden no
 * existir todavía: `colsDisponibles()` las detecta una vez y las queries las reemplazan por NULL.
 *
 * Alertas y convocatorias se unen por `ocid_corto()` (la alerta guarda el OCID corto).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { RESULTADO_SQL } from "./procesamientos.js";
import { signReadUrl } from "../lib/storage.js";

export const contratosRouter = new Hono();

const cache = (c: Context, s: number) => c.header("Cache-Control", `public, s-maxage=${s}, stale-while-revalidate=30`);

/** Lo que leyeron los agentes del expediente (analisis_full): postores con oferta, ítems con precio, citas con página. */
const EXPEDIENTE_SQL = `SELECT
  COALESCE(a.analisis_full->'document_analysis'->'postores_consolidados', '[]'::jsonb) AS postores,
  COALESCE(a.analisis_full->'document_analysis'->'items_consolidados', '[]'::jsonb) AS items,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('sha256', d->>'sha256', 'url', d->>'url', 'titulo', d->>'titulo')), '[]'::jsonb)
     FROM jsonb_array_elements(COALESCE(a.analisis_full->'document_analysis'->'documentos', '[]'::jsonb)) d) AS documentos,
  COALESCE(a.analisis_full->'legal_analysis'->'red_flags_documentales', '[]'::jsonb) AS "redFlags",
  COALESCE(a.analisis_full->'legal_analysis'->'evidencia', '[]'::jsonb) AS "legalEvidencia"
  FROM alertas a WHERE a.id = $1`;

// ─── Columnas opcionales (migración 13) ──────────────────────────────────────
const COLS_CLASIFICACION = [
  "tipo_contratacion", "etapa", "modalidad", "procesable", "motivo_no_procesable",
  "agentes_aplicables", "validaciones_pendientes", "proveedor_ruc", "clasificado_at",
] as const;
type ColClasif = (typeof COLS_CLASIFICACION)[number];

let colsCache: Set<string> | null = null;
let colsCacheAt = 0;

/** Columnas realmente presentes en `convocatorias`. Se consulta una vez (re-chequea cada 5 min si faltan). */
async function colsDisponibles(): Promise<Set<string>> {
  const faltan = colsCache ? COLS_CLASIFICACION.some((c) => !colsCache!.has(c)) : true;
  if (colsCache && (!faltan || Date.now() - colsCacheAt < 5 * 60_000)) return colsCache;
  try {
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'convocatorias'`);
    colsCache = new Set(r.rows.map((x) => x.column_name));
  } catch (e) {
    console.error("[contratos] no pude leer information_schema:", (e as Error).message);
    colsCache = colsCache ?? new Set();
  }
  colsCacheAt = Date.now();
  return colsCache;
}

/** Expresión SQL de una columna de clasificación, o NULL tipado si no existe todavía. */
function col(cols: Set<string>, name: ColClasif, tipo = "text"): string {
  return cols.has(name) ? `c.${name}` : `NULL::${tipo}`;
}

// Mapa de `categoria` (goods|services|works) → tipo de §1 mientras no exista tipo_contratacion.
const TIPO_FALLBACK = `CASE c.categoria WHEN 'goods' THEN 'bienes' WHEN 'services' THEN 'servicios' WHEN 'works' THEN 'obras' ELSE NULL END`;

interface Exprs {
  tipo: string; etapa: string; modalidad: string; procesable: string; motivo: string;
  agentes: string; validaciones: string; proveedorRuc: string; proveedorNombre: string;
  estadoProc: string; riesgo: string; operativo: string;
}

// Migración 19: alcance activo (tipos × etapas) leído de `ajustes` una vez por minuto e inlineado
// en la SQL como literales validados — la función estado_operativo() por fila costaba ~6 ms × 18 k.
const TIPOS_OK = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"];
const ETAPAS_OK = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida"];
let alcanceCache: { at: number; tipos: string[]; etapas: string[] } | null = null;
async function alcanceActivo(): Promise<{ tipos: string[]; etapas: string[] }> {
  if (alcanceCache && Date.now() - alcanceCache.at < 60_000) return alcanceCache;
  let tipos = TIPOS_OK, etapas = ETAPAS_OK;
  try {
    const r = await pool.query("SELECT valor FROM ajustes WHERE clave = 'procesamiento'");
    const v = r.rows[0]?.valor;
    if (v && Array.isArray(v.tipos_activos) && Array.isArray(v.etapas_activas)) {
      tipos = v.tipos_activos.filter((x: unknown) => typeof x === "string" && TIPOS_OK.includes(x));
      etapas = v.etapas_activas.filter((x: unknown) => typeof x === "string" && ETAPAS_OK.includes(x));
    }
  } catch { /* sin la tabla/fila → todo activo (comportamiento anterior) */ }
  alcanceCache = { at: Date.now(), tipos, etapas };
  return alcanceCache;
}
const sqlArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x}'`).join(",")}]::text[]`;

function exprs(cols: Set<string>, alcance?: { tipos: string[]; etapas: string[] }): Exprs {
  const supplier = `c.ocds_payload->'awards'->0->'suppliers'->0`;
  const proveedorRuc = cols.has("proveedor_ruc")
    ? `COALESCE(c.proveedor_ruc::text, NULLIF(regexp_replace(${supplier}->>'id', '^PE-RUC-', ''), ''))`
    : `NULLIF(regexp_replace(${supplier}->>'id', '^PE-RUC-', ''), '')`;
  return {
    tipo: cols.has("tipo_contratacion") ? `COALESCE(c.tipo_contratacion, ${TIPO_FALLBACK})` : TIPO_FALLBACK,
    etapa: col(cols, "etapa"),
    modalidad: cols.has("modalidad")
      ? `COALESCE(c.modalidad, c.ocds_payload->'tender'->>'procurementMethodDetails')`
      : `c.ocds_payload->'tender'->>'procurementMethodDetails'`,
    procesable: col(cols, "procesable", "boolean"),
    motivo: col(cols, "motivo_no_procesable"),
    agentes: col(cols, "agentes_aplicables", "text[]"),
    validaciones: col(cols, "validaciones_pendientes", "text[]"),
    proveedorRuc,
    proveedorNombre: `COALESCE(emp.razon_social, ${supplier}->>'name')`,
    // p = procesamientos (cola financiada) · a = alertas (también las del análisis a demanda del admin)
    estadoProc: `CASE WHEN p.estado IS NOT NULL THEN p.estado
                      WHEN a.id IS NOT NULL THEN 'procesado'
                      WHEN ${col(cols, "procesable", "boolean")} = false THEN 'pendiente_de_procesamiento'
                      ELSE 'sin_analizar' END`,
    // Migración 19: en_cola (tipo/etapa activos) · documentos_listos (docs en GCS, análisis aún no activo) · sin_documentos
    operativo: cols.has("tipo_contratacion") && alcance
      ? `CASE WHEN c.tipo_contratacion = ANY(${sqlArray(alcance.tipos)}) AND c.etapa = ANY(${sqlArray(alcance.etapas)}) THEN 'en_cola'
              WHEN EXISTS (SELECT 1 FROM documentos_gcs d WHERE d.ocid = c.ocid AND d.borrado_at IS NULL AND d.expira_at > now()) THEN 'documentos_listos'
              ELSE 'sin_documentos' END`
      : `'en_cola'`,
    riesgo: `CASE WHEN a.score IS NULL THEN 'sin_analizar' WHEN a.score >= 70 THEN 'alto' WHEN a.score >= 40 THEN 'medio' ELSE 'bajo' END`,
  };
}

const TIPOS = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"] as const;
const ETAPAS = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida"] as const;
const RIESGOS = ["alto", "medio", "bajo", "sin_analizar"] as const;

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(120).optional(),
  tipo: z.enum(TIPOS).optional(),
  etapa: z.enum(ETAPAS).optional(),
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  monto_min: z.coerce.number().min(0).optional(),
  monto_max: z.coerce.number().min(0).optional(),
  riesgo: z.enum(RIESGOS).optional(),
  estado: z.enum(["sin_analizar", "pendiente_de_procesamiento", "encolado", "procesando", "procesado", "error"]).optional(),
  operativo: z.enum(["en_cola", "documentos_listos", "sin_documentos"]).optional(),
  orden: z.enum(["fecha", "monto", "score"]).default("fecha"),
});

/** Condiciones WHERE compartidas por /contratos y /contratos/geo. Los alias c/cz/a/p/e deben existir en el FROM. */
function buildWhere(q: z.infer<typeof ListQuery>, ex: Exprs, vals: unknown[]): string[] {
  const w: string[] = [];
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (q.q) {
    if (/^[\w-]+$/.test(q.q) && /\d/.test(q.q)) {
      // Código/OCID: igualdad por forma corta o larga.
      const p = add(q.q);
      w.push(`(ocid_corto(c.ocid) = ocid_corto(${p}) OR c.codigo = ${p})`);
    } else {
      const p = add(q.q);
      const like = add(`%${q.q.toLowerCase()}%`);
      w.push(`(c.texto_busqueda @@ websearch_to_tsquery('spanish', ${p})
               OR immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent(${like}))`);
    }
  }
  if (q.tipo) w.push(`${ex.tipo} = ${add(q.tipo)}`);
  if (q.etapa) w.push(`${ex.etapa} = ${add(q.etapa)}`);
  if (q.ubigeo) w.push(`cz.ubigeo LIKE ${add(q.ubigeo)} || '%'`);
  if (q.entidad) w.push(`c.entidad_ruc = ${add(q.entidad)}`);
  if (q.monto_min != null) w.push(`c.cuantia_referencial >= ${add(q.monto_min)}`);
  if (q.monto_max != null) w.push(`c.cuantia_referencial <= ${add(q.monto_max)}`);
  if (q.riesgo) w.push(`${ex.riesgo} = ${add(q.riesgo)}`);
  if (q.estado) w.push(`${ex.estadoProc} = ${add(q.estado)}`);
  if (q.operativo) w.push(`${ex.operativo} = ${add(q.operativo)}`);
  return w;
}

// FROM base: convocatoria + zona + alerta (una, la más reciente) + procesamiento + entidad.
const FROM_BASE = `
  FROM convocatorias c
  LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid
  LEFT JOIN LATERAL (
    SELECT a.id, a.codigo, a.score, a.estado FROM alertas a
    WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto(c.ocid)
    ORDER BY a.analizado_en DESC NULLS LAST, a.created_at DESC LIMIT 1) a ON TRUE
  LEFT JOIN procesamientos p ON p.ocid = c.ocid
  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc`;

function selectResumen(ex: Exprs): string {
  return `
    c.ocid, c.codigo, c.objeto AS titulo, e.nombre AS entidad, c.entidad_ruc::text AS "entidadRuc",
    ${ex.tipo} AS tipo, ${ex.etapa} AS etapa, ${ex.modalidad} AS modalidad,
    c.cuantia_referencial::float AS "montoPen",
    COALESCE(c.ocds_payload->'tender'->'value'->>'currency', 'PEN') AS moneda,
    to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha,
    cz.ubigeo::text AS ubigeo, z.nombre AS zona, z.lat::float AS lat, z.lon::float AS lon,
    ${ex.procesable} AS procesable,
    ${ex.estadoProc} AS "estadoProcesamiento",
    ${ex.operativo} AS "estadoOperativo",
    a.score, COALESCE(b.n, 0)::int AS banderas,
    ${ex.proveedorNombre} AS proveedor, ${ex.proveedorRuc} AS "proveedorRuc"`;
}

const JOIN_RESUMEN = `
  LEFT JOIN zonas z ON z.ubigeo = cz.ubigeo::text
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM banderas b WHERE b.alerta_id = a.id) b ON TRUE`;

// ─── GET /contratos ──────────────────────────────────────────────────────────
contratosRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const vals: unknown[] = [];
  const w = buildWhere(q, ex, vals);
  const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
  const order = q.orden === "monto"
    ? `c.cuantia_referencial DESC NULLS LAST, c.fecha_convocatoria DESC NULLS LAST`
    : q.orden === "score"
      ? `a.score DESC NULLS LAST, c.fecha_convocatoria DESC NULLS LAST`
      : `c.fecha_convocatoria DESC NULLS LAST, c.created_at DESC`;
  vals.push(q.size, (q.page - 1) * q.size);
  const emp = cols.has("proveedor_ruc")
    ? `LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc`
    : `LEFT JOIN empresas emp ON emp.ruc = NULLIF(regexp_replace(c.ocds_payload->'awards'->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')`;

  // 1) filtrar/ordenar/paginar sobre lo mínimo (total con count(*) OVER());
  // 2) enriquecer solo la página (zona, banderas, proveedor).
  const r = await pool.query(
    `WITH pag AS (
       SELECT c.ocid, (count(*) OVER())::int AS total
       ${FROM_BASE}
       ${where}
       ORDER BY ${order}, c.ocid
       LIMIT $${vals.length - 1} OFFSET $${vals.length})
     SELECT ${selectResumen(ex)}, pag.total
     FROM pag JOIN convocatorias c ON c.ocid = pag.ocid
     LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid
     LEFT JOIN LATERAL (
       SELECT a.id, a.codigo, a.score, a.estado FROM alertas a
       WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto(c.ocid)
       ORDER BY a.analizado_en DESC NULLS LAST, a.created_at DESC LIMIT 1) a ON TRUE
     LEFT JOIN procesamientos p ON p.ocid = c.ocid
     LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
     ${emp}
     ${JOIN_RESUMEN}
     ORDER BY ${order}, c.ocid`,
    vals,
  );
  const total: number = r.rows[0]?.total ?? (q.page === 1 ? 0 : await contar(where, vals.slice(0, -2)));
  const data = r.rows.map(({ total: _t, ...row }) => row);
  cache(c, 60);
  return c.json({ data, total, page: q.page, size: q.size });
});

/** Total cuando la página pedida está fuera de rango (no hay filas → no hay count(*) OVER()). */
async function contar(where: string, vals: unknown[]): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int AS n ${FROM_BASE} ${where}`, vals);
  return r.rows[0]?.n ?? 0;
}

// ─── GET /contratos/geo ──────────────────────────────────────────────────────
const GeoQuery = ListQuery.pick({ tipo: true, etapa: true, riesgo: true, ubigeo: true, entidad: true, q: true }).extend({
  nivel: z.enum(["distrito", "provincia", "departamento"]).default("distrito"),
});

contratosRouter.get("/geo", async (c) => {
  const parsed = GeoQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const vals: unknown[] = [];
  const w = buildWhere({ ...q, page: 1, size: 1, orden: "fecha" }, ex, vals);
  w.push(`cz.ubigeo IS NOT NULL`);
  const len = q.nivel === "distrito" ? 6 : q.nivel === "provincia" ? 4 : 2;
  vals.push(len);
  const r = await pool.query(
    `WITH agg AS (
       SELECT left(cz.ubigeo::text, $${vals.length}) AS ubigeo,
              count(*)::int AS total,
              count(*) FILTER (WHERE ${ex.estadoProc} = 'sin_analizar')::int AS "sinAnalizar",
              count(*) FILTER (WHERE ${ex.estadoProc} = 'pendiente_de_procesamiento')::int AS pendientes,
              count(*) FILTER (WHERE ${ex.estadoProc} IN ('encolado','procesando'))::int AS "enProceso",
              count(*) FILTER (WHERE ${ex.estadoProc} = 'procesado')::int AS procesados,
              count(*) FILTER (WHERE a.score >= 40 AND alerta_publicada(a.estado))::int AS "conSenales",
              count(*) FILTER (WHERE ${ex.estadoProc} = 'sin_analizar' AND ${ex.operativo} = 'en_cola')::int AS "enCola",
              count(*) FILTER (WHERE ${ex.estadoProc} = 'sin_analizar' AND ${ex.operativo} = 'documentos_listos')::int AS "documentosListos",
              count(*) FILTER (WHERE a.estado = 'revision')::int AS "enRevision",
              COALESCE(sum(c.cuantia_referencial), 0)::float AS "montoPen"
       ${FROM_BASE}
       WHERE ${w.join(" AND ")}
       GROUP BY 1)
     SELECT agg.ubigeo, z.nombre, z.nivel, z.lat::float AS lat, z.lon::float AS lon,
            agg.total, agg."sinAnalizar", agg.pendientes, agg."enProceso", agg.procesados, agg."conSenales",
            agg."enCola", agg."documentosListos", agg."enRevision", agg."montoPen"
     FROM agg JOIN zonas z ON z.ubigeo = agg.ubigeo
     WHERE z.lat IS NOT NULL AND z.lon IS NOT NULL
     ORDER BY agg.total DESC`,
    vals,
  );
  cache(c, 300);
  return c.json({ nivel: q.nivel, data: r.rows });
});

// ─── GET /contratos/:ocid ────────────────────────────────────────────────────
// URL firmada (15 min) para ver/descargar un documento guardado en el almacén de Vigía.
//   GET /contratos/:ocid/documento?url=<url_origen SEACE>
contratosRouter.get("/:ocid/documento", async (c) => {
  const ocid = c.req.param("ocid");
  const url = c.req.query("url") ?? "";
  if (!url) return c.json({ error: "falta url" }, 400);
  const r = await pool.query(
    `SELECT d.url_gcs AS "urlGcs", d.formato, d.titulo, d.bytes, d.expira_at AS "expiraAt"
     FROM documentos_gcs d
     WHERE ocid_corto(d.ocid) = ocid_corto($1) AND d.url_origen = $2 AND d.borrado_at IS NULL AND d.expira_at > now()
     ORDER BY d.creado_at DESC LIMIT 1`, [ocid, url]).catch(() => ({ rows: [] as any[] }));
  const d = r.rows[0];
  if (!d) return c.json({ error: "no_disponible", detail: "El documento no está en el almacén de Vigía (se descarga al financiar el análisis)." }, 404);
  const mime: Record<string, string> = { pdf: "application/pdf", zip: "application/zip", rar: "application/vnd.rar", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const formato = String(d.formato ?? "").toLowerCase();
  const nombre = `${ocid}-${(d.titulo ?? "documento").replace(/[^\w.-]+/g, "_").slice(0, 80)}.${formato || "bin"}`;
  const firmada = await signReadUrl(d.urlGcs, { filename: nombre, contentType: mime[formato] });
  c.header("Cache-Control", "private, no-store");
  return c.json({ url: firmada, formato, bytes: d.bytes, expiraAt: d.expiraAt, previsualizable: formato === "pdf", venceEnSeg: 900 });
});

contratosRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const emp = cols.has("proveedor_ruc")
    ? `LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc`
    : `LEFT JOIN empresas emp ON emp.ruc = NULLIF(regexp_replace(c.ocds_payload->'awards'->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')`;
  const r = await pool.query(
    `SELECT ${selectResumen(ex)},
            to_char(c.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro",
            c.tipo_proceso AS "tipoProceso", c.fuente_financiamiento AS "fuenteFinanciamiento",
            c.ocds_payload->'tender'->>'title' AS "nomenclatura",
            c.ocds_payload->'tender'->>'description' AS descripcion,
            (c.ocds_payload->'tender'->>'numberOfTenderers')::int AS "postores",
            COALESCE(c.ocds_payload->'tender'->'items', c.ocds_payload->'awards'->0->'items', '[]'::jsonb) AS items_raw,
            -- documentos de tender + awards + contracts (el record completo trae los tres niveles)
            (SELECT COALESCE(jsonb_agg(d || jsonb_build_object('seccion', s)), '[]'::jsonb) FROM (
               SELECT d, 'tender' AS s FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'award' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) a,
                                             jsonb_array_elements(COALESCE(a->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'contract' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'contracts', '[]'::jsonb)) k,
                                                jsonb_array_elements(COALESCE(k->'documents', '[]'::jsonb)) d) x) AS docs_raw,
            c.ocds_payload->'awards' AS awards_raw,
            a.id AS alerta_id, a.codigo AS "alertaCodigo",
            ${ex.motivo} AS "motivoNoProcesable", ${ex.agentes} AS "agentesAplicables", ${ex.validaciones} AS "validacionesPendientes",
            ${col(cols, "clasificado_at", "timestamptz")} AS "clasificadoAt"
     ${FROM_BASE}
     ${emp}
     ${JOIN_RESUMEN}
     WHERE c.ocid = $1 OR ocid_corto(c.ocid) = ocid_corto($1)
     ORDER BY (c.ocid = $1) DESC LIMIT 1`,
    [ocid],
  );
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  const row = r.rows[0];
  const { items_raw, docs_raw, awards_raw, alerta_id, alertaCodigo, motivoNoProcesable, agentesAplicables, validacionesPendientes, clasificadoAt, ...resumen } = row;

  const [alerta, proc, docsGcs, pedido, expediente] = await Promise.all([
    // Misma forma que `resultado` en /financiamiento/procesamientos/:ocid (señales + mercado + documentos).
    alerta_id ? pool.query(RESULTADO_SQL, [alerta_id]) : Promise.resolve(null),
    pool.query(
      `SELECT ocid, estado, fase_actual AS "faseActual", fase_index AS "faseIndex", iniciado_at AS "iniciadoAt",
              finalizado_at AS "finalizadoAt", intentos, contribucion_codigo AS "contribucionCodigo", financiador,
              financiador_visible AS "financiadorVisible", ubigeo, zona, titulo, entidad, monto_pen::float AS "montoPen",
              alerta_codigo AS "alertaCodigo", score, banderas::int, fases, alerta_estado AS "alertaEstado"
       FROM procesamientos_publico WHERE ocid = $1`, [row.ocid]),
    // Migración 15: documentos vigentes en GCS (retención 90 días) y pedido de descarga abierto.
    pool.query(`SELECT url_origen AS "urlOrigen", url_gcs AS "urlGcs", expira_at AS "expiraAt" FROM documentos_vigentes($1)`, [row.ocid])
      .then((q) => q.rows as { urlOrigen: string; urlGcs: string; expiraAt: string }[]).catch(() => null),
    pool.query(`SELECT estado, solicitado_at AS "solicitadoAt" FROM pedidos_descarga WHERE ocid_corto(ocid) = ocid_corto($1) AND estado IN ('pendiente','descargando') LIMIT 1`, [row.ocid])
      .then((q) => q.rows[0] ?? null).catch(() => null),
    // U5: postores con ofertas, ítems con precio contratado y citas con página (document_analysis / legal_analysis).
    alerta_id ? pool.query(EXPEDIENTE_SQL, [alerta_id]).then((q) => q.rows[0] ?? null).catch(() => null) : Promise.resolve(null),
  ]);

  const items = (Array.isArray(items_raw) ? items_raw : []).map((it: any, i: number) => ({
    id: String(it?.id ?? i + 1),
    posicion: Number(it?.position ?? i + 1),
    descripcion: it?.description ?? it?.classification?.description ?? null,
    cantidad: typeof it?.quantity === "number" ? it.quantity : null,
    unidad: it?.unit?.name ?? null,
    montoPen: typeof it?.totalValue?.amount === "number" ? it.totalValue.amount : null,
    cubso: it?.classification?.scheme === "CUBSO" ? it.classification.id ?? null : null,
    estado: it?.statusDetails ?? it?.status ?? null,
  }));
  const vigentesPorUrl = new Map((docsGcs ?? []).map((v) => [v.urlOrigen, v]));
  const documentos = (Array.isArray(docs_raw) ? docs_raw : [])
    .filter((d: any) => d?.url)
    .map((d: any) => ({
      tipo: d.documentType ?? null,
      titulo: d.title ?? null,
      url: d.url,
      formato: d.format ?? null,
      fecha: d.datePublished ? String(d.datePublished).slice(0, 10) : null,
      seccion: d.seccion ?? "tender",
      // Migración 15: copia vigente en el almacén de Vigía → se puede previsualizar con URL firmada.
      enVigia: vigentesPorUrl.has(d.url),
    }));
  const docsGcsResumen = docsGcs
    ? { n: docsGcs.length, expiraAt: docsGcs.reduce<string | null>((m, v) => (!m || v.expiraAt > m ? v.expiraAt : m), null) }
    : null;
  const adjudicaciones = (Array.isArray(awards_raw) ? awards_raw : []).map((aw: any) => ({
    id: aw?.id ?? null,
    fecha: aw?.date ? String(aw.date).slice(0, 10) : null,
    montoPen: typeof aw?.value?.amount === "number" ? aw.value.amount : null,
    proveedor: aw?.suppliers?.[0]?.name ?? null,
    proveedorRuc: aw?.suppliers?.[0]?.id ? String(aw.suppliers[0].id).replace(/^PE-RUC-/, "") : null,
  }));

  // ── U5: expediente leído por los agentes (postores, ítems con precio, citas con página) ──
  const shaUrl = new Map<string, { url: string; titulo: string | null }>();
  for (const d of (expediente?.documentos ?? []) as any[]) {
    if (d?.sha256 && d?.url) shaUrl.set(String(d.sha256), { url: String(d.url), titulo: d.titulo ?? null });
  }
  const enVigiaUrls = new Set(documentos.filter((d) => d.enVigia).map((d) => d.url));
  const cita = (e: any) => {
    const doc = e?.documento_sha256 ?? e?.documento ?? null;
    const ref = doc ? shaUrl.get(String(doc)) : null;
    return { pagina: typeof e?.pagina === "number" ? e.pagina : null, cita: e?.cita ?? null, documentoUrl: ref?.url ?? null,
             documentoTitulo: ref?.titulo ?? null, enVigia: ref ? enVigiaUrls.has(ref.url) : false, verificada: e?.verificada ?? null };
  };
  // Un postor puede aparecer varias veces (acta de admisión, cuadro comparativo, buena pro): se queda la fila más completa.
  const postoresRaw = ((expediente?.postores ?? []) as any[]).map((p) => ({
    ruc: p?.ruc ?? null, razonSocial: p?.razon_social ?? null, estado: p?.estado ?? null, motivoEstado: p?.motivo_estado ?? null,
    montoOferta: typeof p?.monto_oferta === "number" ? p.monto_oferta : null, puntaje: p?.puntaje ?? null,
    esGanador: p?.es_ganador === true, ordenPrelacion: p?.orden_prelacion ?? null, item: p?.item ?? null,
    citas: (Array.isArray(p?.evidencia) ? p.evidencia : []).slice(0, 3).map(cita),
  }));
  const porClave = new Map<string, (typeof postoresRaw)[number]>();
  for (const p of postoresRaw) {
    const k = (p.ruc ?? "") || String(p.razonSocial ?? "").toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    const prev = porClave.get(k);
    const score = (x: typeof p) => (x.montoOferta != null ? 2 : 0) + (x.esGanador ? 1 : 0) + (x.citas.length ? 1 : 0) + (x.estado ? 1 : 0);
    if (!prev || score(p) > score(prev)) porClave.set(k, prev ? { ...prev, ...p, citas: p.citas.length ? p.citas : prev.citas, esGanador: prev.esGanador || p.esGanador } : p);
  }
  // Segunda pasada: filas sin RUC cuya razón social empieza igual que una con RUC ("CONSORCIO X integrado por…").
  const normRazon = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const conRuc = [...porClave.values()].filter((p) => p.ruc);
  const postores = [...porClave.values()].filter((p) => {
    if (p.ruc) return true;
    const r = normRazon(p.razonSocial);
    const dueno = conRuc.find((q) => { const qr = normRazon(q.razonSocial); return qr.length >= 8 && r.startsWith(qr); });
    if (!dueno) return true;
    if (!dueno.citas.length && p.citas.length) dueno.citas = p.citas;
    dueno.esGanador = dueno.esGanador || p.esGanador;
    return false;
  });
  const itemsAnalizados = ((expediente?.items ?? []) as any[]).map((it, i) => {
    const num = String(it?.numero ?? i + 1);
    const ocds = items.find((x) => x.id === num || String(x.posicion) === num);
    return {
      numero: num, descripcion: it?.descripcion_corta ?? it?.descripcion ?? null, unidad: it?.unidad ?? null,
      cantidad: typeof it?.cantidad === "number" ? it.cantidad : null,
      precioUnitarioOfertado: typeof it?.precio_unitario_ofertado === "number" ? it.precio_unitario_ofertado : null,
      precioUnitarioContratado: typeof it?.precio_unitario_contratado === "number" ? it.precio_unitario_contratado : null,
      // referencia = valor referencial del ítem en OCDS (total) / cantidad, cuando se puede
      referenciaTotal: ocds?.montoPen ?? null,
      referenciaUnitaria: ocds?.montoPen != null && typeof it?.cantidad === "number" && it.cantidad > 0 ? ocds.montoPen / it.cantidad : null,
      marca: it?.marca_ofertada ?? null, origenPrecio: it?.origen_precio ?? null,
      citas: (Array.isArray(it?.evidencia) ? it.evidencia : []).slice(0, 2).map(cita),
    };
  });
  // Señales del análisis legal → páginas citadas (se emparejan por el texto de la evidencia/descripción).
  const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  const redFlags = ((expediente?.redFlags ?? []) as any[]).map((f) => ({ desc: norm(f?.descripcion), citas: (Array.isArray(f?.evidencia) ? f.evidencia : []).map(cita) }));
  const legalEvid = ((expediente?.legalEvidencia ?? []) as any[]).map(cita);
  const alertaRow = alerta?.rows[0] ?? null;
  if (alertaRow && Array.isArray(alertaRow.banderas)) {
    alertaRow.banderas = alertaRow.banderas.map((b: any) => {
      const ev = norm(b?.evidencia);
      const rf = ev ? redFlags.find((f) => f.desc && (ev.startsWith(f.desc.slice(0, 60)) || f.desc.startsWith(ev.slice(0, 60)))) : null;
      const citas = rf?.citas?.length ? rf.citas : (b?.regla === "objeto_no_corresponde_documento" ? legalEvid.slice(0, 2) : []);
      return { ...b, citas: citas.filter((x: any) => x.pagina != null || x.documentoUrl) };
    });
  }

  cache(c, 60);
  return c.json({
    ...resumen,
    items,
    documentos,
    adjudicaciones,
    postoresDetalle: postores,
    itemsAnalizados,
    alerta: alertaRow,
    procesamiento: proc.rows[0] ?? null,
    documentosEnVigia: docsGcsResumen,
    pedidoDescarga: pedido,
    clasificacion: {
      tipo: resumen.tipo ?? null,
      etapa: resumen.etapa ?? null,
      modalidad: resumen.modalidad ?? null,
      procesable: resumen.procesable ?? null,
      motivoNoProcesable: motivoNoProcesable ?? null,
      agentesAplicables: agentesAplicables ?? null,
      validacionesPendientes: validacionesPendientes ?? null,
      clasificadoAt: clasificadoAt ?? null,
    },
  });
});
