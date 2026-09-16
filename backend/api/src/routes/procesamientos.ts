/**
 * Procesamiento EN VIVO de los contratos asignados a contribuciones (tablero público).
 * Lee la vista `procesamientos_publico` (migración 12): sin email ni worker.
 *
 *   GET /financiamiento/procesamientos?ubigeo=15&codigo=VIG-2026-00002&estado=procesando&limit=100
 *   GET /financiamiento/procesamientos/resumen        conteo por estado + procesados hoy + activos (fase, segundos)
 *                                                     + lote de ingesta en curso + descargados 24 h + agentes activos
 *   GET /financiamiento/procesamientos/:ocid          detalle + eventos [{ts, kind, name, msg}] + fases + resultado
 *                                                     (score, señales, mercado, documentos leídos) + estimado (mediana)
 *
 * Migración 20: `fases` {fase: {estado: corriendo|hecho|omitido|error, desde, hasta, motivo}} lo escribe el
 * dispatcher (DAG paralelo: varias fases corren a la vez); `alertaEstado` = 'revision' cuando la
 * autoevaluación bloqueó la publicación.
 *
 * Se monta ANTES de /financiamiento para que no lo capture financiamientoRouter.
 * Cache corta (3-10 s): el frontend hace polling.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";

export const procesamientosRouter = new Hono();

const cache = (c: Context, s: number) => c.header("Cache-Control", `public, s-maxage=${s}, stale-while-revalidate=10`);

const COLS = `ocid, estado, fase_actual AS "faseActual", fase_index AS "faseIndex", iniciado_at AS "iniciadoAt",
  finalizado_at AS "finalizadoAt", intentos, contribucion_codigo AS "contribucionCodigo", financiador,
  financiador_visible AS "financiadorVisible", ubigeo, zona, titulo, entidad, monto_pen::float AS "montoPen",
  alerta_codigo AS "alertaCodigo", score, banderas::int, fases, alerta_estado AS "alertaEstado"`;

/** Cuánto suele tardar un análisis (mediana de los procesados en 7 días) para el "estimado" del tablero. */
const ESTIMADO_SQL = `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finalizado_at - iniciado_at)))::int AS "medianaSeg",
  count(*)::int AS n
  FROM procesamientos WHERE estado = 'procesado' AND iniciado_at IS NOT NULL AND finalizado_at > iniciado_at
   AND finalizado_at >= now() - interval '7 days'`;

/**
 * Resumen liviano del análisis para la tarjeta de resultados (sin cargar el dossier):
 * señales con norma/evidencia/verificación, mercado (mediana vs ofertado), documentos leídos,
 * recortes y validaciones pendientes. Todo sale de alertas + banderas + analisis_full.
 */
export const RESULTADO_SQL = `SELECT a.id, a.codigo, a.score, a.estado, a.analizado_en AS "analizadoEn",
  COALESCE((SELECT json_agg(json_build_object('regla', b.regla, 'severidad', b.severidad, 'evidencia', left(b.evidencia, 320),
                                              'norma', b.norma, 'fuenteUrl', b.fuente_url, 'agente', b.agente_origen,
                                              'verificada', (b.verificacion->>'ok')::boolean)
                            ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id)
            FROM banderas b WHERE b.alerta_id = a.id), '[]'::json) AS banderas,
  CASE WHEN jsonb_typeof(a.analisis_full->'market_analysis') = 'object' THEN json_build_object(
    'estado', a.analisis_full->'market_analysis'->>'estado',
    'veredicto', a.analisis_full->'market_analysis'->>'veredicto_global',
    'nItems', (a.analisis_full->'market_analysis'->>'n_items')::int,
    'nConMediana', (a.analisis_full->'market_analysis'->>'n_con_mediana')::int,
    'totalOfertado', (a.analisis_full->'market_analysis'->>'total_ofertado')::float,
    'totalMercado', (a.analisis_full->'market_analysis'->>'total_estimado_mercado')::float,
    'sobreprecioPct', (a.analisis_full->'market_analysis'->>'sobreprecio_pct')::float,
    'items', (SELECT COALESCE(json_agg(json_build_object(
                'item', f->>'item_descripcion', 'unidad', f->>'unidad', 'veredicto', f->>'veredicto',
                'ofertado', (f->>'precio_unitario_ofertado')::float, 'mediana', (f->>'precio_mediana_mercado')::float,
                'diffPct', (f->>'diff_pct')::float, 'nPrecios', (f->>'n_precios')::int)), '[]'::json)
              FROM (SELECT f FROM jsonb_array_elements(COALESCE(a.analisis_full->'market_analysis'->'findings', '[]'::jsonb)) f LIMIT 12) x)
  ) ELSE NULL END AS mercado,
  CASE WHEN jsonb_typeof(a.analisis_full->'document_analysis'->'documentos') = 'array' THEN (
    SELECT json_build_object('n', count(*), 'paginas', COALESCE(sum((d->>'n_paginas')::int), 0),
                             'conError', count(*) FILTER (WHERE d->>'error' IS NOT NULL),
                             'titulos', json_agg(left(d->>'titulo', 60)))
    FROM jsonb_array_elements(a.analisis_full->'document_analysis'->'documentos') d) ELSE NULL END AS documentos,
  CASE WHEN jsonb_typeof(a.analisis_full->'recortes') = 'array' THEN jsonb_array_length(a.analisis_full->'recortes') ELSE 0 END AS recortes,
  CASE WHEN jsonb_typeof(a.analisis_full->'validaciones_pendientes') = 'array' THEN a.analisis_full->'validaciones_pendientes' ELSE '[]'::jsonb END AS "validacionesPendientes",
  a.analisis_full->'self_evals'->'pct' AS autoevaluacion,
  (a.dictamen_markdown IS NOT NULL AND length(a.dictamen_markdown) > 200) AS "dictamenListo"
  FROM alertas a WHERE a.id = $1`;

const ORDER = `ORDER BY CASE estado WHEN 'procesando' THEN 0 WHEN 'encolado' THEN 1 WHEN 'procesado' THEN 2 WHEN 'error' THEN 3 ELSE 4 END,
  COALESCE(finalizado_at, iniciado_at, encolado_at) DESC, ocid`;

const Q = z.object({
  ubigeo: z.string().regex(/^\d{2,6}$/).optional(),
  codigo: z.string().max(20).optional(),
  estado: z.enum(["encolado", "procesando", "procesado", "error", "pendiente_de_procesamiento"]).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});

procesamientosRouter.get("/", async (c) => {
  const p = Q.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { ubigeo, codigo, estado, limit } = p.data;
  const vals: unknown[] = [];
  const w: string[] = [];
  if (ubigeo) { vals.push(ubigeo); w.push(`ubigeo LIKE $${vals.length} || '%'`); }
  if (codigo) { vals.push(codigo.toUpperCase()); w.push(`contribucion_codigo = $${vals.length}`); }
  if (estado) { vals.push(estado); w.push(`estado = $${vals.length}`); }
  vals.push(limit);
  const r = await pool.query(
    `SELECT ${COLS} FROM procesamientos_publico ${w.length ? "WHERE " + w.join(" AND ") : ""} ${ORDER} LIMIT $${vals.length}`,
    vals);
  cache(c, 5);
  return c.json({ data: r.rows });
});

// `lotes_ingesta` la crea la migración 14 (Workstream B). Si aún no existe, `lote` es null.
let lotesTabla: boolean | null = null;
let lotesTablaAt = 0;
async function hayLotesIngesta(): Promise<boolean> {
  if (lotesTabla === true) return true;
  if (lotesTabla === false && Date.now() - lotesTablaAt < 5 * 60_000) return false;
  try {
    const r = await pool.query(`SELECT to_regclass('public.lotes_ingesta') IS NOT NULL AS ok`);
    lotesTabla = !!r.rows[0]?.ok;
  } catch {
    lotesTabla = false;
  }
  lotesTablaAt = Date.now();
  return lotesTabla;
}

procesamientosRouter.get("/resumen", async (c) => {
  const [r, hoy, activos, descargados, procesamientoActivo, documentosListos, pedidos, lote, estimado] = await Promise.all([
    pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`),
    pool.query(`SELECT count(*)::int AS n FROM procesamientos WHERE estado = 'procesado' AND finalizado_at::date = current_date`),
    pool.query(
      `SELECT ocid, fase_actual AS "faseActual", fase_index AS "faseIndex", financiador, zona, titulo, fases,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(iniciado_at, encolado_at))))::int AS "desdeSeg"
       FROM procesamientos_publico WHERE estado = 'procesando' ORDER BY iniciado_at NULLS LAST, ocid LIMIT 24`),
    pool.query(`SELECT count(*)::int AS n FROM convocatorias WHERE created_at >= now() - interval '24 hours'`),
    // Migración 19: qué tipos/etapas se analizan hoy + cuántos contratos tienen documentos listos.
    pool.query(`SELECT valor FROM ajustes WHERE clave = 'procesamiento'`).then((q) => q.rows[0]?.valor ?? null).catch(() => null),
    pool.query(`SELECT count(*) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS n,
                       count(DISTINCT ocid) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS contratos
                FROM documentos_gcs`).then((q) => q.rows[0]).catch(() => null),
    // Migración 15: pedidos de descarga (contratos financiados sin documentos en GCS).
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
                       count(*) FILTER (WHERE estado = 'descargando')::int AS descargando,
                       count(*) FILTER (WHERE estado = 'listo' AND atendido_at >= now() - interval '24 hours')::int AS "listos24h",
                       count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos
                FROM pedidos_descarga`).then((q) => q.rows[0]).catch(() => null),
    (async () => {
      if (!(await hayLotesIngesta())) return null;
      try {
        const q = await pool.query(
          `SELECT id, tipo, estado, total::int, ok::int AS completados, fallidos::int, iniciado_at AS iniciado
           FROM lotes_ingesta WHERE finalizado_at IS NULL
           ORDER BY iniciado_at DESC NULLS LAST LIMIT 1`);
        return q.rows[0] ?? null;
      } catch {
        return null;
      }
    })(),
    pool.query(ESTIMADO_SQL).then((q) => q.rows[0] ?? null).catch(() => null),
  ]);
  const porEstado: Record<string, number> = { encolado: 0, procesando: 0, procesado: 0, error: 0, pendiente_de_procesamiento: 0, esperando_documentos: 0 };
  for (const x of r.rows) porEstado[x.estado] = x.n;
  const agentesActivos = Array.from(new Set(
    activos.rows.map((a) => a.faseActual as string | null).filter((f): f is string => !!f && f !== "started" && f !== "final"),
  ));
  cache(c, 5);
  return c.json({
    porEstado,
    procesadosHoy: hoy.rows[0].n,
    activos: activos.rows,
    lote,
    descargados24h: descargados.rows[0].n,
    procesamientoActivo,
    documentosListos,
    pedidos,
    agentesActivos,
    estimado,
  });
});

procesamientosRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  const r = await pool.query(
    `SELECT ${COLS}, alerta_id AS "alertaId", (SELECT p.eventos FROM procesamientos p WHERE p.ocid = v.ocid) AS eventos
     FROM procesamientos_publico v WHERE ocid = $1`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  const { alertaId, ...row } = r.rows[0];
  const [resultado, estimado] = await Promise.all([
    alertaId && row.estado === "procesado"
      ? pool.query(RESULTADO_SQL, [alertaId]).then((q) => q.rows[0] ?? null).catch(() => null)
      : Promise.resolve(null),
    row.estado === "procesando" || row.estado === "encolado"
      ? pool.query(ESTIMADO_SQL).then((q) => q.rows[0] ?? null).catch(() => null)
      : Promise.resolve(null),
  ]);
  // Motivo de la revisión humana: lo dejó la autoevaluación como warn en la bitácora.
  let revisionMotivo: string | null = null;
  if (resultado?.estado === "revision") {
    const ev = (Array.isArray(row.eventos) ? row.eventos : []).find(
      (e: { kind?: string; name?: string; msg?: string | null }) => e.kind === "warn" && e.name === "self_eval" && /REVISI/i.test(e.msg ?? ""));
    revisionMotivo = ev?.msg?.replace(/^.*?\(no publicada\):\s*/i, "") ?? null;
  }
  cache(c, 3);
  return c.json({ ...row, resultado: resultado ? { ...resultado, revisionMotivo } : null, estimado });
});
