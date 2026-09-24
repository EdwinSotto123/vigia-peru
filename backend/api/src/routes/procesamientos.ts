/**
 * Procesamiento EN VIVO de los contratos asignados a contribuciones (tablero público).
 * Lee la vista `procesamientos_publico` (migración 12): sin email ni worker.
 *
 *   GET /financiamiento/procesamientos?ubigeo=15&codigo=VIG-2026-00002&estado=procesando&limit=100
 *       estado = encolado | procesando | procesado | error | pendiente_de_procesamiento | esperando_documentos
 *              | activos  (= todo lo que aún no terminó bien: esperando_documentos, pendiente_de_procesamiento,
 *                           encolado, procesando, error)
 *       Orden por defecto: primero lo activo (procesando → encolado → esperando_documentos → error →
 *       pendiente_de_procesamiento) y al final lo procesado, así un `limit` corto no deja afuera la cola.
 *       Si la alerta no está publicada (`alertaEstado` revision/descartada): `score` y `banderas` = null
 *       y `enRevision` = true para revision (lib/publicacion.ts §2).
 *   GET /financiamiento/procesamientos/resumen        conteo por estado + procesados hoy + activos (fase, segundos)
 *                                                     + lote de ingesta en curso + documentos descargados (7 días) + en revisión + agentes activos
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
import reglasJson from "../data/reglas.json" with { type: "json" };
import { motivosDesdeEval, umbralesSelfEval } from "./admin_revision.js";
import { procBanderasSql, procScoreSql, redactarResultado } from "../lib/publicacion.js";
import { Memo } from "../lib/cache.js";

export const procesamientosRouter = new Hono();

const cache = (c: Context, s: number) => c.header("Cache-Control", `public, s-maxage=${s}, stale-while-revalidate=10`);

/** Columnas públicas de `procesamientos_publico`. Score y conteo de señales solo si la alerta está publicada. */
export const COLS = `ocid, estado, fase_actual AS "faseActual", fase_index AS "faseIndex", iniciado_at AS "iniciadoAt",
  finalizado_at AS "finalizadoAt", intentos, contribucion_codigo AS "contribucionCodigo", financiador,
  financiador_visible AS "financiadorVisible", ubigeo, zona, titulo, entidad, monto_pen::float AS "montoPen",
  alerta_codigo AS "alertaCodigo", ${procScoreSql()} AS score, ${procBanderasSql()} AS banderas, fases,
  alerta_estado AS "alertaEstado", COALESCE(alerta_estado = 'revision', false) AS "enRevision"`;

/** Estados "activos" (aún no terminaron bien) para `?estado=activos` y para el orden por defecto. */
const ESTADOS_ACTIVOS = ["esperando_documentos", "pendiente_de_procesamiento", "encolado", "procesando", "error"] as const;

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
  (a.dictamen_markdown IS NOT NULL AND length(a.dictamen_markdown) > 200) AS "dictamenListo",
  -- U5: perfil del pipeline, costo/tokens del análisis y modelo usado (para "versión del pipeline")
  a.analisis_full->>'perfil' AS perfil,
  CASE WHEN jsonb_typeof(a.analisis_full->'llm_metrics') = 'object' THEN json_build_object(
    'costoUsd', (a.analisis_full->'llm_metrics'->>'cost_usd')::float,
    'llamadas', (a.analisis_full->'llm_metrics'->>'n_llm_calls')::int,
    'tokens', (a.analisis_full->'llm_metrics'->>'tokens_total')::int) ELSE NULL END AS costo,
  (SELECT u->>'modelo' FROM jsonb_array_elements(COALESCE(a.analisis_full->'document_analysis'->'documentos', '[]'::jsonb)) d,
          jsonb_array_elements(COALESCE(d->'usos', '[]'::jsonb)) u WHERE u->>'modelo' IS NOT NULL LIMIT 1) AS modelo,
  CASE WHEN jsonb_typeof(a.analisis_full->'compliance_resumen_det') = 'object'
       THEN a.analisis_full->'compliance_resumen_det'->'reglas' ELSE NULL END AS "reglasDisparadas"
  FROM alertas a WHERE a.id = $1`;

// Lo activo primero: antes `esperando_documentos` y `pendiente_de_procesamiento` caían después de
// todo lo procesado y un `limit` corto los dejaba fuera de la respuesta.
const ORDER = `ORDER BY CASE estado WHEN 'procesando' THEN 0 WHEN 'encolado' THEN 1 WHEN 'esperando_documentos' THEN 2
                                 WHEN 'error' THEN 3 WHEN 'pendiente_de_procesamiento' THEN 4 WHEN 'procesado' THEN 5 ELSE 6 END,
  COALESCE(finalizado_at, iniciado_at, encolado_at) DESC, ocid`;

const Q = z.object({
  ubigeo: z.string().regex(/^\d{2,6}$/).optional(),
  codigo: z.string().max(20).optional(),
  estado: z.enum([
    "encolado", "procesando", "procesado", "error", "pendiente_de_procesamiento", "esperando_documentos", "activos",
  ]).optional(),
  financiador: z.string().min(1).max(120).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

procesamientosRouter.get("/", async (c) => {
  const p = Q.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { ubigeo, codigo, estado, financiador, desde, hasta, limit, offset } = p.data;
  const vals: unknown[] = [];
  const w: string[] = [];
  if (ubigeo) { vals.push(ubigeo); w.push(`ubigeo LIKE $${vals.length} || '%'`); }
  if (codigo) { vals.push(codigo.toUpperCase()); w.push(`contribucion_codigo = $${vals.length}`); }
  if (estado === "activos") { vals.push([...ESTADOS_ACTIVOS]); w.push(`estado = ANY($${vals.length}::text[])`); }
  else if (estado) { vals.push(estado); w.push(`estado = $${vals.length}`); }
  // `financiador` (procesamientos_publico) ya sale como 'Anónimo' cuando financiador_visible es falso,
  // así que un ILIKE acá nunca expone a quien pidió no aparecer.
  if (financiador) { vals.push(`%${financiador}%`); w.push(`financiador ILIKE $${vals.length}`); }
  // Rango sobre `encolado_at`: es el único timestamp que SIEMPRE existe (desde que entra a la cola),
  // a diferencia de iniciado_at/finalizado_at (null mientras no arranca o no termina).
  if (desde) { vals.push(desde); w.push(`encolado_at >= $${vals.length}::date`); }
  if (hasta) { vals.push(hasta); w.push(`encolado_at < ($${vals.length}::date + interval '1 day')`); }
  const whereSql = w.length ? "WHERE " + w.join(" AND ") : "";
  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(`SELECT ${COLS} FROM procesamientos_publico ${whereSql} ${ORDER} LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals),
    pool.query(`SELECT count(*)::int AS n FROM procesamientos_publico ${whereSql}`, totalVals),
  ]);
  cache(c, 5);
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
});

// ─── GET /financiamiento/procesamientos/financiadores ────────────────────────
// Nombres distintos (visibles) presentes en el tablero, para el filtro por patrocinador.
// Ámbito: solo quienes tienen contratos en `procesamientos_publico` (no la tabla `financiadores`
// completa) — así el desplegable no ofrece nombres sin nada que mostrar en este tablero.
procesamientosRouter.get("/financiadores", async (c) => {
  const r = await pool.query(
    `SELECT financiador AS nombre, count(*)::int AS n
     FROM procesamientos_publico
     WHERE financiador IS NOT NULL AND financiador <> 'Anónimo'
     GROUP BY financiador ORDER BY n DESC, financiador LIMIT 200`);
  cache(c, 60);
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

// Lo sondea cada 5 s el tablero público (y cada visitante): en caché 4 s (< su Cache-Control de 5 s),
// así N visitantes simultáneos cuestan UNA pasada (~35 ms: tres recorridos de documentos_gcs y convocatorias).
const resumenMemo = new Memo<Record<string, unknown>>({ nombre: "procesamientos:resumen", ttlMs: 4_000 });

procesamientosRouter.get("/resumen", async (c) => {
  const body = await resumenMemo.obtener("resumen", async () => {
    const [r, hoy, activos, descargados, procesamientoActivo, documentosListos, pedidos, lote, estimado, docs7d, revision] = await Promise.all([
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
      // Documentos del SEACE bajados por el lote nocturno en los últimos 7 días (no son contratos nuevos).
      pool.query(`SELECT count(*)::int AS n, count(DISTINCT ocid)::int AS contratos FROM documentos_gcs WHERE creado_at >= now() - interval '7 days'`)
        .then((q) => q.rows[0]).catch(() => ({ n: 0, contratos: 0 })),
      // Procesados cuya alerta quedó bloqueada por la autoevaluación (revisión humana): cuentan como procesados, no como señales.
      pool.query(`SELECT count(*)::int AS n FROM procesamientos p JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid)
                  WHERE p.estado = 'procesado' AND a.estado = 'revision'`).then((q) => q.rows[0].n as number).catch(() => 0),
    ]);
    const porEstado: Record<string, number> = { encolado: 0, procesando: 0, procesado: 0, error: 0, pendiente_de_procesamiento: 0, esperando_documentos: 0, revision: 0 };
    for (const x of r.rows) porEstado[x.estado] = x.n;
    porEstado.revision = revision;
    const agentesActivos = Array.from(new Set(
      activos.rows.map((a) => a.faseActual as string | null).filter((f): f is string => !!f && f !== "started" && f !== "final"),
    ));
    return {
      porEstado,
      procesadosHoy: hoy.rows[0].n,
      activos: activos.rows,
      lote,
      descargados24h: descargados.rows[0].n,
      documentosDescargados7d: docs7d,
      enRevision: revision,
      procesamientoActivo,
      documentosListos,
      pedidos,
      agentesActivos,
      estimado,
    };
  });
  cache(c, 5);
  return c.json(body);
});

// ─── GET /financiamiento/procesamientos/reglas?perfil=bienes ─────────────────────────────
// Reglas deterministas por perfil (JSON estático generado por backend/scripts/exportar_reglas.py).
procesamientosRouter.get("/reglas", (c) => {
  const perfil = (c.req.query("perfil") ?? "").toLowerCase();
  const perfiles = (reglasJson as any).perfiles as Record<string, unknown>;
  cache(c, 3600);
  if (perfil) {
    const p = perfiles[perfil];
    if (!p) return c.json({ error: "perfil_desconocido", perfiles: Object.keys(perfiles) }, 404);
    return c.json({ version: (reglasJson as any).version, generadoAt: (reglasJson as any).generado_at, perfil, ...(p as object), otrasSenales: (reglasJson as any).otras_senales });
  }
  return c.json({ version: (reglasJson as any).version, generadoAt: (reglasJson as any).generado_at, perfiles, otrasSenales: (reglasJson as any).otras_senales });
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
  let revisionMotivos: RevisionMotivo[] = [];
  if (resultado?.estado === "revision") {
    const ev = (Array.isArray(row.eventos) ? row.eventos : []).find(
      (e: { kind?: string; name?: string; msg?: string | null }) => e.kind === "warn" && e.name === "self_eval" && /REVISI/i.test(e.msg ?? ""));
    revisionMotivo = ev?.msg?.replace(/^.*?\(no publicada\):\s*/i, "") ?? null;
    revisionMotivos = await motivosRevision(alertaId).catch(() => []);
  }
  cache(c, 3);
  // Alerta no publicada → resultado sin score, señales, mercado ni reglas disparadas (sí documentos
  // leídos, costo y autoevaluación, que explican el bloqueo). Ver lib/publicacion.ts §2.
  const publico = redactarResultado(resultado);
  return c.json({ ...row, resultado: publico ? { ...publico, revisionMotivo, revisionMotivos } : null, estimado });
});

// ─── Motivos de revisión humana en lenguaje claro (públicos, sin el texto de los jueces) ──
// Reutiliza el port de tools/self_eval.debe_bloquear de admin_revision.ts y los umbrales de ajustes.self_eval.
export interface RevisionMotivo { clave: string; titulo: string; detalle: string; valor: number | null; umbral: number | null; reglas?: string[]; reglasEtiquetas?: string[] }

/** Etiqueta humana de una regla (reglas.json: perfiles + otras señales); cae al id legible. */
function etiquetaRegla(id: string): string {
  const rj = reglasJson as any;
  for (const p of Object.values(rj.perfiles ?? {}) as any[]) {
    const r = (p.reglas ?? []).find((x: any) => x.id === id);
    if (r) return r.etiqueta;
  }
  return rj.otras_senales?.[id]?.etiqueta ?? id.replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase());
}

const TITULOS: Record<string, { titulo: string; detalle: (v: number | null, u: number | null) => string }> = {
  respaldo: { titulo: "Evidencia insuficiente", detalle: (v, u) => `Solo el ${pct100(v)} de las señales tiene evidencia localizable en el expediente, el registro OCDS o las fuentes oficiales (mínimo ${pct100(u)}).` },
  tono: { titulo: "Tono del dictamen", detalle: () => "El dictamen usa un tono acusatorio. Vigía publica señales de riesgo, no acusaciones: una persona lo ajusta antes de publicar." },
  coherencia: { titulo: "Señales y objeto no coinciden", detalle: () => "Lo que describen los ítems o las señales no es coherente con el objeto del contrato." },
  cita: { titulo: "Señales sin norma o fuente citada", detalle: (v, u) => `Solo el ${pct100(v)} de las señales cita norma y fuente; se exige al menos ${pct100(u)}.` },
  precio: { titulo: "Comparación de precios dudosa", detalle: (v, u) => `Solo el ${pct100(v)} de las comparaciones con el mercado resultó plausible (mínimo ${pct100(u)}).` },
  urls: { titulo: "Datos no verificables", detalle: () => "Alguna URL, RUC o fecha citada no se pudo comprobar en fuentes oficiales." },
};
const pct100 = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);

/** Explica por qué la autoevaluación bloqueó la publicación (misma regla que el admin, sin texto sensible). */
export async function motivosRevision(alertaId: string): Promise<RevisionMotivo[]> {
  const r = await pool.query(`SELECT analisis_full->'self_evals' AS se FROM alertas a WHERE a.id = $1`, [alertaId]);
  const se = r.rows[0]?.se ?? null;
  if (!se || typeof se !== "object") return [];
  const u = (await umbralesSelfEval()).valor;
  const out: RevisionMotivo[] = motivosDesdeEval(se, u).map((m) => {
    const t = TITULOS[m.clave];
    const reglas = m.clave === "respaldo" && Array.isArray(se.per_bandera)
      ? se.per_bandera.filter((b: any) => b && b.respaldada === false && b.regla).map((b: any) => String(b.regla))
      : undefined;
    return { clave: m.clave, titulo: t?.titulo ?? m.clave, detalle: t ? t.detalle(m.valor ?? null, m.umbral ?? null) : m.texto,
             valor: m.valor ?? null, umbral: m.umbral ?? null, ...(reglas?.length ? { reglas, reglasEtiquetas: reglas.map(etiquetaRegla) } : {}) };
  });
  if (!out.length) out.push({ clave: "general", titulo: "Autoevaluación por debajo del umbral", detalle: "Alguno de los 8 evaluadores (4 jueces independientes + 4 comprobaciones en código) no alcanzó el mínimo para publicar. Una persona revisa el análisis antes de decidir.", valor: null, umbral: null });
  return out;
}
