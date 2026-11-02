import { Hono } from "hono";
import { z } from "zod";
import { poolAdmin as pool } from "../lib/db.js";
import { actor, esRevisor, log } from "../lib/adminlog.js";
import { SIN_CACHE } from "../lib/http.js";
import { mpConfigurado } from "../lib/mercadopago.js";
import { estadoCorreo } from "../lib/correo.js";
import { NOMBRE_PRODUCTO, PRODUCTOS_PAGO, catalogoBase, leerConfig, type ProductoPago } from "../lib/gobservaPlanes.js";
import { ErrorCobro, cancelarPlan, confirmarCobroManual, darCortesia, rechazarCobroManual } from "../lib/gobservaCobros.js";
import { enviarAlertas, enviarRecordatorios, tareasDiarias, vencerPlanes } from "../lib/gobservaAlertas.js";
import { getPagosConfig } from "./contribuciones.js";

/**
 * El panel de Gobserva (2026-11-01), sólo para el admin (trae correos y pagos; el revisor recibe 403 aunque pida
 * directo, como /privacidad):
 *
 *   GET  /admin/gobserva/resumen           ingresos del mes, lo que se cobra cada mes, clientes y pendientes
 *   GET  /admin/gobserva/clientes          planes contratados (con su cuenta), filtrables
 *   GET  /admin/gobserva/cobros            cobros; los de QR o transferencia esperan aquí su confirmación
 *   POST /admin/gobserva/cobros/:n/confirmar | /rechazar
 *   POST /admin/gobserva/cortesia          regalar meses de un plan a una cuenta
 *   POST /admin/gobserva/planes/:codigo/cancelar
 *   GET|PUT /admin/gobserva/config         precios, fundador, medios de pago y los datos del vendedor (RUC variable)
 *   POST /admin/gobserva/tareas            alertas, recordatorios y vencimientos ahora (también el cron de las 7:00)
 *   GET  /admin/gobserva/envios            lo último que se avisó
 */
export const adminGobservaRouter = new Hono();

adminGobservaRouter.use("/gobserva/*", async (c, next) => {
  if (esRevisor(c)) return c.json({ error: "forbidden" }, 403);
  c.header("Cache-Control", SIN_CACHE);
  await next();
});

adminGobservaRouter.get("/gobserva/resumen", async (c) => {
  const [mes, recurrente, clientes, pendientes, alertas, envios] = await Promise.all([
    pool.query(
      `SELECT COALESCE(sum(monto_pen) FILTER (WHERE pagado_at >= date_trunc('month', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima'), 0)::float AS "esteMes",
              COALESCE(sum(monto_pen), 0)::float AS total, count(*)::int AS cobros
         FROM gobserva_cobros WHERE estado = 'pagado'`),
    pool.query(
      `SELECT producto, count(*)::int AS activos, COALESCE(sum(monto_pen) FILTER (WHERE medio = 'tarjeta' AND renovar), 0)::float AS mensual,
              count(*) FILTER (WHERE fundador)::int AS fundadores, count(*) FILTER (WHERE medio = 'cortesia')::int AS cortesias
         FROM gobserva_planes_cliente WHERE estado = 'activa' GROUP BY 1`),
    pool.query(
      `SELECT count(*)::int AS cuentas, count(*) FILTER (WHERE creado_at > now() - interval '7 days')::int AS semana,
              count(*) FILTER (WHERE email_verificado)::int AS verificadas
         FROM gobserva_cuentas WHERE baja_at IS NULL`),
    pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE operacion IS NOT NULL)::int AS "conOperacion" FROM gobserva_cobros WHERE estado = 'pendiente' AND medio <> 'tarjeta'`),
    pool.query(`SELECT count(*) FILTER (WHERE activa)::int AS activas, count(*)::int AS total FROM gobserva_alertas`),
    pool.query(
      `SELECT count(*) FILTER (WHERE estado = 'enviado')::int AS enviados, count(*) FILTER (WHERE estado = 'en_la_web')::int AS "enLaWeb",
              count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos
         FROM gobserva_envios WHERE creado_at > now() - interval '7 days'`),
  ]);
  return c.json({
    ingresos: mes.rows[0],
    porProducto: recurrente.rows.map((r) => ({ ...r, nombre: NOMBRE_PRODUCTO[r.producto as ProductoPago] })),
    mensualTotal: recurrente.rows.reduce((a, r) => a + Number(r.mensual), 0),
    cuentas: clientes.rows[0],
    pendientes: pendientes.rows[0],
    alertas: alertas.rows[0],
    envios: envios.rows[0],
    correoActivo: (await estadoCorreo()).produccion,
    correo: await estadoCorreo(),
    tarjetaActiva: mpConfigurado(),
  });
});

adminGobservaRouter.get("/gobserva/clientes", async (c) => {
  const producto = c.req.query("producto");
  const estado = c.req.query("estado");
  const vals: unknown[] = [];
  const conds: string[] = ["true"];
  if (producto && (PRODUCTOS_PAGO as string[]).includes(producto)) { vals.push(producto); conds.push(`p.producto = $${vals.length}`); }
  if (estado && /^(pendiente|activa|cancelada|vencida|rechazada)$/.test(estado)) { vals.push(estado); conds.push(`p.estado = $${vals.length}`); }
  const r = await pool.query(
    `SELECT p.codigo, p.producto, p.plan, p.medio, p.estado, p.monto_pen::float AS monto, p.monto_regular::float AS regular, p.fundador,
            p.cobros, p.renovar, p.estado_mp AS "estadoMp", p.motivo,
            to_char(p.vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "vigenteHasta",
            to_char(p.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS creado,
            a.email, a.nombre, a.empresa, a.ruc, a.telefono
       FROM gobserva_planes_cliente p JOIN gobserva_cuentas a ON a.firebase_uid = p.firebase_uid
      WHERE ${conds.join(" AND ")} ORDER BY p.creado_at DESC LIMIT 1000`, vals);
  return c.json({ data: r.rows });
});

adminGobservaRouter.get("/gobserva/cobros", async (c) => {
  const estado = c.req.query("estado") ?? "pendiente";
  const vals: unknown[] = [];
  const conds: string[] = ["true"];
  if (/^(pendiente|pagado|rechazado|reembolsado)$/.test(estado)) { vals.push(estado); conds.push(`k.estado = $${vals.length}`); }
  const r = await pool.query(
    `SELECT k.numero, k.medio, k.monto_pen::float AS monto, k.meses, k.estado, k.operacion, k.validado_por AS "validadoPor", k.motivo,
            k.pasarela_ref AS "pasarelaRef",
            to_char(k.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS creado,
            to_char(k.pagado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS pagado,
            p.codigo, p.producto, p.plan, a.email, a.nombre, a.empresa
       FROM gobserva_cobros k JOIN gobserva_planes_cliente p ON p.id = k.plan_id JOIN gobserva_cuentas a ON a.firebase_uid = k.firebase_uid
      WHERE ${conds.join(" AND ")} ORDER BY k.creado_at DESC LIMIT 1000`, vals);
  return c.json({ data: r.rows });
});

const ConfirmarBody = z.object({ operacion: z.string().trim().max(40).optional() });
adminGobservaRouter.post("/gobserva/cobros/:numero/confirmar", async (c) => {
  const numero = c.req.param("numero");
  const b = ConfirmarBody.safeParse(await c.req.json().catch(() => ({})));
  const ok = await confirmarCobroManual(numero, actor(c), b.success ? b.data.operacion : null);
  if (!ok) return c.json({ error: "no_encontrado", detail: "Ese cobro no está pendiente." }, 404);
  await log(actor(c), "gobserva_confirmar_cobro", `gobserva_cobro:${numero}`, {});
  return c.json({ ok: true });
});

const RechazarBody = z.object({ motivo: z.string().trim().min(3).max(300) });
adminGobservaRouter.post("/gobserva/cobros/:numero/rechazar", async (c) => {
  const numero = c.req.param("numero");
  const b = RechazarBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body", detail: "Escribe el motivo." }, 400);
  const ok = await rechazarCobroManual(numero, actor(c), b.data.motivo);
  if (!ok) return c.json({ error: "no_encontrado" }, 404);
  await log(actor(c), "gobserva_rechazar_cobro", `gobserva_cobro:${numero}`, { motivo: b.data.motivo });
  return c.json({ ok: true });
});

const CortesiaBody = z.object({
  email: z.string().trim().email().max(254),
  producto: z.enum(["empleo", "licitaciones", "obras"]),
  plan: z.string().regex(/^[a-z]{3,15}$/),
  meses: z.number().int().min(1).max(24),
});
adminGobservaRouter.post("/gobserva/cortesia", async (c) => {
  const b = CortesiaBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const r = await darCortesia({ ...b.data, actor: actor(c) });
    await log(actor(c), "gobserva_cortesia", `gobserva_plan:${r.codigo}`, { producto: b.data.producto, plan: b.data.plan, meses: b.data.meses });
    return c.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErrorCobro) return c.json({ error: e.codigo, detail: e.message }, e.status);
    throw e;
  }
});

adminGobservaRouter.post("/gobserva/planes/:codigo/cancelar", async (c) => {
  const codigo = c.req.param("codigo");
  const b = z.object({ motivo: z.string().trim().max(300).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const r = await cancelarPlan(codigo, null, (b.success && b.data.motivo) || "Cancelado desde el panel");
  if (!r) return c.json({ error: "no_encontrado" }, 404);
  await log(actor(c), "gobserva_cancelar_plan", `gobserva_plan:${codigo}`, {});
  return c.json({ ok: true, ...r });
});

// ─── Configuración ───────────────────────────────────────────────────────────────────────────────────────────────────

const Precio = z.number().min(0.5).max(100000);
const ConfigBody = z.object({
  vendedor: z.object({
    nombreComercial: z.string().trim().min(2).max(80),
    ruc: z.string().trim().regex(/^((10|15|17|20)\d{9})?$/, "RUC de 11 dígitos o vacío"),
    razonSocial: z.string().trim().max(200),
    direccion: z.string().trim().max(240),
    correo: z.string().trim().email().max(254),
  }),
  medios: z.object({ tarjeta: z.boolean(), yape: z.boolean(), plin: z.boolean(), transferencia: z.boolean() }),
  planes: z.record(
    z.enum(["empleo", "licitaciones", "obras"]),
    z.record(z.string().regex(/^[a-z]{3,15}$/), z.object({
      precio: Precio.optional(),
      fundador: z.object({ precio: Precio, cupo: z.number().int().min(1).max(100000).nullable().optional(), meses: z.number().int().min(1).max(36).nullable().optional() }).nullable().optional(),
      activo: z.boolean().optional(),
    })),
  ),
  aviso: z.string().trim().max(200),
});

adminGobservaRouter.get("/gobserva/config", async (c) => {
  const [config, guardado, pagos] = await Promise.all([
    leerConfig(),
    pool.query(`SELECT valor, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM ajustes WHERE clave = 'gobserva'`),
    getPagosConfig(),
  ]);
  return c.json({
    config,
    base: catalogoBase(),
    guardado: guardado.rows[0] ?? null,
    disponibles: { tarjeta: mpConfigurado(), yape: !!pagos.yape, plin: !!pagos.plin, transferencia: pagos.cuentas.length > 0 },
    correoActivo: (await estadoCorreo()).produccion,
    correo: await estadoCorreo(),
  });
});

adminGobservaRouter.put("/gobserva/config", async (c) => {
  const b = ConfigBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body", campos: b.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })) }, 400);
  const antes = (await pool.query(`SELECT valor FROM ajustes WHERE clave = 'gobserva'`)).rows[0]?.valor ?? null;
  await pool.query(
    `INSERT INTO ajustes (clave, valor, updated_at, updated_by) VALUES ('gobserva', $1, now(), $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(b.data), actor(c)]);
  await log(actor(c), "gobserva_config", "ajustes:gobserva", { antes, despues: b.data });
  return c.json({ ok: true });
});

// ─── Tareas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

adminGobservaRouter.post("/gobserva/tareas", async (c) => {
  const que = c.req.query("solo");
  if (que === "alertas") return c.json(await enviarAlertas());
  if (que === "recordatorios") return c.json({ recordatorios: await enviarRecordatorios() });
  if (que === "vencimientos") return c.json({ vencidos: await vencerPlanes() });
  return c.json(await tareasDiarias());
});

adminGobservaRouter.get("/gobserva/envios", async (c) => {
  const r = await pool.query(
    `SELECT e.id, e.producto, e.tipo, e.asunto, e.n_items AS "nItems", e.estado, e.error,
            to_char(e.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS creado, a.email
       FROM gobserva_envios e LEFT JOIN gobserva_cuentas a ON a.firebase_uid = e.firebase_uid
      ORDER BY e.creado_at DESC LIMIT 200`);
  return c.json({ data: r.rows });
});
