/**
 * Panel admin de "Financia una auditoría". Todo bajo /admin, protegido por
 * `x-admin-token` (secreto `admin-token`). El frontend nunca expone el token:
 * lo guarda en una cookie httpOnly y proxea vía /api/admin/*.
 *
 *   GET   /admin/ping                                  valida el token
 *   GET   /admin/resumen                               KPIs, serie diaria, pendientes, cola
 *   GET   /admin/contribuciones?estado=pendiente_pago|todas&q=
 *   GET   /admin/contribuciones/:codigo                detalle privado (email, comprobante, asignaciones)
 *   GET   /admin/contribuciones/:codigo/comprobante    stream del comprobante desde GCS (bucket privado)
 *   POST  /admin/contribuciones/:codigo/validar        → pagada + asignación FIFO
 *   POST  /admin/contribuciones/:codigo/rechazar       {motivo}
 *   PATCH /admin/contribuciones/:codigo                {notaAdmin}
 *   GET   /admin/financiadores
 *   PATCH /admin/financiadores/:id                     {visible, motivoNoVisible, nombrePublico, logoUrl}
 *   GET   /admin/config/pagos · PUT /admin/config/pagos
 *   GET   /admin/log
 *   POST  /admin/asignar                               re-asigna abiertas + refresh (lo llama Cloud Scheduler)
 *   GET   /admin/procesamientos?estado=                monitor del dispatcher (+ worker, error, latido)
 *   POST  /admin/procesamientos/:ocid/reencolar        vuelve a encolar (intentos=0)
 *   GET   /admin/clasificacion/resumen                 tipo × etapa × procesable + motivos (migración 13)
 *   GET   /admin/cobertura                             por mes: record completo, docs vigentes en GCS, análisis; lotes (migración 16)
 *   GET   /admin/pedidos · POST /admin/pedidos/:id/reintentar   pedidos de descarga (migración 15)
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { storage } from "../lib/storage.js";

export const adminRouter = new Hono();

adminRouter.use("*", async (c, next) => {
  const token = process.env.ADMIN_TOKEN;
  const got = c.req.header("x-admin-token") ?? "";
  if (!token || got !== token) return c.json({ error: "forbidden" }, 403);
  await next();
});

const actor = (c: any) => (c.req.header("x-admin-actor") ?? "admin").slice(0, 60);

async function log(actorName: string, accion: string, objeto: string, detalle?: unknown) {
  await pool.query("INSERT INTO admin_log (actor, accion, objeto, detalle) VALUES ($1,$2,$3,$4)",
    [actorName, accion, objeto, detalle ? JSON.stringify(detalle) : null]);
}

adminRouter.get("/ping", (c) => c.json({ ok: true }));

// ─── Resumen ─────────────────────────────────────────────────────────────────
adminRouter.get("/resumen", async (c) => {
  const [kpi, serie, porEstado, cola, top] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*) FROM contribuciones WHERE estado = 'pendiente_pago')::int                        AS "pendientesValidar",
        (SELECT count(*) FROM contribuciones WHERE estado = 'pendiente_pago' AND comprobante_url IS NOT NULL)::int AS "pendientesConComprobante",
        (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::float AS "montoConfirmadoPen",
        (SELECT COALESCE(sum(contratos),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::int   AS "contratosFinanciados",
        (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada') AND pagada_at >= date_trunc('month', now()))::float AS "montoMesPen",
        (SELECT count(*) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada') AND pagada_at >= now() - interval '7 days')::int AS "aportes7d",
        (SELECT count(DISTINCT financiador_id) FROM contribuciones WHERE estado IN ('pagada','en_proceso','procesada'))::int AS financiadores,
        (SELECT count(*) FROM financiadores WHERE NOT visible)::int                                        AS "financiadoresOcultos",
        (SELECT count(*) FROM asignaciones)::int                                                          AS asignados,
        (SELECT count(*) FROM asignaciones WHERE procesada_at IS NOT NULL)::int                           AS procesados,
        (SELECT count(*) FROM asignaciones WHERE alerta_id IS NOT NULL)::int                              AS "senales",
        (SELECT count(*) FROM cola_auditoria)::int                                                        AS "colaGlobal",
        (SELECT count(*) FROM contribuciones WHERE estado IN ('pagada','en_proceso')
           AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"`),
    pool.query(`
      SELECT d::date AS dia,
             COALESCE(sum(co.monto_pen) FILTER (WHERE co.estado IN ('pagada','en_proceso','procesada')),0)::float AS monto,
             count(co.id) FILTER (WHERE co.estado IN ('pagada','en_proceso','procesada'))::int AS aportes,
             count(co.id) FILTER (WHERE co.estado = 'pendiente_pago')::int AS pendientes
      FROM generate_series(current_date - 29, current_date, '1 day') d
      LEFT JOIN contribuciones co ON COALESCE(co.pagada_at, co.created_at)::date = d::date
      GROUP BY d ORDER BY d`),
    pool.query(`SELECT estado, count(*)::int AS n, COALESCE(sum(monto_pen),0)::float AS monto FROM contribuciones GROUP BY estado`),
    pool.query(`SELECT ubigeo, nombre, estado, pendientes, financiados, procesados, total_cola AS "totalCola"
                FROM zona_estado WHERE nivel = 'departamento' AND total_cola > 0 ORDER BY total_cola DESC LIMIT 10`),
    pool.query(`SELECT nombre, tipo, contratos_financiados AS "contratosFinanciados", contratos_procesados AS "contratosProcesados"
                FROM ranking_impacto ORDER BY contratos_financiados DESC LIMIT 5`),
  ]);
  return c.json({ kpi: kpi.rows[0], serie: serie.rows, porEstado: porEstado.rows, cola: cola.rows, top: top.rows });
});

// ─── Contribuciones ──────────────────────────────────────────────────────────
adminRouter.get("/contribuciones", async (c) => {
  const url = new URL(c.req.url);
  const estado = url.searchParams.get("estado") ?? "pendiente_pago";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const vals: any[] = [];
  const conds: string[] = [];
  if (estado !== "todas") { vals.push(estado); conds.push(`co.estado = $${vals.length}`); }
  if (q) { vals.push(`%${q}%`); conds.push(`(lower(co.codigo) LIKE $${vals.length} OR lower(f.nombre_publico) LIKE $${vals.length} OR lower(f.email) LIKE $${vals.length} OR f.ruc LIKE $${vals.length} OR lower(z.nombre) LIKE $${vals.length})`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT co.codigo, co.estado, co.contratos, co.monto_pen::float AS "montoPen", co.pasarela, co.pasarela_ref AS "pasarelaRef",
            co.comprobante_url IS NOT NULL AS "tieneComprobante", co.created_at AS "createdAt", co.pagada_at AS "pagadaAt",
            co.validada_por AS "validadaPor", co.mensaje_publico AS "mensajePublico", co.nota_admin AS "notaAdmin",
            z.nombre AS zona, z.nivel, co.ubigeo,
            f.id AS "financiadorId", f.tipo, f.nombre_publico AS "nombrePublico", f.ruc, f.email, f.visible, f.motivo_no_visible AS "motivoNoVisible",
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id)::int AS asignados,
            (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = co.id AND s.procesada_at IS NOT NULL)::int AS procesados
     FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id JOIN zonas z ON z.ubigeo = co.ubigeo
     ${where} ORDER BY co.created_at DESC LIMIT 300`, vals);
  return c.json({ data: r.rows });
});

adminRouter.get("/contribuciones/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const h = await pool.query(
    `SELECT co.*, co.monto_pen::float AS "montoPen", z.nombre AS zona, z.nivel,
            f.tipo, f.nombre_publico AS "nombrePublico", f.ruc, f.email, f.logo_url AS "logoUrl", f.visible, f.motivo_no_visible AS "motivoNoVisible", f.slug
     FROM contribuciones co JOIN financiadores f ON f.id = co.financiador_id JOIN zonas z ON z.ubigeo = co.ubigeo
     WHERE co.codigo = $1`, [codigo]);
  if (!h.rows.length) return c.json({ error: "not_found" }, 404);
  const a = await pool.query(
    `SELECT s.ocid, s.asignada_at AS "asignadaAt", s.procesada_at AS "procesadaAt", cv.objeto AS titulo, e.nombre AS entidad, al.codigo AS "alertaCodigo", al.score
     FROM asignaciones s JOIN contribuciones co ON co.id = s.contribucion_id JOIN convocatorias cv ON cv.ocid = s.ocid
     LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc LEFT JOIN alertas al ON al.id = s.alerta_id
     WHERE co.codigo = $1 ORDER BY s.asignada_at`, [codigo]);
  const lg = await pool.query(`SELECT actor, accion, detalle, created_at AS "createdAt" FROM admin_log WHERE objeto = $1 ORDER BY created_at DESC LIMIT 20`, [`contribucion:${codigo}`]);
  const row = h.rows[0];
  return c.json({ ...row, monto_pen: undefined, asignaciones: a.rows, log: lg.rows });
});

// Stream del comprobante (bucket privado): el admin lo ve sin URL pública.
adminRouter.get("/contribuciones/:codigo/comprobante", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const r = await pool.query("SELECT comprobante_url FROM contribuciones WHERE codigo = $1", [codigo]);
  const url: string | null = r.rows[0]?.comprobante_url ?? null;
  if (!url) return c.json({ error: "sin_comprobante" }, 404);
  const m = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  if (!m) return c.redirect(url);
  const file = storage.bucket(m[1]).file(decodeURIComponent(m[2]));
  const [meta] = await file.getMetadata();
  const [buf] = await file.download();
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": String(meta.contentType ?? "application/octet-stream"), "Cache-Control": "private, max-age=60" } });
});

adminRouter.post("/contribuciones/:codigo/validar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = await c.req.json().catch(() => ({}));
  const who = actor(c);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE contribuciones SET estado = 'pagada', pagada_at = now(), validada_por = $2,
              pasarela_ref = COALESCE($3, pasarela_ref), nota_admin = COALESCE($4, nota_admin)
       WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING id`,
      [codigo, who, typeof body?.referencia === "string" ? body.referencia : null, typeof body?.nota === "string" ? body.nota : null]);
    if (!r.rows.length) { await client.query("ROLLBACK"); return c.json({ error: "not_found_or_not_pending" }, 404); }
    const asig = await client.query("SELECT asignar_contribucion($1) AS n", [r.rows[0].id]);
    await client.query("SELECT refresh_financiamiento()");
    await client.query("COMMIT");
    await log(who, "validar", `contribucion:${codigo}`, { asignados: asig.rows[0].n });
    return c.json({ ok: true, codigo, estado: asig.rows[0].n > 0 ? "en_proceso" : "pagada", asignados: asig.rows[0].n });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return c.json({ error: "internal", detail: (e as Error).message }, 500);
  } finally {
    client.release();
  }
});

adminRouter.post("/contribuciones/:codigo/rechazar", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = await c.req.json().catch(() => ({}));
  const motivo = typeof body?.motivo === "string" ? body.motivo.slice(0, 300) : null;
  const r = await pool.query(
    `UPDATE contribuciones SET estado = 'rechazada', rechazada_motivo = $2, validada_por = $3 WHERE codigo = $1 AND estado = 'pendiente_pago' RETURNING codigo`,
    [codigo, motivo, actor(c)]);
  if (!r.rows.length) return c.json({ error: "not_found_or_not_pending" }, 404);
  await log(actor(c), "rechazar", `contribucion:${codigo}`, { motivo });
  return c.json({ ok: true, codigo, estado: "rechazada" });
});

adminRouter.patch("/contribuciones/:codigo", async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = z.object({ notaAdmin: z.string().max(1000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  await pool.query("UPDATE contribuciones SET nota_admin = $2 WHERE codigo = $1", [codigo, body.data.notaAdmin ?? null]);
  return c.json({ ok: true });
});

// ─── Financiadores ───────────────────────────────────────────────────────────
adminRouter.get("/financiadores", async (c) => {
  const r = await pool.query(
    `SELECT f.id, f.tipo, f.nombre_publico AS "nombrePublico", f.slug, f.ruc, f.email, f.logo_url AS "logoUrl", f.visible, f.motivo_no_visible AS "motivoNoVisible", f.created_at AS "createdAt",
            (SELECT count(*) FROM contribuciones co WHERE co.financiador_id = f.id)::int AS aportes,
            (SELECT COALESCE(sum(contratos),0) FROM contribuciones co WHERE co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada'))::int AS "contratosFinanciados",
            (SELECT COALESCE(sum(monto_pen),0) FROM contribuciones co WHERE co.financiador_id = f.id AND co.estado IN ('pagada','en_proceso','procesada'))::float AS "montoPen",
            EXISTS (SELECT 1 FROM osce_sancionados s WHERE s.ruc = f.ruc AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= current_date)) AS "sancionVigente",
            EXISTS (SELECT 1 FROM alertas a WHERE a.proveedor_ruc = f.ruc AND a.estado = 'activa') AS "alertasActivas"
     FROM financiadores f ORDER BY f.created_at DESC LIMIT 500`);
  return c.json({ data: r.rows });
});

adminRouter.patch("/financiadores/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = z.object({
    visible: z.boolean().optional(),
    motivoNoVisible: z.string().max(200).nullable().optional(),
    nombrePublico: z.string().max(80).nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success || !Number.isFinite(id)) return c.json({ error: "invalid_body" }, 400);
  const b = body.data;
  await pool.query(
    `UPDATE financiadores SET
       visible = COALESCE($2, visible),
       motivo_no_visible = CASE WHEN $2 IS TRUE THEN NULL ELSE COALESCE($3, motivo_no_visible) END,
       nombre_publico = COALESCE($4, nombre_publico),
       logo_url = COALESCE($5, logo_url)
     WHERE id = $1`,
    [id, b.visible ?? null, b.motivoNoVisible ?? null, b.nombrePublico ?? null, b.logoUrl ?? null]);
  await pool.query("SELECT refresh_financiamiento()");
  await log(actor(c), "editar_financiador", `financiador:${id}`, b);
  return c.json({ ok: true });
});

// ─── Configuración de pagos ──────────────────────────────────────────────────
const Cuenta = z.object({
  banco: z.string().min(2).max(40),
  moneda: z.enum(["PEN", "USD"]).default("PEN"),
  tipo: z.string().max(30).optional().default("Ahorros"),
  numero: z.string().max(40).optional().default(""),
  cci: z.string().max(30).optional().default(""),
  titular: z.string().max(80).optional().default(""),
});
export const PagosSchema = z.object({
  yape: z.object({ numero: z.string().max(20).default(""), titular: z.string().max(80).default(""), qr_url: z.string().default("") }),
  plin: z.object({ numero: z.string().max(20).default(""), titular: z.string().max(80).default(""), qr_url: z.string().default("") }),
  cuentas: z.array(Cuenta).max(10).default([]),
  instrucciones: z.string().max(600).default(""),
  contacto_email: z.string().max(120).default(""),
});

adminRouter.get("/config/pagos", async (c) => {
  const r = await pool.query("SELECT valor, updated_at AS \"updatedAt\", updated_by AS \"updatedBy\" FROM ajustes WHERE clave = 'pagos'");
  return c.json(r.rows[0] ?? { valor: {} });
});

adminRouter.put("/config/pagos", async (c) => {
  const body = PagosSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('pagos', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(body.data), actor(c)]);
  await log(actor(c), "editar_pagos", "ajustes:pagos");
  return c.json({ ok: true, valor: body.data });
});

// ─── Procesamiento activo (migración 19): qué tipos × etapas entran a la cola ───────────
const ProcesamientoSchema = z.object({
  tipos_activos: z.array(z.enum(["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"])).min(1),
  etapas_activas: z.array(z.enum(["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada"])).min(1),
  nota: z.string().max(300).optional().default(""),
});

adminRouter.get("/config/procesamiento", async (c) => {
  const r = await pool.query("SELECT valor, updated_at AS \"updatedAt\", updated_by AS \"updatedBy\" FROM ajustes WHERE clave = 'procesamiento'");
  const cola = await pool.query("SELECT count(*)::int AS n FROM cola_auditoria").catch(() => ({ rows: [{ n: null }] }));
  return c.json({ ...(r.rows[0] ?? { valor: {} }), cola: cola.rows[0].n });
});

adminRouter.put("/config/procesamiento", async (c) => {
  const body = ProcesamientoSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('procesamiento', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(body.data), actor(c)]);
  await pool.query("SELECT refresh_financiamiento()").catch(() => null);
  await log(actor(c), "editar_procesamiento", "ajustes:procesamiento", body.data);
  return c.json({ ok: true, valor: body.data });
});

// ─── Bitácora ────────────────────────────────────────────────────────────────
adminRouter.get("/log", async (c) => {
  const r = await pool.query(`SELECT actor, accion, objeto, detalle, created_at AS "createdAt" FROM admin_log ORDER BY created_at DESC LIMIT 100`);
  return c.json({ data: r.rows });
});


// ─── Salud del sistema (para el resumen del panel) ───────────────────────────
adminRouter.get("/salud", async (c) => {
  const [ingesta, proc, ult, pend, sched] = await Promise.all([
    pool.query(`SELECT max(created_at) AS "ultimaIngesta",
                       count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS "ultimas24h",
                       count(*)::int AS total, count(ubigeo)::int AS "conUbigeo"
                FROM convocatorias`),
    pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`),
    pool.query(`SELECT p.ocid, p.finalizado_at AS "finalizadoAt",
                       EXTRACT(EPOCH FROM (p.finalizado_at - p.iniciado_at))::int AS "segundos",
                       cv.objeto AS titulo, a.score
                FROM procesamientos p JOIN convocatorias cv ON cv.ocid = p.ocid
                LEFT JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid)
                WHERE p.estado = 'procesado' ORDER BY p.finalizado_at DESC NULLS LAST LIMIT 5`),
    pool.query(`SELECT count(*) FILTER (WHERE estado = 'pendiente_pago')::int AS "pendientesValidar",
                       count(*) FILTER (WHERE estado IN ('pagada','en_proceso')
                         AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id))::int AS "esperandoContratos"
                FROM contribuciones`),
    pool.query(`SELECT max(iniciado_at) AS "ultimoInicio", max(latido_at) AS "ultimoLatido",
                       count(*) FILTER (WHERE estado = 'procesando')::int AS "activos"
                FROM procesamientos`),
  ]);
  // Relay residencial (VPS Lima): sin él, el orquestador en GCP no obtiene el OCDS.
  const relayUrl = process.env.LOCAL_DOWNLOADER_URL ?? null;
  let relayOk: boolean | null = null;
  if (relayUrl) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(relayUrl.replace(/\/$/, "") + "/health", { signal: ctl.signal }).catch(() => fetch(relayUrl, { signal: ctl.signal }));
      clearTimeout(t); relayOk = r.ok || r.status < 500;
    } catch { relayOk = false; }
  }
  const porEstado = Object.fromEntries(proc.rows.map((r) => [r.estado, r.n]));
  const ultimaIngesta: Date | null = ingesta.rows[0].ultimaIngesta;
  const horasSinIngesta = ultimaIngesta ? (Date.now() - new Date(ultimaIngesta).getTime()) / 36e5 : null;
  return c.json({
    ingesta: { ...ingesta.rows[0], horasSinIngesta, ok: horasSinIngesta !== null && horasSinIngesta < 36 },
    procesamientos: { porEstado, ultimos: ult.rows, ...sched.rows[0] },
    contribuciones: pend.rows[0],
    relay: { url: relayUrl, ok: relayOk },
    generadoEn: new Date().toISOString(),
  });
});

// ─── Dispatcher: ejecutar el Cloud Run Job ahora ─────────────────────────────
// Usa el token de la service account del servicio (metadata server), sin librerías.
adminRouter.post("/dispatcher/run", async (c) => {
  const project = process.env.GCS_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.DISPATCHER_REGION ?? "us-central1";
  const job = process.env.DISPATCHER_JOB ?? "vigia-dispatcher";
  if (!project) return c.json({ error: "no_project" }, 500);
  try {
    const tok = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!tok.ok) return c.json({ error: "no_metadata_token", detail: "solo funciona desplegado en Cloud Run" }, 500);
    const { access_token } = (await tok.json()) as { access_token: string };
    const r = await fetch(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
      method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return c.json({ error: "run_failed", detail: j?.error?.message ?? r.status }, 502);
    await log(actor(c), "dispatcher_run", `job:${job}`, { operation: j?.name });
    return c.json({ ok: true, operation: j?.name ?? null });
  } catch (e) {
    return c.json({ error: "internal", detail: (e as Error).message }, 500);
  }
});

// ─── Re-encolar todos los que quedaron en error ──────────────────────────────
adminRouter.post("/procesamientos/reencolar-errores", async (c) => {
  const r = await pool.query(`UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL WHERE estado = 'error' RETURNING ocid`);
  await log(actor(c), "reencolar_errores", "procesamientos", { n: r.rowCount });
  return c.json({ ok: true, reencolados: r.rowCount });
});

// ─── Re-asignación (Cloud Scheduler) ─────────────────────────────────────────
adminRouter.post("/asignar", async (c) => {
  const r = await pool.query(
    `SELECT id, codigo FROM contribuciones WHERE estado IN ('pagada','en_proceso')
       AND contratos > (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = contribuciones.id)`);
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    const a = await pool.query("SELECT asignar_contribucion($1) AS n", [row.id]);
    if (a.rows[0].n > 0) out[row.codigo] = a.rows[0].n;
  }
  await pool.query("SELECT refresh_financiamiento()");
  return c.json({ asignados: out });
});

// ─── Monitor del dispatcher (procesamientos) ─────────────────────────────────
adminRouter.get("/procesamientos", async (c) => {
  const url = new URL(c.req.url);
  const estado = url.searchParams.get("estado") ?? "";
  const vals: unknown[] = [];
  let where = "";
  if (["encolado", "procesando", "procesado", "error", "pendiente_de_procesamiento", "esperando_documentos"].includes(estado)) { vals.push(estado); where = `WHERE v.estado = $1`; }
  const r = await pool.query(
    `SELECT v.ocid, v.estado, v.fase_actual AS "faseActual", v.fase_index AS "faseIndex", v.intentos,
            v.encolado_at AS "encoladoAt", v.iniciado_at AS "iniciadoAt", v.finalizado_at AS "finalizadoAt",
            v.contribucion_codigo AS "contribucionCodigo", v.financiador, v.financiador_visible AS "financiadorVisible",
            v.ubigeo, v.zona, v.titulo, v.entidad, v.monto_pen::float AS "montoPen", v.alerta_codigo AS "alertaCodigo", v.score, v.banderas::int,
            p.worker, p.error, p.latido_at AS "latidoAt", jsonb_array_length(p.eventos) AS eventos
     FROM procesamientos_publico v JOIN procesamientos p ON p.ocid = v.ocid
     ${where}
     ORDER BY CASE v.estado WHEN 'procesando' THEN 0 WHEN 'error' THEN 1 WHEN 'encolado' THEN 2 ELSE 3 END,
              COALESCE(v.finalizado_at, v.iniciado_at, v.encolado_at) DESC, v.ocid
     LIMIT 200`, vals);
  return c.json({ data: r.rows });
});

// Cobertura (migración 16): qué tenemos de cada mes — record completo, documentos vigentes en GCS,
// clasificación, análisis — más los lotes ingeridos y el estado del bucket según la DB.
let coberturaCache: { at: number; body: unknown } | null = null;
adminRouter.get("/cobertura", async (c) => {
  if (coberturaCache && Date.now() - coberturaCache.at < 60_000) return c.json(coberturaCache.body);
  const [meses, lotes, docs, gcs] = await Promise.all([
    pool.query(`SELECT mes, contratos, con_record AS "conRecord", con_docs AS "conDocs", docs_publicados::int AS "docsPublicados",
                       docs_vigentes::int AS "docsVigentes", clasificados, analizados, en_cola AS "enCola"
                FROM cobertura_resumen()`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id, tipo, estado, total::int, ok::int, fallidos::int, iniciado_at AS "iniciadoAt", finalizado_at AS "finalizadoAt", error
                FROM lotes_ingesta ORDER BY iniciado_at DESC NULLS LAST LIMIT 30`).catch(() => ({ rows: [] })),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE borrado_at IS NULL AND expira_at > now())::int AS vigentes,
                       COALESCE(sum(bytes) FILTER (WHERE borrado_at IS NULL AND expira_at > now()), 0)::bigint AS "bytesVigentes",
                       min(expira_at) FILTER (WHERE borrado_at IS NULL AND expira_at > now()) AS "proximaExpiracion",
                       count(DISTINCT formato) AS formatos
                FROM documentos_gcs`).then((q) => q.rows[0]).catch(() => null),
    pool.query(`SELECT formato, count(*)::int AS n, COALESCE(sum(bytes),0)::bigint AS bytes FROM documentos_gcs
                WHERE borrado_at IS NULL AND expira_at > now() GROUP BY formato ORDER BY n DESC`).catch(() => ({ rows: [] })),
  ]);
  const body = { meses: meses.rows, lotes: lotes.rows, documentos: docs, porFormato: gcs.rows, generadoAt: new Date().toISOString() };
  coberturaCache = { at: Date.now(), body };
  return c.json(body);
});

// Pedidos de descarga (migración 15): qué espera al batch nocturno y qué falló.
adminRouter.get("/pedidos", async (c) => {
  const r = await pool.query(
    `SELECT p.id, p.ocid, p.motivo, p.estado, p.solicitado_at AS "solicitadoAt", p.tomado_at AS "tomadoAt",
            p.atendido_at AS "atendidoAt", p.intentos, p.lote_id AS "loteId", p.error,
            c.objeto AS titulo, e.nombre AS entidad
     FROM pedidos_descarga p
     LEFT JOIN convocatorias c ON ocid_corto(c.ocid) = ocid_corto(p.ocid)
     LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
     ORDER BY CASE p.estado WHEN 'descargando' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'fallido' THEN 2 ELSE 3 END, p.solicitado_at DESC
     LIMIT 200`).catch(() => ({ rows: [] }));
  return c.json({ data: r.rows });
});

// Reabre un pedido fallido (y vuelve a poner el procesamiento a esperar).
adminRouter.post("/pedidos/:id/reintentar", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await pool.query(
    `UPDATE pedidos_descarga SET estado = 'pendiente', intentos = 0, error = NULL, tomado_at = NULL WHERE id = $1 AND estado = 'fallido' RETURNING ocid`, [id]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  await pool.query(`UPDATE procesamientos SET estado = 'esperando_documentos', error = 'esperando documentos: se descargan en el lote nocturno' WHERE ocid = $1 AND estado = 'error'`, [r.rows[0].ocid]);
  await log(actor(c), "reintentar_pedido", `pedido:${id}`, { ocid: r.rows[0].ocid });
  return c.json({ ok: true, ocid: r.rows[0].ocid });
});

adminRouter.post("/procesamientos/:ocid/reencolar", async (c) => {
  const ocid = c.req.param("ocid");
  const r = await pool.query(
    `UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL, fase_actual = NULL, fase_index = NULL
     WHERE ocid = $1 RETURNING ocid`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  await log(actor(c), "reencolar", `procesamiento:${ocid}`);
  return c.json({ ok: true, ocid, estado: "encolado" });
});

// ─── Clasificación tipo × etapa (backend/core/clasificacion.py, migración 13) ───
adminRouter.get("/clasificacion/resumen", async (c) => {
  const [celdas, motivos, validaciones, totales] = await Promise.all([
    pool.query(`
      SELECT COALESCE(tipo_contratacion, 'sin_clasificar') AS tipo, COALESCE(etapa, 'sin_clasificar') AS etapa,
             procesable, count(*)::int AS n
      FROM convocatorias GROUP BY 1, 2, 3 ORDER BY n DESC`),
    pool.query(`
      SELECT motivo_no_procesable AS motivo, count(*)::int AS n
      FROM convocatorias WHERE procesable = false GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    pool.query(`
      SELECT v AS validacion, count(*)::int AS n
      FROM convocatorias, unnest(validaciones_pendientes) v GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE clasificado_at IS NOT NULL)::int AS clasificadas,
             count(*) FILTER (WHERE procesable)::int AS procesables,
             count(*) FILTER (WHERE procesable = false)::int AS "noProcesables",
             (SELECT count(*) FROM procesamientos WHERE estado = 'pendiente_de_procesamiento')::int AS "pendientesDeProcesamiento",
             max(clasificado_at) AS "ultimaClasificacion"
      FROM convocatorias`),
  ]);
  const porTipo: Record<string, number> = {};
  const porEtapa: Record<string, number> = {};
  for (const r of celdas.rows) {
    porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + r.n;
    porEtapa[r.etapa] = (porEtapa[r.etapa] ?? 0) + r.n;
  }
  return c.json({
    totales: totales.rows[0],
    celdas: celdas.rows,            // [{tipo, etapa, procesable, n}]
    porTipo, porEtapa,
    motivosNoProcesable: motivos.rows,
    validacionesPendientes: validaciones.rows,
  });
});
