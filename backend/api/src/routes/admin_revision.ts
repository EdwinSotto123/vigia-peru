/**
 * Cola de revisión humana (plan 2026-09-16 · U4). Se monta bajo /admin (hereda el x-admin-token).
 *
 *   GET  /admin/revision                    alertas con estado='revision': OCID, entidad, zona, score, motivo del bloqueo
 *   GET  /admin/revision/:id                detalle: banderas con su verificación, dictamen, autoevaluación, bitácora
 *   PUT  /admin/alertas/:id/estado          {estado: 'activa'|'descartada', motivo} → bitácora + refresh del ranking
 *   GET  /admin/config/self_eval · PUT      umbrales de la autoevaluación (ajustes.self_eval, migración 22)
 *
 * El motivo del bloqueo sale de dos lugares: (1) el warn `self_eval` que el pipeline dejó en
 * `procesamientos.eventos` ("alerta X en REVISIÓN (no publicada): …"), y si no existe (análisis a
 * demanda, stream cortado), (2) se recalcula acá con `analisis_full.self_evals` y los umbrales de
 * `ajustes.self_eval` — misma regla que tools/self_eval.debe_bloquear en el pipeline.
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { actor, log, refrescarRanking } from "../lib/adminlog.js";

export const adminRevisionRouter = new Hono();

// ─── Umbrales ────────────────────────────────────────────────────────────────
export const SelfEvalSchema = z.object({
  min_respaldo: z.number().min(0).max(1),
  min_cita: z.number().min(0).max(1),
  min_precio: z.number().min(0).max(1),
  bloquea_tono: z.boolean(),
  bloquea_coherencia: z.boolean(),
  nota: z.string().max(600).optional().default(""),
});
export type SelfEvalConfig = z.infer<typeof SelfEvalSchema>;
const DEFAULT_SELF_EVAL: SelfEvalConfig = { min_respaldo: 0.6, min_cita: 0.8, min_precio: 0.5, bloquea_tono: true, bloquea_coherencia: true, nota: "" };

let umbralesCache: { at: number; valor: SelfEvalConfig; updatedAt: string | null; updatedBy: string | null } | null = null;
export async function umbralesSelfEval() {
  if (umbralesCache && Date.now() - umbralesCache.at < 60_000) return umbralesCache;
  let valor = DEFAULT_SELF_EVAL, updatedAt: string | null = null, updatedBy: string | null = null;
  try {
    const r = await pool.query(`SELECT valor, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM ajustes WHERE clave = 'self_eval'`);
    const p = SelfEvalSchema.safeParse(r.rows[0]?.valor);
    if (p.success) valor = p.data;
    updatedAt = r.rows[0]?.updatedAt ?? null; updatedBy = r.rows[0]?.updatedBy ?? null;
  } catch { /* sin la fila → defaults del pipeline */ }
  umbralesCache = { at: Date.now(), valor, updatedAt, updatedBy };
  return umbralesCache;
}

// ─── Motivo del bloqueo (port de tools/self_eval.debe_bloquear) ──────────────
interface SelfEvals {
  respaldo?: { n?: number; ok?: number };
  cita?: { n?: number; ok?: number };
  precio?: { n?: number; ok?: number };
  tono?: string; tono_reason?: string;
  coherencia?: string; coherencia_reason?: string;
  pct?: Record<string, number | string>;
  per_bandera?: { regla?: string; reason?: string; respaldada?: boolean }[];
  per_precio?: { item?: string; reason?: string; plausible?: boolean }[];
}
export interface MotivoBloqueo { clave: "respaldo" | "tono" | "coherencia" | "cita" | "precio" | "urls"; texto: string; valor?: number | null; umbral?: number | null }

const pctTxt = (x: number) => `${Math.round(x * 100)} %`;

export function motivosDesdeEval(ev: SelfEvals | null | undefined, u: SelfEvalConfig): MotivoBloqueo[] {
  if (!ev || typeof ev !== "object") return [];
  const ratio = (k: "respaldo" | "cita" | "precio") => {
    const d = ev[k] ?? {};
    const n = Number(d.n ?? 0);
    return { r: n ? Number(d.ok ?? 0) / n : null, n };
  };
  const out: MotivoBloqueo[] = [];
  const re = ratio("respaldo");
  if (re.r !== null && re.n >= 2 && re.r < u.min_respaldo)
    out.push({ clave: "respaldo", texto: `Respaldo de banderas ${pctTxt(re.r)} < ${pctTxt(u.min_respaldo)} (${re.n} juzgadas): la evidencia de algunas banderas no se encuentra en el expediente, el OCDS o las fuentes.`, valor: re.r, umbral: u.min_respaldo });
  if (u.bloquea_tono && String(ev.tono ?? "").toLowerCase() === "acusatorio")
    out.push({ clave: "tono", texto: `Dictamen con tono acusatorio${ev.tono_reason ? `: ${String(ev.tono_reason).slice(0, 160)}` : ""}.` });
  if (u.bloquea_coherencia && String(ev.coherencia ?? "").toLowerCase() === "incoherente")
    out.push({ clave: "coherencia", texto: `Ítems incoherentes con el objeto${ev.coherencia_reason ? `: ${String(ev.coherencia_reason).slice(0, 160)}` : ""}.` });
  const ci = ratio("cita");
  if (ci.r !== null && ci.n >= 3 && ci.r < u.min_cita)
    out.push({ clave: "cita", texto: `Banderas sin norma o fuente citada ${pctTxt(1 - ci.r)} (${ci.n} juzgadas); se exige ≥ ${pctTxt(u.min_cita)} con cita.`, valor: ci.r, umbral: u.min_cita });
  const pr = ratio("precio");
  if (pr.r !== null && pr.n >= 3 && pr.r < u.min_precio)
    out.push({ clave: "precio", texto: `Veredictos de precio plausibles ${pctTxt(pr.r)} < ${pctTxt(u.min_precio)}: la comparación de mercado es dudosa.`, valor: pr.r, umbral: u.min_precio });
  return out;
}

/** Warn que dejó el pipeline en la bitácora del procesamiento (trae el umbral real que aplicó). */
const WARN_SQL = `SELECT e->>'msg' AS msg FROM procesamientos p, jsonb_array_elements(p.eventos) e
  WHERE ocid_corto(p.ocid) = ocid_corto($1) AND e->>'kind' = 'warn' AND e->>'name' = 'self_eval' AND e->>'msg' ILIKE '%REVISI%'
  ORDER BY e->>'ts' DESC LIMIT 1`;
const limpiarWarn = (msg: string | null | undefined) => msg ? msg.replace(/^.*?\(no publicada\):\s*/i, "").trim() : null;

const HEAD_SQL = `
  SELECT a.id, a.codigo, a.ocid, a.objeto, a.score, a.estado, a.region, a.provincia, a.distrito,
         a.analizado_en AS "analizadoEn", a.created_at AS "createdAt", a.monto_adjudicado::float AS "montoAdjudicado",
         a.entidad_ruc AS "entidadRuc", e.nombre AS entidad, a.proveedor_ruc AS "proveedorRuc",
         COALESCE(cv.tipo_contratacion, 'sin_clasificar') AS tipo, cv.etapa,
         z.ubigeo, z.nombre AS zona,
         (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)::int AS banderas,
         a.analisis_full->'self_evals' AS "selfEvals",
         a.analisis_full->'self_evals'->'pct' AS pct,
         a.analisis_full->>'perfil' AS perfil,
         a.moderacion,
         pp.contribucion_codigo AS "contribucionCodigo", pp.financiador, pp.ocid AS "procesamientoOcid"
  FROM alertas a
  LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
  LEFT JOIN convocatorias cv ON ocid_corto(cv.ocid) = ocid_corto(a.ocid)
  LEFT JOIN zonas z ON z.ubigeo = cv.ubigeo
  LEFT JOIN LATERAL (SELECT contribucion_codigo, financiador, ocid FROM procesamientos_publico v
                      WHERE ocid_corto(v.ocid) = ocid_corto(a.ocid) LIMIT 1) pp ON true`;

async function conMotivo<T extends { ocid: string; selfEvals: SelfEvals | null }>(rows: T[]) {
  const u = (await umbralesSelfEval()).valor;
  return Promise.all(rows.map(async (r) => {
    const warn = await pool.query(WARN_SQL, [r.ocid]).then((q) => limpiarWarn(q.rows[0]?.msg)).catch(() => null);
    const motivos = motivosDesdeEval(r.selfEvals, u);
    return { ...r, motivoPipeline: warn, motivos, motivo: warn ?? (motivos.map((m) => m.texto).join(" · ") || "La autoevaluación no dejó motivo legible; revisa banderas y dictamen."), selfEvals: undefined };
  }));
}

// ─── GET /revision ───────────────────────────────────────────────────────────
adminRevisionRouter.get("/revision", async (c) => {
  const estado = new URL(c.req.url).searchParams.get("estado") ?? "revision";
  const vals: unknown[] = [];
  let where = "WHERE a.estado = 'revision'";
  if (estado === "resueltas") where = "WHERE a.moderacion IS NOT NULL";
  const r = await pool.query(`${HEAD_SQL} ${where} ORDER BY a.analizado_en DESC NULLS LAST, a.created_at DESC LIMIT 200`, vals);
  const data = await conMotivo(r.rows);
  const u = await umbralesSelfEval();
  return c.json({ data, umbrales: u.valor, total: data.length });
});

// ─── GET /revision/:id ───────────────────────────────────────────────────────
adminRevisionRouter.get("/revision/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "invalid_id" }, 400);
  const h = await pool.query(`${HEAD_SQL} WHERE a.id = $1`, [id]);
  if (!h.rows.length) return c.json({ error: "not_found" }, 404);
  const [row] = await conMotivo(h.rows);
  const [banderas, dictamen, lg, u] = await Promise.all([
    pool.query(
      `SELECT b.id, b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url AS "fuenteUrl", b.agente_origen AS agente, b.verificacion
       FROM banderas b WHERE b.alerta_id = $1
       ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id`, [id]),
    pool.query(`SELECT dictamen_markdown AS dictamen, analisis_full->'verificacion_dictamen' AS "verificacionDictamen",
                       analisis_full->'validaciones_pendientes' AS "validacionesPendientes", analisis_full->'descartes' AS descartes
                FROM alertas WHERE id = $1`, [id]),
    pool.query(`SELECT actor, accion, detalle, created_at AS "createdAt" FROM admin_log WHERE objeto = $1 ORDER BY created_at DESC LIMIT 20`, [`alerta:${id}`]),
    umbralesSelfEval(),
  ]);
  const selfEvals: SelfEvals | null = h.rows[0].selfEvals ?? null;
  return c.json({
    ...row,
    banderas: banderas.rows,
    dictamen: dictamen.rows[0]?.dictamen ?? null,
    verificacionDictamen: dictamen.rows[0]?.verificacionDictamen ?? null,
    validacionesPendientes: dictamen.rows[0]?.validacionesPendientes ?? [],
    descartes: dictamen.rows[0]?.descartes ?? [],
    autoevaluacion: selfEvals ? {
      pct: selfEvals.pct ?? null,
      respaldo: selfEvals.respaldo ?? null, cita: selfEvals.cita ?? null, precio: selfEvals.precio ?? null,
      tono: selfEvals.tono ?? null, tonoReason: selfEvals.tono_reason ?? null,
      coherencia: selfEvals.coherencia ?? null, coherenciaReason: selfEvals.coherencia_reason ?? null,
      perBandera: selfEvals.per_bandera ?? [], perPrecio: selfEvals.per_precio ?? [],
    } : null,
    umbrales: u.valor,
    log: lg.rows,
  });
});

// ─── PUT /alertas/:id/estado ─────────────────────────────────────────────────
const EstadoBody = z.object({
  estado: z.enum(["activa", "descartada"]),
  motivo: z.string().trim().min(3).max(500),
});
adminRevisionRouter.put("/alertas/:id/estado", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "invalid_id" }, 400);
  const body = EstadoBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  const who = actor(c);
  const accion = body.data.estado === "activa" ? "publicar" : "descartar";
  const moderacion = { accion, actor: who, motivo: body.data.motivo, at: new Date().toISOString() };
  const r = await pool.query(
    `UPDATE alertas SET estado = $2, moderacion = $3::jsonb, updated_at = now()
     WHERE id = $1 AND estado <> $2 RETURNING codigo, ocid, estado`,
    [id, body.data.estado, JSON.stringify(moderacion)]);
  if (!r.rows.length) return c.json({ error: "not_found_or_same_state" }, 404);
  await log(who, `alerta_${accion}`, `alerta:${id}`, { codigo: r.rows[0].codigo, ocid: r.rows[0].ocid, estado: body.data.estado, motivo: body.data.motivo });
  const refrescado = await refrescarRanking();
  return c.json({ ok: true, id, codigo: r.rows[0].codigo, estado: r.rows[0].estado, rankingRefrescado: refrescado });
});

// ─── Umbrales editables ──────────────────────────────────────────────────────
adminRevisionRouter.get("/config/self_eval", async (c) => {
  const u = await umbralesSelfEval();
  return c.json({ valor: u.valor, updatedAt: u.updatedAt, updatedBy: u.updatedBy, defaults: DEFAULT_SELF_EVAL,
    env: ["EVAL_MIN_RESPALDO", "EVAL_MIN_CITA", "EVAL_MIN_PRECIO", "EVAL_BLOQUEA_TONO", "EVAL_BLOQUEA_COHERENCIA"] });
});

adminRevisionRouter.put("/config/self_eval", async (c) => {
  const body = SelfEvalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  const who = actor(c);
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('self_eval', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(body.data), who]);
  umbralesCache = null;
  await log(who, "editar_self_eval", "ajustes:self_eval", body.data);
  return c.json({ ok: true, valor: body.data });
});
