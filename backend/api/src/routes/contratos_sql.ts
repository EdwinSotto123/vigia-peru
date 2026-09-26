/**
 * SQL de contratos ANTERIOR a los modelos de lectura (migración 35): expresiones CASE de riesgo,
 * estado y estado operativo sobre convocatorias + alertas + procesamientos, y el FROM compartido.
 *
 *   · Lo usa el detalle GET /contratos/:ocid (una fila por PK: sigue siendo barato).
 *   · Es el respaldo de /contratos, /contratos/resumen y /contratos/geo si la API corriera sobre una
 *     base sin la migración 35 (lib/esquema.ts). Con la 35, esas rutas leen contrato_estado,
 *     contratos_agregado y ubigeo_zona (routes/contratos.ts).
 *
 * Columnas de clasificación (migración 13: tipo_contratacion, etapa, modalidad, procesable,
 * motivo_no_procesable, agentes_aplicables, validaciones_pendientes, proveedor_ruc) pueden no
 * existir todavía: `colsDisponibles()` las detecta una vez y las queries las reemplazan por NULL.
 *
 * Alertas y convocatorias se unen por `ocid_corto()` (la alerta guarda el OCID corto).
 */

import { z } from "zod";
import { OCID_CANDIDATOS, pool } from "../lib/db.js";
import { alertaNoDemo, convocatoriaNoDemo } from "../lib/publicacion.js";
import { Memo } from "../lib/cache.js";
import { fechaIso } from "../lib/http.js";

/** Score público de la alerta unida como `a`: solo si está publicada (lib/publicacion.ts §2). */
export const SCORE_PUBLICO = `CASE WHEN alerta_publicada(a.estado) THEN a.score END`;

/** Lo que leyeron los agentes del expediente (analisis_full): postores con oferta, ítems con precio, citas con página. */
export const EXPEDIENTE_SQL = `SELECT
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
export type ColClasif = (typeof COLS_CLASIFICACION)[number];

let colsCache: Set<string> | null = null;
let colsCacheAt = 0;

/** Columnas realmente presentes en `convocatorias`. Se consulta una vez (re-chequea cada 5 min si faltan). */
export async function colsDisponibles(): Promise<Set<string>> {
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
export function col(cols: Set<string>, name: ColClasif, tipo = "text"): string {
  return cols.has(name) ? `c.${name}` : `NULL::${tipo}`;
}

// Mapa de `categoria` (goods|services|works) → tipo de §1 mientras no exista tipo_contratacion.
export const TIPO_FALLBACK = `CASE c.categoria WHEN 'goods' THEN 'bienes' WHEN 'services' THEN 'servicios' WHEN 'works' THEN 'obras' ELSE NULL END`;

export interface Exprs {
  tipo: string; etapa: string; modalidad: string; procesable: string; motivo: string;
  agentes: string; validaciones: string; proveedorRuc: string; proveedorNombre: string;
  estadoProc: string; riesgo: string; operativo: string;
}

// Migración 19: alcance activo (tipos × etapas) leído de `ajustes` una vez por minuto e inlineado
// en la SQL como literales validados — la función estado_operativo() por fila costaba ~6 ms × 18 k.
export const TIPOS_OK = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"];
export const ETAPAS_OK = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida"];
// En lib/cache.ts para que un cambio de alcance desde el panel admin la vacíe al instante.
const alcanceMemo = new Memo<{ tipos: string[]; etapas: string[] }>({ nombre: "alcance:contratos", ttlMs: 60_000 });
export function alcanceActivo(): Promise<{ tipos: string[]; etapas: string[] }> {
  return alcanceMemo.obtener("alcance", async () => {
    let tipos = TIPOS_OK, etapas = ETAPAS_OK;
    try {
      const r = await pool.query("SELECT valor FROM ajustes WHERE clave = 'procesamiento'");
      const v = r.rows[0]?.valor;
      if (v && Array.isArray(v.tipos_activos) && Array.isArray(v.etapas_activas)) {
        tipos = v.tipos_activos.filter((x: unknown) => typeof x === "string" && TIPOS_OK.includes(x));
        etapas = v.etapas_activas.filter((x: unknown) => typeof x === "string" && ETAPAS_OK.includes(x));
      }
    } catch { /* sin la tabla/fila → todo activo (comportamiento anterior) */ }
    return { tipos, etapas };
  });
}
const sqlArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x}'`).join(",")}]::text[]`;

export function exprs(cols: Set<string>, alcance?: { tipos: string[]; etapas: string[] }): Exprs {
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
    // alto/medio/bajo = señales PUBLICADAS. Una alerta en revisión humana o descartada va a su propio
    // balde: si no, su score (no publicado) inflaba "Señal alta" en la landing y en /app/contratos.
    riesgo: `CASE WHEN a.score IS NULL THEN 'sin_analizar'
                  WHEN a.estado = 'revision' THEN 'en_revision'
                  WHEN NOT alerta_publicada(a.estado) THEN 'descartado'
                  WHEN a.score >= 70 THEN 'alto' WHEN a.score >= 40 THEN 'medio' ELSE 'bajo' END`,
  };
}

export const TIPOS = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"] as const;
export const ETAPAS = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida"] as const;
export const RIESGOS = ["alto", "medio", "bajo", "sin_analizar", "en_revision", "descartado"] as const;

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(120).optional(),
  tipo: z.enum(TIPOS).optional(),
  etapa: z.enum(ETAPAS).optional(),
  ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  entidad: z.string().regex(/^\d{11}$/).optional(),
  monto_min: z.coerce.number().min(0).optional(),
  monto_max: z.coerce.number().min(0).optional(),
  // YYYY-MM-DD, sobre fecha_convocatoria — el filtro de mes del mapa/lista manda el primer y
  // último día del mes elegido (o "desde" solo, para "últimos N meses").
  desde: fechaIso().optional(),
  hasta: fechaIso().optional(),
  riesgo: z.enum(RIESGOS).optional(),
  estado: z.enum(["sin_analizar", "pendiente_de_procesamiento", "encolado", "procesando", "procesado", "error"]).optional(),
  operativo: z.enum(["en_cola", "documentos_listos", "sin_documentos"]).optional(),
  orden: z.enum(["fecha", "monto", "score"]).default("fecha"),
});

/** Condiciones WHERE compartidas por /contratos, /contratos/geo y /contratos/resumen. Los alias
 *  c/cz/a/p/e deben existir en el FROM. `excluir` salta una condición (facetas: el conteo de
 *  "tipo" no debe filtrarse por el propio tipo elegido, para poder mostrar las otras opciones). */
export function buildWhere(q: z.infer<typeof ListQuery>, ex: Exprs, vals: unknown[], excluir?: Set<string>): string[] {
  // Siempre: fuera la convocatoria sembrada de demo (lib/publicacion.ts).
  const w: string[] = [convocatoriaNoDemo("c")];
  const salta = (k: string) => excluir?.has(k) ?? false;
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (q.q && !salta("q")) {
    if (/^[\w-]+$/.test(q.q) && /\d/.test(q.q)) {
      // Código/OCID: igualdad por forma corta o larga.
      const p = add(q.q);
      w.push(`((c.ocid = ANY(${OCID_CANDIDATOS(p)}) AND ocid_corto(c.ocid) = ocid_corto(${p})) OR c.codigo = ${p})`);
    } else {
      const p = add(q.q);
      const like = add(`%${q.q.toLowerCase()}%`);
      w.push(`(c.texto_busqueda @@ websearch_to_tsquery('spanish', ${p})
               OR immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent(${like}))`);
    }
  }
  if (q.tipo && !salta("tipo")) w.push(`${ex.tipo} = ${add(q.tipo)}`);
  if (q.etapa && !salta("etapa")) w.push(`${ex.etapa} = ${add(q.etapa)}`);
  if (q.ubigeo && !salta("ubigeo")) w.push(`cz.ubigeo LIKE ${add(q.ubigeo)} || '%'`);
  if (q.entidad && !salta("entidad")) w.push(`c.entidad_ruc = ${add(q.entidad)}`);
  if (q.monto_min != null && !salta("monto")) w.push(`c.cuantia_referencial >= ${add(q.monto_min)}`);
  if (q.monto_max != null && !salta("monto")) w.push(`c.cuantia_referencial <= ${add(q.monto_max)}`);
  if (q.desde && !salta("fecha")) w.push(`c.fecha_convocatoria >= ${add(q.desde)}::date`);
  if (q.hasta && !salta("fecha")) w.push(`c.fecha_convocatoria < (${add(q.hasta)}::date + interval '1 day')`);
  if (q.riesgo && !salta("riesgo")) w.push(`${ex.riesgo} = ${add(q.riesgo)}`);
  if (q.estado && !salta("estado")) w.push(`${ex.estadoProc} = ${add(q.estado)}`);
  if (q.operativo && !salta("operativo")) w.push(`${ex.operativo} = ${add(q.operativo)}`);
  return w;
}

// Alerta de cada convocatoria: la más reciente, sin semillas de demo. El desempate por `a.id` hace que
// las dos formas de abajo elijan SIEMPRE la misma fila.
//  · ALERTA_POR_OCID: una fila por OCID corto, unida por hash. Para lo que recorre las ~18 k
//    convocatorias (lista, facetas, mapa): el LATERAL hacía 18 k búsquedas (~70 ms por consulta).
//  · ALERTA_LATERAL: búsqueda por índice para UNA convocatoria (detalle, filas de la página).
export const ALERTA_ORDEN = `a.analizado_en DESC NULLS LAST, a.created_at DESC, a.id`;
export const ALERTA_POR_OCID = `LEFT JOIN (
    SELECT DISTINCT ON (ocid_corto(a.ocid)) ocid_corto(a.ocid) AS ocid_c, a.id, a.codigo, a.score, a.estado FROM alertas a
    WHERE a.ocid IS NOT NULL AND ${alertaNoDemo("a")}
    ORDER BY ocid_corto(a.ocid), ${ALERTA_ORDEN}) a ON a.ocid_c = ocid_corto(c.ocid)`;
export const ALERTA_LATERAL = `LEFT JOIN LATERAL (
    SELECT a.id, a.codigo, a.score, a.estado FROM alertas a
    WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto(c.ocid) AND ${alertaNoDemo("a")}
    ORDER BY ${ALERTA_ORDEN} LIMIT 1) a ON TRUE`;

// FROM base: convocatoria + zona + alerta (una, la más reciente) + procesamiento + entidad.
const fromBase = (alerta: string) => `
  FROM convocatorias c
  LEFT JOIN convocatoria_zona cz ON cz.ocid = c.ocid
  ${alerta}
  LEFT JOIN procesamientos p ON p.ocid = c.ocid
  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc`;
export const FROM_BASE = fromBase(ALERTA_POR_OCID);   // recorridos y agregados
export const FROM_FILA = fromBase(ALERTA_LATERAL);    // una convocatoria


export function selectResumen(ex: Exprs): string {
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
    ${SCORE_PUBLICO} AS score,
    CASE WHEN a.id IS NULL OR alerta_publicada(a.estado) THEN COALESCE(b.n, 0)::int END AS banderas,
    COALESCE(a.estado = 'revision', false) AS "enRevision",
    ${ex.proveedorNombre} AS proveedor, ${ex.proveedorRuc} AS "proveedorRuc"`;
}

export const JOIN_RESUMEN = `
  LEFT JOIN zonas z ON z.ubigeo = cz.ubigeo::text
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM banderas b WHERE b.alerta_id = a.id) b ON TRUE`;


// ─── Respaldo sin la migración 35: la misma SQL de antes, tal cual ───────────

/** GET /contratos (offset + count(*) OVER()). */
export async function listaAnterior(q: z.infer<typeof ListQuery>) {
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const vals: unknown[] = [];
  const w = buildWhere(q, ex, vals);
  const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
  const order = q.orden === "monto"
    ? `c.cuantia_referencial DESC NULLS LAST, c.fecha_convocatoria DESC NULLS LAST`
    : q.orden === "score"
      ? `${SCORE_PUBLICO} DESC NULLS LAST, c.fecha_convocatoria DESC NULLS LAST`
      : `c.fecha_convocatoria DESC NULLS LAST, c.created_at DESC`;
  vals.push(q.size, (q.page - 1) * q.size);
  const emp = cols.has("proveedor_ruc")
    ? `LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc`
    : `LEFT JOIN empresas emp ON emp.ruc = NULLIF(regexp_replace(c.ocds_payload->'awards'->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')`;
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
     ${ALERTA_LATERAL}
     LEFT JOIN procesamientos p ON p.ocid = c.ocid
     LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
     ${emp}
     ${JOIN_RESUMEN}
     ORDER BY ${order}, c.ocid`,
    vals,
  );
  let total: number = r.rows[0]?.total ?? 0;
  if (!r.rows.length && q.page > 1) {
    const t = await pool.query(`SELECT count(*)::int AS n ${FROM_BASE} ${where}`, vals.slice(0, -2));
    total = t.rows[0]?.n ?? 0;
  }
  const data = r.rows.map(({ total: _t, ...row }) => row);
  return { data, total, page: q.page, size: q.size };
}

type Faceta = "tipo" | "operativo" | "riesgo";

/** Cubo tipo × operativo × riesgo con todos los filtros MENOS esas tres facetas (GET /contratos/resumen). */
export async function cuboAnterior(q: z.infer<typeof ListQuery>): Promise<(Record<Faceta, string | null> & { n: number })[]> {
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const vals: unknown[] = [];
  const w = buildWhere(q, ex, vals, new Set<string>(["tipo", "operativo", "riesgo", "estado"]));
  const r = await pool.query(
    `SELECT ${ex.tipo} AS tipo, ${ex.operativo} AS operativo, ${ex.riesgo} AS riesgo, count(*)::int AS n
     ${FROM_BASE} WHERE ${w.join(" AND ")} GROUP BY 1, 2, 3`, vals);
  return r.rows;
}

/** GET /contratos/geo con la SQL de antes. */
export async function geoAnterior(q: z.infer<typeof ListQuery>, len: number) {
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const vals: unknown[] = [];
  const w = buildWhere(q, ex, vals);
  w.push(`cz.ubigeo IS NOT NULL`);
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
  return r.rows;
}
