import { Hono, type Context } from "hono";
import { z } from "zod";
import { pool, poolAdmin } from "../lib/db.js";
import { requireAuth, type AuthedUser } from "../lib/auth.js";
import { limiteEscritura } from "../lib/antibots.js";
import { SIN_CACHE } from "../lib/http.js";
import { registrar } from "../lib/registro.js";
import { mpConfigurado } from "../lib/mercadopago.js";
import { correoAbierto } from "../lib/correo.js";
import { getPagosConfig } from "./contribuciones.js";
import {
  HOST_PRODUCTO, LIMITES_GRATIS, NOMBRE_PRODUCTO, PRODUCTOS_PAGO, esProductoPago, leerConfig, limitesDe, planDe, planVigente, type ProductoPago,
} from "../lib/gobservaPlanes.js";
import { ErrorCobro, cancelarPlan, checkoutManual, checkoutTarjeta, registrarOperacion } from "../lib/gobservaCobros.js";
import { enviarAlertas, exportarCsv, probarAlerta, productoConAlertas, validarFiltros } from "../lib/gobservaAlertas.js";
import { avisarPush } from "../lib/gobservaPush.js";
import { embeberLinea, paraTi } from "../lib/afinidad.js";
import type { IaWorkers } from "../lib/rag.js";
import { ENDPOINT_PUSH, pushConfigurado } from "../lib/webpush.js";

/**
 * La cuenta de Gobserva (2026-11-01): una persona de Firebase con su correo real, para los tres productos. Todo lo de
 * aquí exige sesión (Bearer de Firebase) y filtra por el uid del token: nadie ve ni toca lo de otra persona.
 *
 *   GET    /gobserva/cuenta/me?producto=        perfil, planes, límites y uso en ese producto (crea la cuenta al entrar)
 *   GET    /gobserva/cuenta/planes              los planes vigentes en todos los productos (para el MCP)
 *   PUT    /gobserva/cuenta/me                  perfil y datos para el comprobante
 *   DELETE /gobserva/cuenta/me                  borra la cuenta (cancela los cobros; los recibos se guardan)
 *   POST   /gobserva/cuenta/checkout/tarjeta    contrata un plan con tarjeta (suscripción mensual de Mercado Pago)
 *   POST   /gobserva/cuenta/checkout/manual     contrata meses con Yape, Plin o transferencia (los valida el panel)
 *   POST   /gobserva/cuenta/cobros/:numero/operacion   el número de operación de un pago con QR
 *   GET    /gobserva/cuenta/cobros[/:numero]    pagos y recibos
 *   POST   /gobserva/cuenta/planes/:codigo/cancelar
 *   GET|POST /gobserva/cuenta/alertas, PUT|DELETE /alertas/:id, POST /alertas/probar, POST /alertas/:id/enviar
 *   GET    /gobserva/cuenta/bandeja?producto=   lo avisado (correo o, mientras no haya, sólo aquí)
 *   GET|PUT|DELETE /gobserva/cuenta/guardados   plazas, oportunidades y proyectos guardados
 *   GET    /gobserva/cuenta/exportar?producto=&…filtros   la búsqueda en CSV (planes de pago)
 *   GET|POST|DELETE /gobserva/cuenta/push, POST /push/probar   notificaciones en el celular o la computadora (migr. 233)
 *   GET|POST /gobserva/cuenta/lineas, PUT|DELETE /lineas/:id   líneas de negocio de Licitaciones (migr. 264)
 *   GET    /gobserva/cuenta/para-ti?linea=      las oportunidades abiertas por afinidad con una línea (lib/afinidad.ts)
 */
export const gobservaCuentaRouter = new Hono();

gobservaCuentaRouter.use("*", async (c, next) => {
  c.header("Cache-Control", SIN_CACHE);
  await next();
  c.res.headers.set("Cache-Control", SIN_CACHE);
});
gobservaCuentaRouter.use("*", requireAuth);

const Producto = z.enum(["empleo", "licitaciones", "obras"]);
const vacio = (v: unknown) => (v === "" || v === null ? undefined : typeof v === "string" ? v.trim() : v);

/** Crea o actualiza la cuenta con lo que dice el token (correo y si lo verificó). */
async function asegurarCuenta(u: AuthedUser, producto?: ProductoPago): Promise<void> {
  await pool.query(
    `INSERT INTO gobserva_cuentas (firebase_uid, email, email_verificado, producto_origen, ultimo_ingreso_at)
     VALUES ($1, lower($2), $3, $4, now())
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email = EXCLUDED.email, email_verificado = EXCLUDED.email_verificado OR gobserva_cuentas.email_verificado,
           ultimo_ingreso_at = now(), baja_at = NULL`,
    [u.uid, u.email, u.emailVerificado, producto ?? null]);
}

/** Una cuenta de Vigía (usuario con correo sintético) o sin correo no sirve para Gobserva: los avisos van al correo. */
function sinCorreoReal(c: Context, u: AuthedUser): Response | null {
  if (!u.email) return c.json({ error: "sin_correo", detail: "Tu cuenta no tiene correo. Entra con tu correo o con Google." }, 409);
  if (/@vigia\.local$/i.test(u.email)) {
    return c.json({ error: "cuenta_vigia", detail: "Esa es una cuenta de Vigía. Para Gobserva, entra con tu correo o con Google." }, 409);
  }
  return null;
}

function errorCobro(c: Context, e: unknown): Response {
  if (e instanceof ErrorCobro) return c.json({ error: e.codigo, detail: e.message }, e.status);
  throw e;
}

const productoDe = (c: Context): ProductoPago | null => {
  const p = c.req.query("producto");
  return esProductoPago(p) ? p : null;
};

// ─── Perfil ──────────────────────────────────────────────────────────────────────────────────────────────────────────

gobservaCuentaRouter.get("/me", async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const producto = productoDe(c);
  await asegurarCuenta(u, producto ?? undefined);
  const [cuenta, planes, pendientes] = await Promise.all([
    pool.query(
      `SELECT email, email_verificado AS "emailVerificado", nombre, empresa, ruc, razon_social AS "razonSocial",
              direccion_fiscal AS "direccionFiscal", telefono, whatsapp, boletin, to_char(creado_at, 'YYYY-MM-DD') AS creado
         FROM gobserva_cuentas WHERE firebase_uid = $1`, [u.uid]),
    pool.query(
      `SELECT codigo, producto, plan, medio, estado, monto_pen::float AS monto, monto_regular::float AS regular, fundador,
              meses_fundador AS "mesesFundador", cobros, renovar, estado_mp AS "estadoMp",
              to_char(vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS "vigenteHasta",
              to_char(creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado
         FROM gobserva_planes_cliente
        WHERE firebase_uid = $1 AND (estado = 'activa' OR (estado = 'pendiente' AND creado_at > now() - interval '10 days'))
        ORDER BY creado_at DESC`, [u.uid]),
    pool.query(
      `SELECT k.numero, k.medio, k.monto_pen::float AS monto, k.meses, k.operacion, p.producto, p.plan, p.codigo,
              to_char(k.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado
         FROM gobserva_cobros k JOIN gobserva_planes_cliente p ON p.id = k.plan_id
        WHERE k.firebase_uid = $1 AND k.estado = 'pendiente' ORDER BY k.creado_at DESC`, [u.uid]),
  ]);
  const nombres = Object.fromEntries(
    await Promise.all(planes.rows.map(async (p) => [`${p.producto}:${p.plan}`, (await planDe(p.producto, p.plan))?.nombre ?? p.plan])));
  let delProducto: Record<string, unknown> | null = null;
  if (producto) {
    const vigente = await planVigente(u.uid, producto);
    const limites = await limitesDe(producto, vigente?.plan ?? null);
    const usados = (await pool.query<{ alertas: number; guardados: number }>(
      `SELECT (SELECT count(*) FROM gobserva_alertas WHERE firebase_uid = $1 AND producto = $2)::int AS alertas,
              (SELECT count(*) FROM gobserva_guardados WHERE firebase_uid = $1 AND producto = $2)::int AS guardados`,
      [u.uid, producto])).rows[0];
    delProducto = { clave: producto, plan: vigente?.plan ?? null, nombrePlan: vigente ? nombres[`${producto}:${vigente.plan}`] ?? vigente.plan : "Gratis", limites, usados, alertas: productoConAlertas(producto) };
  }
  return c.json({
    cuenta: cuenta.rows[0],
    planes: planes.rows.map((p) => ({ ...p, nombrePlan: nombres[`${p.producto}:${p.plan}`], nombreProducto: NOMBRE_PRODUCTO[p.producto as ProductoPago] })),
    pendientes: pendientes.rows,
    producto: delProducto,
    correoActivo: await correoAbierto(),
  });
});

// ─── Planes vigentes ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los planes vigentes de la persona en todos los productos (los de pago: activos y pagados, con los 3 días de gracia de
 * `planVigente`). Sin crear la cuenta ni exigir correo: lo pregunta el MCP de Gobserva para saber qué cupo le toca, y una
 * cuenta sin plan recibe la lista vacía.
 */
gobservaCuentaRouter.get("/planes", async (c) => {
  const u = c.get("user");
  const vigentes = await Promise.all(PRODUCTOS_PAGO.map(async (producto) => ({ producto, v: await planVigente(u.uid, producto) })));
  return c.json({
    planes: vigentes.flatMap(({ producto, v }) => (v ? [{ producto, plan: v.plan, vigenteHasta: v.vigenteHasta }] : [])),
  });
});

const Ruc = z.preprocess(vacio, z.string().regex(/^(10|15|17|20)\d{9}$/, "RUC de 11 dígitos").optional());
const PerfilBody = z.object({
  nombre: z.preprocess(vacio, z.string().max(120).optional()),
  empresa: z.preprocess(vacio, z.string().max(160).optional()),
  ruc: Ruc,
  razonSocial: z.preprocess(vacio, z.string().max(200).optional()),
  direccionFiscal: z.preprocess(vacio, z.string().max(240).optional()),
  telefono: z.preprocess((v) => (typeof v === "string" ? v.replace(/[\s()-]/g, "") || undefined : vacio(v)), z.string().regex(/^\+?\d{7,15}$/, "Número de 7 a 15 dígitos").optional()),
  whatsapp: z.boolean().optional(),
  boletin: z.boolean().optional(),
});

gobservaCuentaRouter.put("/me", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const p = PerfilBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body", campos: p.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })) }, 400);
  await asegurarCuenta(u);
  const b = p.data;
  await pool.query(
    `UPDATE gobserva_cuentas SET nombre = $2, empresa = $3, ruc = $4, razon_social = $5, direccion_fiscal = $6, telefono = $7,
            whatsapp = COALESCE($8, whatsapp), boletin = COALESCE($9, boletin), actualizado_at = now()
      WHERE firebase_uid = $1`,
    [u.uid, b.nombre ?? null, b.empresa ?? null, b.ruc ?? null, b.razonSocial ?? null, b.direccionFiscal ?? null, b.telefono ?? null, b.whatsapp ?? null, b.boletin ?? null]);
  return c.json({ ok: true });
});

/**
 * Borra la cuenta: cancela lo que se cobra con tarjeta, borra alertas, guardados y lo avisado, y deja la cuenta sin
 * nombre ni contacto. Los recibos y sus datos de facturación se conservan (la ley pide guardar los comprobantes).
 */
gobservaCuentaRouter.delete("/me", limiteEscritura, async (c) => {
  const u = c.get("user");
  const planes = await pool.query<{ codigo: string }>(
    `SELECT codigo FROM gobserva_planes_cliente WHERE firebase_uid = $1 AND estado IN ('activa', 'pendiente')`, [u.uid]);
  for (const p of planes.rows) await cancelarPlan(p.codigo, u.uid, "Borró su cuenta");
  await pool.query(`DELETE FROM gobserva_alertas WHERE firebase_uid = $1`, [u.uid]);
  await pool.query(`DELETE FROM gobserva_guardados WHERE firebase_uid = $1`, [u.uid]);
  await pool.query(`DELETE FROM gobserva_push WHERE firebase_uid = $1`, [u.uid]);
  await poolAdmin.query(`DELETE FROM gobserva_envios WHERE firebase_uid = $1`, [u.uid]);
  await poolAdmin.query(
    `UPDATE gobserva_cuentas SET email = 'baja-' || md5(firebase_uid) || '@gobserva.invalid', email_verificado = false, nombre = NULL,
            empresa = NULL, telefono = NULL, whatsapp = false, boletin = false, baja_at = now(), actualizado_at = now()
      WHERE firebase_uid = $1`, [u.uid]);
  registrar("INFO", "[gobserva] una cuenta pidió su baja");
  return c.json({ ok: true });
});

// ─── Contratar ───────────────────────────────────────────────────────────────────────────────────────────────────────

const TarjetaBody = z.object({
  producto: Producto,
  plan: z.string().regex(/^[a-z]{3,15}$/),
  tarjeta: z.object({
    token: z.string().min(8).max(200),
    paymentMethodId: z.string().min(2).max(40),
    issuerId: z.union([z.string().max(20), z.number()]).optional(),
    email: z.string().trim().email().max(254),
    identificacion: z.object({ tipo: z.string().max(10), numero: z.string().max(20) }).optional(),
    dispositivo: z.string().max(200).optional(),
  }),
});

gobservaCuentaRouter.post("/checkout/tarjeta", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const config = await leerConfig();
  if (!mpConfigurado() || !config.medios.tarjeta) return c.json({ error: "tarjeta_cerrada", detail: "El pago con tarjeta no está disponible ahora. Prueba con Yape." }, 503);
  const p = TarjetaBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body" }, 400);
  await asegurarCuenta(u, p.data.producto);
  try {
    const r = await checkoutTarjeta({ uid: u.uid, producto: p.data.producto, plan: p.data.plan, tarjeta: p.data.tarjeta });
    return c.json({ ok: true, ...r });
  } catch (e) {
    return errorCobro(c, e);
  }
});

const ManualBody = z.object({
  producto: Producto,
  plan: z.string().regex(/^[a-z]{3,15}$/),
  medio: z.enum(["yape", "plin", "transferencia"]),
  meses: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
});

gobservaCuentaRouter.post("/checkout/manual", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const p = ManualBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body" }, 400);
  const [config, pagos] = await Promise.all([leerConfig(), getPagosConfig()]);
  const destino = p.data.medio === "yape" ? pagos.yape : p.data.medio === "plin" ? pagos.plin : pagos.cuentas.length ? { cuentas: pagos.cuentas } : null;
  if (!config.medios[p.data.medio] || !destino) return c.json({ error: "medio_cerrado", detail: "Ese medio de pago no está disponible ahora." }, 503);
  await asegurarCuenta(u, p.data.producto);
  try {
    const r = await checkoutManual({ uid: u.uid, ...p.data });
    return c.json({ ok: true, ...r, destino });
  } catch (e) {
    return errorCobro(c, e);
  }
});

const OperacionBody = z.object({ operacion: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/, "Sólo letras, números y guiones") });

gobservaCuentaRouter.post("/cobros/:numero/operacion", limiteEscritura, async (c) => {
  const u = c.get("user");
  const p = OperacionBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body", detail: p.error.issues[0]?.message }, 400);
  const ok = await registrarOperacion(u.uid, c.req.param("numero"), p.data.operacion);
  return ok ? c.json({ ok: true }) : c.json({ error: "no_encontrado" }, 404);
});

const CancelarBody = z.object({ motivo: z.string().trim().max(300).optional() });

gobservaCuentaRouter.post("/planes/:codigo/cancelar", limiteEscritura, async (c) => {
  const u = c.get("user");
  const b = CancelarBody.safeParse(await c.req.json().catch(() => ({})));
  const r = await cancelarPlan(c.req.param("codigo"), u.uid, (b.success && b.data.motivo) || "Cancelado por quien pagaba");
  return r ? c.json({ ok: true, ...r }) : c.json({ error: "no_encontrado" }, 404);
});

// ─── Pagos y recibos ─────────────────────────────────────────────────────────────────────────────────────────────────

const COLS_COBRO = `k.numero, k.medio, k.monto_pen::float AS monto, k.meses, k.estado, k.operacion, k.motivo,
  to_char(k.creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado,
  to_char(k.pagado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS pagado,
  p.codigo, p.producto, p.plan`;

gobservaCuentaRouter.get("/cobros", async (c) => {
  const u = c.get("user");
  const r = await pool.query(
    `SELECT ${COLS_COBRO} FROM gobserva_cobros k JOIN gobserva_planes_cliente p ON p.id = k.plan_id
      WHERE k.firebase_uid = $1 ORDER BY k.creado_at DESC LIMIT 200`, [u.uid]);
  return c.json({ data: r.rows });
});

gobservaCuentaRouter.get("/cobros/:numero", async (c) => {
  const u = c.get("user");
  const r = await pool.query(
    `SELECT ${COLS_COBRO}, a.email, a.nombre, a.empresa, a.ruc, a.razon_social AS "razonSocial", a.direccion_fiscal AS "direccionFiscal"
       FROM gobserva_cobros k JOIN gobserva_planes_cliente p ON p.id = k.plan_id JOIN gobserva_cuentas a ON a.firebase_uid = k.firebase_uid
      WHERE k.firebase_uid = $1 AND k.numero = $2`, [u.uid, c.req.param("numero")]);
  const k = r.rows[0];
  if (!k) return c.json({ error: "no_encontrado" }, 404);
  const [config, plan] = await Promise.all([leerConfig(), planDe(k.producto, k.plan)]);
  return c.json({ ...k, nombrePlan: plan?.nombre ?? k.plan, nombreProducto: NOMBRE_PRODUCTO[k.producto as ProductoPago], vendedor: config.vendedor });
});

// ─── Alertas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const AlertaBody = z.object({
  producto: Producto,
  nombre: z.string().trim().min(1).max(80),
  filtros: z.record(z.union([z.string().max(120), z.number(), z.boolean()])).refine((f) => Object.keys(f).length <= 15),
  frecuencia: z.enum(["diaria", "semanal"]).default("semanal"),
});
const AlertaCambio = z.object({
  nombre: z.string().trim().min(1).max(80).optional(),
  filtros: AlertaBody.shape.filtros.optional(),
  frecuencia: z.enum(["diaria", "semanal"]).optional(),
  activa: z.boolean().optional(),
});

const tokenPausa = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

async function revisarLimites(u: AuthedUser, producto: ProductoPago, frecuencia: "diaria" | "semanal" | undefined, nueva: boolean): Promise<{ error: string; detail: string } | null> {
  const vigente = await planVigente(u.uid, producto);
  const limites = vigente ? await limitesDe(producto, vigente.plan) : LIMITES_GRATIS;
  if (frecuencia && !limites.frecuencias.includes(frecuencia)) {
    return { error: "plan_requerido", detail: "Las alertas diarias son de los planes de pago. Con el plan gratis llegan una vez por semana." };
  }
  if (nueva) {
    const n = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM gobserva_alertas WHERE firebase_uid = $1 AND producto = $2`, [u.uid, producto])).rows[0].n;
    if (n >= limites.alertas) {
      return { error: "limite_alertas", detail: vigente ? `Tu plan permite ${limites.alertas} alertas en este producto.` : "El plan gratis permite 1 alerta. Con un plan de pago tienes más, y cada mañana." };
    }
  }
  return null;
}

gobservaCuentaRouter.get("/alertas", async (c) => {
  const u = c.get("user");
  const producto = productoDe(c);
  const r = await pool.query(
    `SELECT id, producto, nombre, filtros, frecuencia, activa, ultimo_conteo AS "ultimoConteo",
            to_char(ultimo_envio_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS "ultimoEnvio",
            to_char(creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado
       FROM gobserva_alertas WHERE firebase_uid = $1 AND ($2::text IS NULL OR producto = $2) ORDER BY creado_at DESC`,
    [u.uid, producto]);
  return c.json({ data: r.rows });
});

gobservaCuentaRouter.post("/alertas", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const p = AlertaBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body" }, 400);
  const b = p.data;
  if (!productoConAlertas(b.producto)) return c.json({ error: "sin_alertas", detail: "Las alertas de este producto llegan pronto." }, 409);
  if (!validarFiltros(b.producto, b.filtros)) return c.json({ error: "filtros_invalidos", detail: "Revisa los filtros de la búsqueda." }, 400);
  await asegurarCuenta(u, b.producto);
  const limite = await revisarLimites(u, b.producto, b.frecuencia, true);
  if (limite) return c.json(limite, 402);
  const r = await pool.query<{ id: number }>(
    `INSERT INTO gobserva_alertas (firebase_uid, producto, nombre, filtros, frecuencia, token_pausa) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [u.uid, b.producto, b.nombre, JSON.stringify(b.filtros), b.frecuencia, tokenPausa()]);
  return c.json({ ok: true, id: r.rows[0].id }, 201);
});

gobservaCuentaRouter.post("/alertas/probar", limiteEscritura, async (c) => {
  const b = z.object({ producto: Producto, filtros: AlertaBody.shape.filtros }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const r = await probarAlerta(b.data.producto, b.data.filtros);
  return r ? c.json(r) : c.json({ error: "filtros_invalidos" }, 400);
});

gobservaCuentaRouter.put("/alertas/:id", limiteEscritura, async (c) => {
  const u = c.get("user");
  const id = Number(c.req.param("id"));
  const p = AlertaCambio.safeParse(await c.req.json().catch(() => null));
  if (!Number.isInteger(id) || !p.success) return c.json({ error: "invalid_body" }, 400);
  const actual = (await pool.query<{ producto: ProductoPago }>(`SELECT producto FROM gobserva_alertas WHERE id = $1 AND firebase_uid = $2`, [id, u.uid])).rows[0];
  if (!actual) return c.json({ error: "no_encontrado" }, 404);
  if (p.data.filtros && !validarFiltros(actual.producto, p.data.filtros)) return c.json({ error: "filtros_invalidos" }, 400);
  const limite = await revisarLimites(u, actual.producto, p.data.frecuencia, false);
  if (limite) return c.json(limite, 402);
  await pool.query(
    `UPDATE gobserva_alertas SET nombre = COALESCE($3, nombre), filtros = COALESCE($4, filtros), frecuencia = COALESCE($5, frecuencia),
            activa = COALESCE($6, activa), actualizado_at = now()
      WHERE id = $1 AND firebase_uid = $2`,
    [id, u.uid, p.data.nombre ?? null, p.data.filtros ? JSON.stringify(p.data.filtros) : null, p.data.frecuencia ?? null, p.data.activa ?? null]);
  return c.json({ ok: true });
});

gobservaCuentaRouter.delete("/alertas/:id", limiteEscritura, async (c) => {
  const u = c.get("user");
  const r = await pool.query(`DELETE FROM gobserva_alertas WHERE id = $1 AND firebase_uid = $2`, [Number(c.req.param("id")) || 0, u.uid]);
  return (r.rowCount ?? 0) ? c.json({ ok: true }) : c.json({ error: "no_encontrado" }, 404);
});

// ─── Líneas de negocio y «Para ti» (Licitaciones, migración 264) ─────────────────────────────────────────────────────

const TIPOS_LINEA = ["bienes", "servicios", "obras", "consultoria"] as const;
const LineaBody = z.object({
  nombre: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().min(3).max(1000),
  palabras: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  regiones: z.array(z.string().regex(/^\d{2}$/)).max(25).default([]),
  tipos: z.array(z.enum(TIPOS_LINEA)).max(4).default([]),
  montoMin: z.number().min(0).max(1e12).nullable().optional(),
  montoMax: z.number().min(0).max(1e12).nullable().optional(),
});

/** Cuántas líneas y cuántas oportunidades le tocan según su plan de Licitaciones (Obras viene con él). */
async function limitesLineas(uid: string): Promise<{ lineas: number; paraTi: number; plan: string | null }> {
  const vigente = await planVigente(uid, "licitaciones");
  const l = await limitesDe("licitaciones", vigente?.plan ?? null);
  return { lineas: l.lineas, paraTi: l.paraTi, plan: vigente?.plan ?? null };
}

gobservaCuentaRouter.get("/lineas", async (c) => {
  const u = c.get("user");
  const [r, limites] = await Promise.all([
    pool.query(
      `SELECT id, nombre, descripcion, palabras, regiones, tipos, monto_min::float AS "montoMin", monto_max::float AS "montoMax",
              embedding IS NOT NULL AS lista, to_char(actualizado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS actualizada
         FROM gobserva_lineas WHERE firebase_uid = $1 ORDER BY creado_at`,
      [u.uid]),
    limitesLineas(u.uid),
  ]);
  return c.json({ data: r.rows, limites });
});

/** Guarda una línea (nueva o la `id`) con su embedding. Sin Workers AI no se guarda: sin él, «Para ti» no la puede usar. */
async function guardarLinea(c: Context, id: number | null): Promise<Response> {
  const u = c.get("user");
  const p = LineaBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body", detail: "Revisa la línea: un nombre y qué vendes, en tus palabras." }, 400);
  const b = p.data;
  if (b.montoMin != null && b.montoMax != null && b.montoMin > b.montoMax) return c.json({ error: "invalid_body", detail: "El monto mínimo pasa al máximo." }, 400);
  const ia = (c.env as { AI?: IaWorkers } | undefined)?.AI;
  if (!ia) return c.json({ error: "sin_ia", detail: "No pudimos guardar tu línea ahora. Vuelve a intentarlo en un momento." }, 503);
  await asegurarCuenta(u, "licitaciones");
  if (id == null) {
    const lim = await limitesLineas(u.uid);
    const n = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM gobserva_lineas WHERE firebase_uid = $1`, [u.uid])).rows[0].n;
    if (n >= lim.lineas) {
      return c.json({ error: "limite", detail: `Tu plan permite ${lim.lineas === 1 ? "1 línea de negocio" : `${lim.lineas} líneas de negocio`}. Con un plan mayor puedes sumar más.` }, 402);
    }
  }
  const emb = await embeberLinea(ia, b).catch(() => null);
  if (!emb) return c.json({ error: "sin_ia", detail: "No pudimos leer tu línea ahora. Vuelve a intentarlo en un momento." }, 503);
  const vals = [u.uid, b.nombre, b.descripcion, b.palabras, b.regiones, b.tipos, b.montoMin ?? null, b.montoMax ?? null, emb];
  if (id == null) {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO gobserva_lineas (firebase_uid, nombre, descripcion, palabras, regiones, tipos, monto_min, monto_max, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::halfvec) RETURNING id`, vals);
    return c.json({ ok: true, id: r.rows[0].id }, 201);
  }
  const r = await pool.query(
    `UPDATE gobserva_lineas SET nombre = $2, descripcion = $3, palabras = $4, regiones = $5, tipos = $6, monto_min = $7, monto_max = $8,
            embedding = $9::halfvec, actualizado_at = now()
      WHERE id = $10 AND firebase_uid = $1`, [...vals, id]);
  return (r.rowCount ?? 0) ? c.json({ ok: true, id }) : c.json({ error: "no_encontrado" }, 404);
}

gobservaCuentaRouter.post("/lineas", limiteEscritura, (c) => guardarLinea(c, null));
gobservaCuentaRouter.put("/lineas/:id", limiteEscritura, (c) => {
  const id = Number(c.req.param("id"));
  return Number.isInteger(id) && id > 0 ? guardarLinea(c, id) : Promise.resolve(c.json({ error: "no_encontrado" }, 404));
});
gobservaCuentaRouter.delete("/lineas/:id", limiteEscritura, async (c) => {
  const u = c.get("user");
  const r = await pool.query(`DELETE FROM gobserva_lineas WHERE id = $1 AND firebase_uid = $2`, [Number(c.req.param("id")) || 0, u.uid]);
  return (r.rowCount ?? 0) ? c.json({ ok: true }) : c.json({ error: "no_encontrado" }, 404);
});

/** Las oportunidades abiertas de una línea, de la más parecida a lo que vende la empresa a la menos. */
gobservaCuentaRouter.get("/para-ti", async (c) => {
  const u = c.get("user");
  const linea = Number(c.req.query("linea"));
  if (!Number.isInteger(linea) || linea <= 0) return c.json({ error: "invalid_query" }, 400);
  const lim = await limitesLineas(u.uid);
  const r = await paraTi(u.uid, linea, lim.paraTi);
  if (!r) return c.json({ error: "no_encontrado" }, 404);
  return c.json({ ...r, limite: lim.paraTi, plan: lim.plan });
});

/** «Enviar ahora»: avisa ya lo nuevo de una alerta (una vez por hora), para probarla. */
gobservaCuentaRouter.post("/alertas/:id/enviar", limiteEscritura, async (c) => {
  const u = c.get("user");
  const id = Number(c.req.param("id"));
  const a = (await pool.query<{ reciente: boolean }>(
    `SELECT (ultimo_envio_at > now() - interval '1 hour') AS reciente FROM gobserva_alertas WHERE id = $1 AND firebase_uid = $2 AND activa`,
    [id, u.uid])).rows[0];
  if (!a) return c.json({ error: "no_encontrado" }, 404);
  if (a.reciente) return c.json({ error: "muy_seguido", detail: "Esta alerta ya avisó en la última hora." }, 429);
  const r = await enviarAlertas({ soloAlerta: id });
  return c.json({ ok: true, ...r });
});

gobservaCuentaRouter.get("/bandeja", async (c) => {
  const u = c.get("user");
  const producto = productoDe(c);
  const r = await pool.query(
    `SELECT id, producto, tipo, asunto, items, n_items AS "nItems", estado,
            to_char(creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS creado
       FROM gobserva_envios WHERE firebase_uid = $1 AND ($2::text IS NULL OR producto = $2) ORDER BY creado_at DESC LIMIT 30`,
    [u.uid, producto]);
  return c.json({ data: r.rows });
});

// ─── Notificaciones ──────────────────────────────────────────────────────────────────────────────────────────────────

const PushBody = z.object({
  producto: Producto,
  suscripcion: z.object({
    endpoint: z.string().url().max(1000).regex(ENDPOINT_PUSH, "Ese servicio de notificaciones no es de un navegador conocido."),
    keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/) }),
  }),
  dispositivo: z.string().trim().max(120).optional(),
});

/** La llave pública para suscribirse y los dispositivos que la persona activó (en un producto o en todos). */
gobservaCuentaRouter.get("/push", async (c) => {
  const u = c.get("user");
  const r = await pool.query(
    `SELECT id, producto, dispositivo, to_char(creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado,
            to_char(ultimo_ok_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS "ultimoOk"
       FROM gobserva_push WHERE firebase_uid = $1 AND ($2::text IS NULL OR producto = $2) ORDER BY creado_at DESC`,
    [u.uid, productoDe(c)]);
  return c.json({ clave: pushConfigurado() ? process.env.VAPID_PUBLIC_KEY : null, dispositivos: r.rows });
});

/** Activa las notificaciones de este navegador (si ya estaba, lo pasa a esta cuenta y este producto). */
gobservaCuentaRouter.post("/push", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const b = PushBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body", detail: b.error.issues[0]?.message ?? "Datos inválidos" }, 400);
  if (!pushConfigurado()) return c.json({ error: "push_cerrado", detail: "Las notificaciones no están disponibles todavía." }, 503);
  await asegurarCuenta(u, b.data.producto);
  const { endpoint, keys } = b.data.suscripcion;
  await pool.query(
    `INSERT INTO gobserva_push (firebase_uid, producto, endpoint, p256dh, auth, dispositivo)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid, producto = EXCLUDED.producto, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, dispositivo = EXCLUDED.dispositivo, fallos = 0`,
    [u.uid, b.data.producto, endpoint, keys.p256dh, keys.auth, b.data.dispositivo ?? null]);
  // Hasta 10 dispositivos por persona: el más viejo sale.
  await pool.query(
    `DELETE FROM gobserva_push WHERE firebase_uid = $1 AND id NOT IN (SELECT id FROM gobserva_push WHERE firebase_uid = $1 ORDER BY creado_at DESC LIMIT 10)`,
    [u.uid]);
  return c.json({ ok: true }, 201);
});

gobservaCuentaRouter.delete("/push", limiteEscritura, async (c) => {
  const u = c.get("user");
  const b = z.object({ endpoint: z.string().max(1000).optional(), id: z.number().int().positive().optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!b.success || (!b.data.endpoint && !b.data.id)) return c.json({ error: "invalid_body" }, 400);
  await pool.query(`DELETE FROM gobserva_push WHERE firebase_uid = $1 AND (endpoint = $2 OR id = $3)`, [u.uid, b.data.endpoint ?? "", b.data.id ?? 0]);
  return c.json({ ok: true });
});

/** Una notificación de prueba a los dispositivos de la persona en ese producto. */
gobservaCuentaRouter.post("/push/probar", limiteEscritura, async (c) => {
  const u = c.get("user");
  const b = z.object({ producto: Producto }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "invalid_body" }, 400);
  const enviados = await avisarPush(u.uid, b.data.producto, {
    titulo: "Así te llegarán tus alertas",
    cuerpo: "Cuando una alerta traiga algo nuevo, te avisamos aquí. Toca para ver tus alertas.",
    url: `https://${HOST_PRODUCTO[b.data.producto]}/cuenta?tab=alertas`,
    tag: "prueba",
  });
  return c.json({ ok: true, enviados });
});

// ─── Guardados ───────────────────────────────────────────────────────────────────────────────────────────────────────

const GuardadoBody = z.object({
  producto: Producto,
  tipo: z.enum(["plaza", "oportunidad", "proyecto", "empresa", "entidad"]),
  ref: z.string().trim().min(1).max(80),
  titulo: z.string().trim().max(300).optional(),
  datos: z.record(z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).refine((d) => JSON.stringify(d).length <= 1800).optional(),
  estado: z.enum(["guardada", "postule", "entrevista", "descartada", "preparando", "presentada", "ganada", "perdida"]).optional(),
  nota: z.string().max(1000).optional(),
  recordar: z.boolean().optional(),
});

gobservaCuentaRouter.get("/guardados", async (c) => {
  const u = c.get("user");
  const producto = productoDe(c);
  const r = await pool.query(
    `SELECT producto, tipo, ref, titulo, datos, estado, nota, recordar,
            to_char(creado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS creado,
            to_char(actualizado_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS actualizado
       FROM gobserva_guardados WHERE firebase_uid = $1 AND ($2::text IS NULL OR producto = $2) ORDER BY creado_at DESC LIMIT 3000`,
    [u.uid, producto]);
  return c.json({ data: r.rows });
});

gobservaCuentaRouter.put("/guardados", limiteEscritura, async (c) => {
  const u = c.get("user");
  const malo = sinCorreoReal(c, u);
  if (malo) return malo;
  const p = GuardadoBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_body" }, 400);
  const b = p.data;
  await asegurarCuenta(u, b.producto);
  const existe = (await pool.query(`SELECT 1 FROM gobserva_guardados WHERE firebase_uid = $1 AND producto = $2 AND tipo = $3 AND ref = $4`, [u.uid, b.producto, b.tipo, b.ref])).rows.length > 0;
  if (!existe) {
    const vigente = await planVigente(u.uid, b.producto);
    const limites = await limitesDe(b.producto, vigente?.plan ?? null);
    const n = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM gobserva_guardados WHERE firebase_uid = $1 AND producto = $2`, [u.uid, b.producto])).rows[0].n;
    if (n >= limites.guardados) {
      return c.json({ error: "limite_guardados", detail: `Tu plan permite guardar ${limites.guardados}. Con un plan de pago guardas muchos más.` }, 402);
    }
  }
  await pool.query(
    `INSERT INTO gobserva_guardados (firebase_uid, producto, tipo, ref, titulo, datos, estado, nota, recordar)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'::jsonb), COALESCE($7, 'guardada'), $8, COALESCE($9, true))
     ON CONFLICT (firebase_uid, producto, tipo, ref) DO UPDATE
       SET titulo = COALESCE(EXCLUDED.titulo, gobserva_guardados.titulo),
           datos = CASE WHEN $6::jsonb IS NULL THEN gobserva_guardados.datos ELSE EXCLUDED.datos END,
           estado = COALESCE($7, gobserva_guardados.estado),
           nota = COALESCE($8, gobserva_guardados.nota),
           recordar = COALESCE($9, gobserva_guardados.recordar),
           actualizado_at = now()`,
    [u.uid, b.producto, b.tipo, b.ref, b.titulo ?? null, b.datos ? JSON.stringify(b.datos) : null, b.estado ?? null, b.nota ?? null, b.recordar ?? null]);
  return c.json({ ok: true, nuevo: !existe });
});

gobservaCuentaRouter.delete("/guardados", limiteEscritura, async (c) => {
  const u = c.get("user");
  const p = GuardadoBody.pick({ producto: true, tipo: true, ref: true }).safeParse({ producto: c.req.query("producto"), tipo: c.req.query("tipo"), ref: c.req.query("ref") });
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  await pool.query(`DELETE FROM gobserva_guardados WHERE firebase_uid = $1 AND producto = $2 AND tipo = $3 AND ref = $4`, [u.uid, p.data.producto, p.data.tipo, p.data.ref]);
  return c.json({ ok: true });
});

// ─── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

gobservaCuentaRouter.get("/exportar", async (c) => {
  const u = c.get("user");
  const producto = productoDe(c);
  if (!producto) return c.json({ error: "invalid_query" }, 400);
  const vigente = await planVigente(u.uid, producto);
  const limites = await limitesDe(producto, vigente?.plan ?? null);
  if (!limites.csv) return c.json({ error: "plan_requerido", detail: "La descarga en CSV es de los planes de pago." }, 402);
  const { producto: _p, ...filtros } = c.req.query();
  const r = await exportarCsv(producto, filtros, limites.filasCsv);
  if (!r) return c.json({ error: "filtros_invalidos" }, 400);
  registrar("INFO", `[gobserva] CSV de ${producto}: ${r.filas} filas`);
  const fecha = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  return new Response(r.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gobserva-${producto}-${fecha}.csv"`,
      "Cache-Control": SIN_CACHE,
      "X-Filas": String(r.filas),
    },
  });
});

export const PRODUCTOS_CUENTA = PRODUCTOS_PAGO;
