/**
 * Procesamiento EN VIVO de los contratos asignados a contribuciones (tablero público).
 * Lee la vista `procesamientos_publico` (migración 12): sin email ni worker.
 *
 *   GET /financiamiento/procesamientos?ubigeo=15&codigo=VIG-2026-00002&estado=procesando&alerta=revision&limit=100
 *       estado = encolado | procesando | procesado | error | pendiente_de_procesamiento | esperando_documentos
 *              | activos  (= todo lo que aún no terminó bien: esperando_documentos, pendiente_de_procesamiento,
 *                           encolado, procesando, error)
 *       alerta = revision  sólo los procesados cuya alerta quedó en revisión humana; cada fila trae
 *                          `motivos` (los mismos de GET /alertas/:id/revision). Reemplaza el N+1 del frontend.
 *       Orden por defecto: primero lo activo (procesando → encolado → esperando_documentos → error →
 *       pendiente_de_procesamiento) y al final lo procesado, así un `limit` corto no deja afuera la cola.
 *       Si la alerta no está publicada (`alertaEstado` revision/descartada): `score` y `banderas` = null
 *       y `enRevision` = true para revision (lib/publicacion.ts §2).
 *       Caché 3 s por combinación de parámetros + ETag (304 ante If-None-Match).
 *   GET /financiamiento/procesamientos/resumen        conteo por estado + procesados hoy (hora de Lima) + activos
 *                                                     (fase, segundos) + lote de ingesta + documentos + en revisión
 *                                                     + agentes activos + `version` + `porDepartamento`
 *   GET /financiamiento/procesamientos/ritmo?dias=14  procesados por día (hora de Lima, con los días en cero)
 *   GET /financiamiento/procesamientos/:ocid          detalle + eventos [{ts, kind, name, msg}] + fases + resultado
 *                                                     (score, señales, mercado, documentos leídos) + estimado (mediana)
 *
 * Migración 20: `fases` {fase: {estado: corriendo|hecho|omitido|error, desde, hasta, motivo}} lo escribe el
 * dispatcher (DAG paralelo: varias fases corren a la vez); `alertaEstado` = 'revision' cuando la
 * autoevaluación bloqueó la publicación.
 *
 * Se monta ANTES de /financiamiento para que no lo capture financiamientoRouter.
 * Cache corta (2-5 s en el CDN, 0 en el navegador, que revalida con el ETag): el frontend sondea.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { etiquetaRegla, reglasJson } from "../lib/reglas.js";
import { motivosDesdeEval, umbralesSelfEval, type SelfEvalConfig } from "./admin_revision.js";
import { procBanderasSql, procScoreSql, redactarResultado } from "../lib/publicacion.js";
import { Memo, responderJson, responderSerializado, serializar, type Serializado } from "../lib/cache.js";
import { cachePublico, fechaIso, parametros } from "../lib/http.js";

export const procesamientosRouter = new Hono();

const cache = (c: Context, s: number) => c.header("Cache-Control", cachePublico(s, { maxAge: 0 }));

/** Columnas públicas de `procesamientos_publico`. Score y conteo de señales solo si la alerta está publicada. */
export const COLS = `ocid, estado, fase_actual AS "faseActual", fase_index AS "faseIndex", iniciado_at AS "iniciadoAt",
  finalizado_at AS "finalizadoAt", intentos, contribucion_codigo AS "contribucionCodigo", financiador,
  financiador_visible AS "financiadorVisible", ubigeo, zona, titulo, entidad, monto_pen::float AS "montoPen",
  alerta_codigo AS "alertaCodigo", ${procScoreSql()} AS score, ${procBanderasSql()} AS banderas, fases,
  alerta_estado AS "alertaEstado", COALESCE(alerta_estado = 'revision', false) AS "enRevision"`;

/** Estados "activos" (aún no terminaron bien) para `?estado=activos`, el orden por defecto y `porDepartamento`. */
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
  COALESCE(finalizado_at, iniciado_at, encolado_at) DESC, ocid, alerta_codigo`;

const Q = z.object({
  ubigeo: z.string().regex(/^\d{2,6}$/).optional(),
  codigo: z.string().max(20).optional(),
  estado: z.enum([
    "encolado", "procesando", "procesado", "error", "pendiente_de_procesamiento", "esperando_documentos", "activos",
  ]).optional(),
  alerta: z.enum(["revision"]).optional(),
  financiador: z.string().min(1).max(120).optional(),
  desde: fechaIso().optional(),
  hasta: fechaIso().optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Lista del tablero (sondeada): 3 s por combinación de parámetros. El texto libre del financiador
// va en una caché aparte y chica (lib/cache.ts). Cuando el resumen ve una `version` nueva, vacía
// esta caché: la lista que el tablero pide justo después ya trae el cambio.
const listaMemo = new Memo<Serializado>({ nombre: "procesamientos:lista", ttlMs: 3_000, max: 100 });
const listaTextoMemo = new Memo<Serializado>({ nombre: "procesamientos:lista:texto", ttlMs: 3_000, max: 20 });

procesamientosRouter.get("/", async (c) => {
  const p = Q.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const q = p.data;
  const memo = q.financiador ? listaTextoMemo : listaMemo;
  return responderJson(c, memo, JSON.stringify(q), () => listaProcesamientos(q), cachePublico(2, { maxAge: 0 }));
});

async function listaProcesamientos(q: z.infer<typeof Q>) {
  const { ubigeo, codigo, estado, alerta, financiador, desde, hasta, limit, offset } = q;
  const vals: unknown[] = [];
  const w: string[] = [];
  if (ubigeo) { vals.push(ubigeo); w.push(`ubigeo LIKE $${vals.length} || '%'`); }
  if (codigo) { vals.push(codigo.toUpperCase()); w.push(`contribucion_codigo = $${vals.length}`); }
  if (estado === "activos") { vals.push([...ESTADOS_ACTIVOS]); w.push(`estado = ANY($${vals.length}::text[])`); }
  else if (estado) { vals.push(estado); w.push(`estado = $${vals.length}`); }
  if (alerta === "revision") w.push(`alerta_estado = 'revision'`);
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
    pool.query(`SELECT ${COLS}, alerta_id::text AS "_alertaId" FROM procesamientos_publico ${whereSql} ${ORDER}
                LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals),
    pool.query(`SELECT count(*)::int AS n FROM procesamientos_publico ${whereSql}`, totalVals),
  ]);
  // Con `alerta=revision`: los motivos de cada fila en UNA consulta (antes el frontend pedía
  // /alertas/:id/revision una vez por alerta). Sólo con ese filtro: leer la autoevaluación saca
  // analisis_full de la tabla, y la lista general se sondea cada pocos segundos.
  const motivos = alerta === "revision"
    ? await motivosRevisionLote(r.rows.map((x) => x._alertaId).filter((x): x is string => !!x))
    : null;
  const data = r.rows.map(({ _alertaId, ...fila }) =>
    motivos ? { ...fila, motivos: (_alertaId && motivos.get(_alertaId)) || [] } : fila);
  return { data, total: total.rows[0].n, limit, offset };
}

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
  c.header("Cache-Control", cachePublico(60));
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

// ─── GET /financiamiento/procesamientos/resumen ──────────────────────────────
// Lo sondea cada 5 s el tablero público (y cada visitante): en caché 4 s (< su Cache-Control de 5 s),
// así N visitantes simultáneos cuestan UNA pasada. Antes eran 11 consultas en paralelo contra un
// pool de 10 (auditoría A3); ahora UNA sentencia con subconsultas escalares + el lote de ingesta.
//
// `version`: md5 de las columnas públicas de todos los procesamientos (estado, fase, fases,
// finalizado, alerta, score…; no el latido): cambia exactamente cuando cambia algo que el tablero
// muestra, y el tablero pide la lista sólo entonces. `procesamientos` no tiene updated_at.
//
// `porDepartamento`: {"15": {activos, procesando, error}} con activos = todo lo que no terminó bien
// (los estados de `?estado=activos`, incluidos `procesando` y `error`), por el ubigeo del aporte.
//
// `procesadosHoy` cuenta el día de Lima (antes, el de la base: UTC, que cambia a las 19:00 en Perú):
// coincide con el último día de /ritmo.
const RESUMEN_SQL = `SELECT
  (SELECT COALESCE(json_object_agg(x.estado, x.n), '{}'::json)
     FROM (SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado) x) AS "porEstado",
  (SELECT count(*)::int FROM procesamientos
    WHERE estado = 'procesado' AND finalizado_at >= (date_trunc('day', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima')) AS "procesadosHoy",
  (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
     SELECT ocid, fase_actual AS "faseActual", fase_index AS "faseIndex", financiador, zona, titulo, fases,
            GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(iniciado_at, encolado_at))))::int AS "desdeSeg"
       FROM procesamientos_publico WHERE estado = 'procesando' ORDER BY iniciado_at NULLS LAST, ocid LIMIT 24) x) AS activos,
  (SELECT count(*)::int FROM convocatorias WHERE created_at >= now() - interval '24 hours') AS "descargados24h",
  (SELECT valor FROM ajustes WHERE clave = 'procesamiento') AS "procesamientoActivo",
  (SELECT json_build_object('n', count(*)::int, 'contratos', count(DISTINCT ocid)::int)
     FROM documentos_gcs WHERE borrado_at IS NULL AND expira_at > now()) AS "documentosListos",
  (SELECT json_build_object('pendientes', count(*) FILTER (WHERE estado = 'pendiente')::int,
                            'descargando', count(*) FILTER (WHERE estado = 'descargando')::int,
                            'listos24h', count(*) FILTER (WHERE estado = 'listo' AND atendido_at >= now() - interval '24 hours')::int,
                            'fallidos', count(*) FILTER (WHERE estado = 'fallido')::int)
     FROM pedidos_descarga) AS pedidos,
  (SELECT json_build_object('medianaSeg', e."medianaSeg", 'n', e.n) FROM (${ESTIMADO_SQL}) e) AS estimado,
  (SELECT json_build_object('n', count(*)::int, 'contratos', count(DISTINCT ocid)::int)
     FROM documentos_gcs WHERE creado_at >= now() - interval '7 days') AS "documentosDescargados7d",
  -- Procesados cuya alerta quedó bloqueada por la autoevaluación (revisión humana): cuentan como procesados, no como señales.
  (SELECT count(*)::int FROM procesamientos p JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid)
    WHERE p.estado = 'procesado' AND a.estado = 'revision') AS revision,
  (SELECT md5(COALESCE(string_agg(ROW(v.ocid, v.estado, v.fase_actual, v.fase_index, v.intentos, v.iniciado_at, v.finalizado_at,
                                      v.contribucion_codigo, v.ubigeo, v.financiador, v.alerta_codigo, v.score, v.banderas,
                                      v.alerta_estado, md5(v.fases::text))::text, ';' ORDER BY v.ocid, v.alerta_codigo), ''))
     FROM procesamientos_publico v) AS version,
  (SELECT COALESCE(json_object_agg(x.dep, json_build_object('activos', x.activos, 'procesando', x.procesando, 'error', x.errores) ORDER BY x.dep), '{}'::json)
     FROM (SELECT left(co.ubigeo, 2) AS dep,
                  count(*) FILTER (WHERE p.estado = ANY($1::text[]))::int AS activos,
                  count(*) FILTER (WHERE p.estado = 'procesando')::int AS procesando,
                  count(*) FILTER (WHERE p.estado = 'error')::int AS errores
             FROM procesamientos p JOIN contribuciones co ON co.id = p.contribucion_id
            GROUP BY 1 HAVING count(*) FILTER (WHERE p.estado = ANY($1::text[])) > 0) x) AS "porDepartamento"`;

const resumenMemo = new Memo<Serializado>({ nombre: "procesamientos:resumen", ttlMs: 4_000 });
let versionVista = "";

procesamientosRouter.get("/resumen", (c) =>
  responderJson(c, resumenMemo, "resumen", async () => {
    const [r, lote] = await Promise.all([
      pool.query(RESUMEN_SQL, [[...ESTADOS_ACTIVOS]]),
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
    ]);
    const x = r.rows[0];
    const porEstado: Record<string, number> = { encolado: 0, procesando: 0, procesado: 0, error: 0, pendiente_de_procesamiento: 0, esperando_documentos: 0, revision: 0, ...x.porEstado };
    porEstado.revision = x.revision;
    const activos = x.activos as { faseActual: string | null }[];
    const agentesActivos = Array.from(new Set(
      activos.map((a) => a.faseActual).filter((f): f is string => !!f && f !== "started" && f !== "final"),
    ));
    // Algo público cambió: la lista (y el ritmo) que se pida ahora no puede salir de la caché anterior.
    if (x.version !== versionVista) {
      versionVista = x.version;
      listaMemo.invalidar();
      listaTextoMemo.invalidar();
    }
    return {
      porEstado,
      procesadosHoy: x.procesadosHoy,
      activos,
      lote: lote ?? null,
      descargados24h: x.descargados24h,
      documentosDescargados7d: x.documentosDescargados7d,
      enRevision: x.revision,
      procesamientoActivo: x.procesamientoActivo ?? null,
      documentosListos: x.documentosListos,
      pedidos: x.pedidos,
      agentesActivos,
      estimado: x.estimado,
      version: x.version,
      porDepartamento: x.porDepartamento,
    };
  }, cachePublico(4, { maxAge: 0 })));

// ─── GET /financiamiento/procesamientos/ritmo?dias=14 ────────────────────────
// Procesados por día (hora de Lima), con los días en cero, hasta hoy: `{dias:[{dia, n}], total, ultimoFin}`.
// Antes el frontend lo contaba sobre `?estado=procesado&limit=300` y se truncaba en silencio (C8).
// Caché de 60 s cuya clave incluye cuántos procesados hay y el último fin (una consulta mínima por
// índice): nunca sirve un ritmo viejo, y sin cambios no vuelve a contar. En el CDN, 0 s: el tablero
// lo pide justo cuando cambió el número de procesados.
const RitmoQuery = z.object({ dias: z.coerce.number().int().min(1).max(60).default(14) });
const ritmoMemo = new Memo<Serializado>({ nombre: "procesamientos:ritmo", ttlMs: 60_000, max: 20 });

procesamientosRouter.get("/ritmo", async (c) => {
  const p = RitmoQuery.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { dias } = p.data;
  const k = await pool.query<{ n: number; ultimo: Date | null }>(
    `SELECT count(*)::int AS n, max(finalizado_at) AS ultimo FROM procesamientos WHERE estado = 'procesado'`);
  const ultimoFin = k.rows[0].ultimo ? new Date(k.rows[0].ultimo).toISOString() : null;
  const clave = `${dias}|${k.rows[0].n}|${ultimoFin ?? ""}`;
  return responderJson(c, ritmoMemo, clave, async () => {
    const r = await pool.query<{ dia: string; n: number }>(
      `WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Lima')::date AS d),
            dias AS (SELECT generate_series(hoy.d - ($1::int - 1), hoy.d, interval '1 day')::date AS dia FROM hoy),
            n AS (SELECT (p.finalizado_at AT TIME ZONE 'America/Lima')::date AS dia, count(*)::int AS n
                    FROM procesamientos p, hoy
                   WHERE p.estado = 'procesado'
                     AND p.finalizado_at >= ((hoy.d - ($1::int - 1))::timestamp AT TIME ZONE 'America/Lima')
                   GROUP BY 1)
       SELECT to_char(dias.dia, 'YYYY-MM-DD') AS dia, COALESCE(n.n, 0)::int AS n
         FROM dias LEFT JOIN n USING (dia) ORDER BY dias.dia`, [dias]);
    return { dias: r.rows, total: r.rows.reduce((s, d) => s + d.n, 0), ultimoFin };
  }, cachePublico(0, { maxAge: 0 }));
});

// ─── GET /financiamiento/procesamientos/reglas?perfil=bienes ─────────────────────────────
// Reglas deterministas por perfil (JSON estático generado por backend/scripts/exportar_reglas.py).
// Cambia sólo con un despliegue: serializado una vez, con ETag.
const reglasSerializadas = new Map<string, Serializado>();
procesamientosRouter.get("/reglas", (c) => {
  const perfil = (c.req.query("perfil") ?? "").toLowerCase();
  const rj = reglasJson as any;
  const perfiles = rj.perfiles as Record<string, unknown>;
  if (perfil && !perfiles[perfil]) return c.json({ error: "perfil_desconocido", perfiles: Object.keys(perfiles) }, 404);
  let s = reglasSerializadas.get(perfil);
  if (!s) {
    s = serializar(perfil
      ? { version: rj.version, generadoAt: rj.generado_at, perfil, ...(perfiles[perfil] as object), otrasSenales: rj.otras_senales }
      : { version: rj.version, generadoAt: rj.generado_at, perfiles, otrasSenales: rj.otras_senales });
    reglasSerializadas.set(perfil, s);
  }
  return responderSerializado(c, s, cachePublico(3600, { maxAge: 3600 }));
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

const TITULOS: Record<string, { titulo: string; detalle: (v: number | null, u: number | null) => string }> = {
  respaldo: { titulo: "Evidencia insuficiente", detalle: (v, u) => `Solo el ${pct100(v)} de las señales tiene evidencia localizable en el expediente, el registro OCDS o las fuentes oficiales (mínimo ${pct100(u)}).` },
  tono: { titulo: "Tono del dictamen", detalle: () => "El dictamen usa un tono acusatorio. Vigía publica señales de riesgo, no acusaciones: una persona lo ajusta antes de publicar." },
  coherencia: { titulo: "Señales y objeto no coinciden", detalle: () => "Lo que describen los ítems o las señales no es coherente con el objeto del contrato." },
  cita: { titulo: "Señales sin norma o fuente citada", detalle: (v, u) => `Solo el ${pct100(v)} de las señales cita norma y fuente; se exige al menos ${pct100(u)}.` },
  precio: { titulo: "Comparación de precios dudosa", detalle: (v, u) => `Solo el ${pct100(v)} de las comparaciones con el mercado resultó plausible (mínimo ${pct100(u)}).` },
  urls: { titulo: "Datos no verificables", detalle: () => "Alguna URL, RUC o fecha citada no se pudo comprobar en fuentes oficiales." },
};
const pct100 = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)} %`);

/** Motivos públicos a partir de la autoevaluación (`analisis_full.self_evals`) y los umbrales vigentes. */
function motivosDe(se: any, u: SelfEvalConfig): RevisionMotivo[] {
  if (!se || typeof se !== "object") return [];
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

/** Explica por qué la autoevaluación bloqueó la publicación (misma regla que el admin, sin texto sensible). */
export async function motivosRevision(alertaId: string): Promise<RevisionMotivo[]> {
  const r = await pool.query(`SELECT analisis_full->'self_evals' AS se FROM alertas a WHERE a.id = $1`, [alertaId]);
  const se = r.rows[0]?.se ?? null;
  if (!se || typeof se !== "object") return [];
  return motivosDe(se, (await umbralesSelfEval()).valor);
}

/** Los motivos de varias alertas (uuid → motivos) en una sola consulta. */
export async function motivosRevisionLote(alertaIds: string[]): Promise<Map<string, RevisionMotivo[]>> {
  const out = new Map<string, RevisionMotivo[]>();
  const ids = Array.from(new Set(alertaIds));
  if (!ids.length) return out;
  const [r, u] = await Promise.all([
    pool.query<{ id: string; se: unknown }>(`SELECT a.id::text AS id, a.analisis_full->'self_evals' AS se FROM alertas a WHERE a.id = ANY($1::uuid[])`, [ids]),
    umbralesSelfEval().then((x) => x.valor),
  ]);
  for (const row of r.rows) out.set(row.id, motivosDe(row.se, u));
  return out;
}
