/**
 * Procesamiento EN VIVO de los contratos asignados a contribuciones (tablero público).
 * Lee la vista `procesamientos_publico` (migración 12): sin email ni worker.
 *
 *   GET /financiamiento/procesamientos?ubigeo=15&codigo=VIG-2026-00002&estado=procesando&limit=100
 *   GET /financiamiento/procesamientos/resumen        conteo por estado + procesados hoy + activos (fase, segundos)
 *                                                     + lote de ingesta en curso + descargados 24 h + agentes activos
 *   GET /financiamiento/procesamientos/:ocid          detalle + eventos [{ts, kind, name, msg}]
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
  alerta_codigo AS "alertaCodigo", score, banderas::int`;

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
  const [r, hoy, activos, descargados, pedidos, lote] = await Promise.all([
    pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`),
    pool.query(`SELECT count(*)::int AS n FROM procesamientos WHERE estado = 'procesado' AND finalizado_at::date = current_date`),
    pool.query(
      `SELECT ocid, fase_actual AS "faseActual", fase_index AS "faseIndex", financiador, zona, titulo,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(iniciado_at, encolado_at))))::int AS "desdeSeg"
       FROM procesamientos_publico WHERE estado = 'procesando' ORDER BY iniciado_at NULLS LAST, ocid LIMIT 24`),
    pool.query(`SELECT count(*)::int AS n FROM convocatorias WHERE created_at >= now() - interval '24 hours'`),
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
    pedidos,
    agentesActivos,
  });
});

procesamientosRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  const r = await pool.query(
    `SELECT ${COLS}, (SELECT p.eventos FROM procesamientos p WHERE p.ocid = v.ocid) AS eventos
     FROM procesamientos_publico v WHERE ocid = $1`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  cache(c, 3);
  return c.json(r.rows[0]);
});
