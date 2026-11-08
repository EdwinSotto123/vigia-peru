/**
 * Cobros de los planes de Gobserva (2026-11-01): con tarjeta (suscripción mensual de Mercado Pago, la misma integración
 * de los aportes de Vigía: lib/mercadopago.ts), con Yape, Plin o transferencia (meses por adelantado que valida el
 * panel) y de cortesía (el panel regala meses).
 *
 * Un plan se crea `pendiente` con su código GOB-AAAA-NNNNNN (external_reference en Mercado Pago). Con tarjeta, si Mercado
 * Pago autoriza la suscripción, el plan queda activo con 3 días provisorios hasta que llegue el primer cobro por el
 * webhook (routes/pagos.ts deriva aquí lo que tiene referencia GOB-); cada cobro aprobado suma un mes y genera su recibo
 * GR-AAAA-NNNNNN. Al activarse un plan, el que estaba activo en ese producto se cierra (cambio de plan) y su suscripción
 * se cancela en Mercado Pago. Todo lo que activa o cobra va por el rol del panel (poolAdmin).
 */
import type { PoolClient } from "pg";
import { poolAdmin } from "./db.js";
import { registrar } from "./registro.js";
import {
  ErrorMp, cambiarMontoSuscripcion, cancelarSuscripcion, crearSuscripcion, cuentaPropia, type CobroMp, type PagoMp,
  type SuscripcionMp, type Tarjeta,
} from "./mercadopago.js";
import { HOST_PRODUCTO, NOMBRE_PRODUCTO, montoPorMeses, planDe, precioNuevo, round2, type MedioPago, type ProductoPago } from "./gobservaPlanes.js";
import { avisarRecibo } from "./gobservaAlertas.js";

export const esCodigoGobserva = (ref: unknown): ref is string => typeof ref === "string" && /^GOB-\d{4}-\d{6,8}$/.test(ref);

export class ErrorCobro extends Error {
  constructor(public status: 400 | 402 | 403 | 404 | 409 | 429 | 503, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const MENSAJE_RECHAZO = "Tu banco o Mercado Pago no aprobó el pago. Revisa los datos, prueba con otra tarjeta o paga con Yape.";

async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await poolAdmin.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const nuevoCodigo = async (c: PoolClient) =>
  (await c.query<{ v: string }>(`SELECT 'GOB-' || to_char(now() AT TIME ZONE 'America/Lima', 'YYYY') || '-' || lpad(nextval('gobserva_plan_seq')::text, 6, '0') AS v`)).rows[0].v;
const nuevoRecibo = async (c: PoolClient) =>
  (await c.query<{ v: string }>(`SELECT 'GR-' || to_char(now() AT TIME ZONE 'America/Lima', 'YYYY') || '-' || lpad(nextval('gobserva_recibo_seq')::text, 6, '0') AS v`)).rows[0].v;

/** Muchos intentos seguidos de una misma cuenta (quien prueba tarjetas): 4 en 10 minutos. */
async function frenarIntentos(uid: string): Promise<void> {
  const r = await poolAdmin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM gobserva_planes_cliente WHERE firebase_uid = $1 AND creado_at > now() - interval '10 minutes'`, [uid]);
  if ((r.rows[0]?.n ?? 0) >= 4) throw new ErrorCobro(429, "muchos_intentos", "Hiciste varios intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
}

interface Preparado {
  id: number;
  codigo: string;
  monto: number;
  regular: number;
  fundador: boolean;
  mesesFundador: number | null;
  nombrePlan: string;
}

/**
 * Crea el plan pendiente: valida que el plan se venda, calcula el precio (el de fundador si corresponde) y deja sin
 * efecto otro pendiente de la misma cuenta y producto. Si ya tiene ese mismo plan activo, no hay nada que comprar.
 */
async function prepararPlan(uid: string, producto: ProductoPago, planId: string, medio: MedioPago): Promise<Preparado> {
  const plan = await planDe(producto, planId);
  if (!plan || (!plan.activo && medio !== "cortesia")) throw new ErrorCobro(404, "plan_no_disponible", "Ese plan no está disponible.");
  const precio = await precioNuevo(plan);
  return enTransaccion(async (c) => {
    const activo = (await c.query<{ plan: string }>(
      `SELECT plan FROM gobserva_planes_cliente
        WHERE firebase_uid = $1 AND producto = $2 AND estado = 'activa' AND (vigente_hasta IS NULL OR vigente_hasta > now()) AND renovar`,
      [uid, producto])).rows[0];
    if (activo?.plan === planId && medio === "tarjeta") throw new ErrorCobro(409, "ya_tienes_este_plan", "Ya tienes este plan activo.");
    await c.query(
      `UPDATE gobserva_planes_cliente SET estado = 'rechazada', motivo = 'Reemplazado por un pago nuevo', actualizado_at = now()
        WHERE firebase_uid = $1 AND producto = $2 AND estado = 'pendiente'`, [uid, producto]);
    await c.query(
      `UPDATE gobserva_cobros SET estado = 'rechazado', motivo = 'Reemplazado por un pago nuevo'
        WHERE firebase_uid = $1 AND estado = 'pendiente'
          AND plan_id IN (SELECT id FROM gobserva_planes_cliente WHERE firebase_uid = $1 AND producto = $2)`, [uid, producto]);
    const codigo = await nuevoCodigo(c);
    const monto = medio === "cortesia" ? 0 : precio.monto;
    const r = await c.query<{ id: number }>(
      `INSERT INTO gobserva_planes_cliente (codigo, firebase_uid, producto, plan, medio, estado, monto_pen, monto_regular, fundador, meses_fundador)
       VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, $7, $8, $9) RETURNING id`,
      [codigo, uid, producto, planId, medio, monto, precio.regular, precio.fundador && medio !== "cortesia", precio.mesesFundador]);
    return { id: r.rows[0].id, codigo, monto, regular: precio.regular, fundador: precio.fundador, mesesFundador: precio.mesesFundador, nombrePlan: plan.nombre };
  });
}

/**
 * Activa un plan hasta `hasta` (SQL): cierra el que estaba activo en ese producto (cambio de plan) y devuelve las
 * suscripciones de Mercado Pago que hay que cancelar.
 */
async function activar(c: PoolClient, planId: number, hasta: string, vals: unknown[] = []): Promise<string[]> {
  const p = (await c.query<{ uid: string; producto: string }>(`SELECT firebase_uid AS uid, producto FROM gobserva_planes_cliente WHERE id = $1`, [planId])).rows[0];
  const viejos = await c.query<{ preapproval_id: string | null }>(
    `UPDATE gobserva_planes_cliente SET estado = 'cancelada', renovar = false, cancelada_at = now(), motivo = 'Cambió de plan', actualizado_at = now()
      WHERE firebase_uid = $1 AND producto = $2 AND estado = 'activa' AND id <> $3 RETURNING preapproval_id`,
    [p.uid, p.producto, planId]);
  await c.query(
    `UPDATE gobserva_planes_cliente SET estado = 'activa', vigente_hasta = ${hasta}, actualizado_at = now() WHERE id = $1`,
    [planId, ...vals]);
  return viejos.rows.map((r) => r.preapproval_id).filter((x): x is string => !!x);
}

async function cancelarEnMp(ids: string[]): Promise<void> {
  for (const id of ids) {
    await cancelarSuscripcion(id).catch((e) => registrar("WARNING", `[gobserva] no se pudo cancelar la suscripción ${id} en Mercado Pago: ${(e as Error).message}`));
  }
}

// ─── Tarjeta ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function checkoutTarjeta(a: { uid: string; producto: ProductoPago; plan: string; tarjeta: Tarjeta }): Promise<{ codigo: string; estado: string; vigenteHasta: string | null; monto: number }> {
  await frenarIntentos(a.uid);
  const p = await prepararPlan(a.uid, a.producto, a.plan, "tarjeta");
  let s: SuscripcionMp;
  try {
    s = await crearSuscripcion(a.tarjeta, p.monto, p.codigo, `https://${HOST_PRODUCTO[a.producto]}/cuenta`, `${NOMBRE_PRODUCTO[a.producto]}: plan ${p.nombrePlan}`);
  } catch (e) {
    const detalle = e instanceof ErrorMp ? `Mercado Pago ${e.status}: ${JSON.stringify(e.cuerpo).slice(0, 200)}` : (e as Error).message;
    await poolAdmin.query(`UPDATE gobserva_planes_cliente SET estado = 'rechazada', motivo = left($2, 300), actualizado_at = now() WHERE id = $1`, [p.id, detalle]);
    registrar("WARNING", `[gobserva] ${p.codigo}: suscripción rechazada (${detalle})`);
    throw new ErrorCobro(402, "pago_rechazado", MENSAJE_RECHAZO);
  }
  const ok = s.status === "authorized";
  const cancelar = await enTransaccion(async (c) => {
    await c.query(`UPDATE gobserva_planes_cliente SET preapproval_id = $2, estado_mp = $3, actualizado_at = now() WHERE id = $1`, [p.id, s.id, s.status]);
    // Autorizada: activa ya, con 3 días provisorios hasta que el webhook confirme el primer cobro.
    return ok ? activar(c, p.id, `now() + interval '3 days'`) : [];
  });
  await cancelarEnMp(cancelar);
  const r = await poolAdmin.query<{ estado: string; vigente: string | null }>(
    `SELECT estado, to_char(vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS vigente FROM gobserva_planes_cliente WHERE id = $1`, [p.id]);
  return { codigo: p.codigo, estado: r.rows[0]?.estado ?? "pendiente", vigenteHasta: r.rows[0]?.vigente ?? null, monto: p.monto };
}

// ─── Yape, Plin y transferencia ───────────────────────────────────────────────────────────────────────────────────────

export async function checkoutManual(a: { uid: string; producto: ProductoPago; plan: string; medio: "yape" | "plin" | "transferencia"; meses: number }) {
  await frenarIntentos(a.uid);
  const p = await prepararPlan(a.uid, a.producto, a.plan, a.medio);
  const monto = montoPorMeses({ monto: p.monto, regular: p.regular, fundador: p.fundador, mesesFundador: p.mesesFundador }, a.meses);
  const numero = await enTransaccion(async (c) => {
    const n = await nuevoRecibo(c);
    await c.query(
      `INSERT INTO gobserva_cobros (numero, plan_id, firebase_uid, medio, monto_pen, meses, estado) VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')`,
      [n, p.id, a.uid, a.medio, monto, a.meses]);
    return n;
  });
  return { codigo: p.codigo, numero, monto, meses: a.meses, medio: a.medio };
}

/** Quien pagó con QR escribe su número de operación: el panel lo busca en su Yape o su banco. */
export async function registrarOperacion(uid: string, numero: string, operacion: string): Promise<boolean> {
  const r = await poolAdmin.query(
    `UPDATE gobserva_cobros SET operacion = $3 WHERE numero = $1 AND firebase_uid = $2 AND estado = 'pendiente' AND medio <> 'tarjeta'`,
    [numero, uid, operacion]);
  return (r.rowCount ?? 0) > 0;
}

/** El panel confirma un pago con QR o transferencia: el plan suma esos meses y se activa. */
export async function confirmarCobroManual(numero: string, actor: string, operacion?: string | null): Promise<boolean> {
  const hecho = await enTransaccion(async (c) => {
    const k = (await c.query<{ id: number; plan_id: number; meses: number }>(
      `SELECT id, plan_id, meses FROM gobserva_cobros WHERE numero = $1 AND estado = 'pendiente' AND medio <> 'tarjeta' FOR UPDATE`, [numero])).rows[0];
    if (!k) return null;
    await c.query(
      `UPDATE gobserva_cobros SET estado = 'pagado', pagado_at = now(), validado_por = left($2, 120), operacion = COALESCE(NULLIF($3, ''), operacion)
        WHERE id = $1`, [k.id, actor, operacion ?? null]);
    await c.query(`UPDATE gobserva_planes_cliente SET cobros = cobros + $2 WHERE id = $1`, [k.plan_id, k.meses]);
    const cancelar = await activar(c, k.plan_id, `GREATEST(COALESCE(vigente_hasta, now()), now()) + make_interval(months => $2::int)`, [k.meses]);
    return { cobro: k.id, cancelar };
  });
  if (!hecho) return false;
  await cancelarEnMp(hecho.cancelar);
  await avisarRecibo(hecho.cobro).catch((e) => registrar("WARNING", `[gobserva] recibo ${numero}: ${(e as Error).message}`));
  return true;
}

export async function rechazarCobroManual(numero: string, actor: string, motivo: string): Promise<boolean> {
  return enTransaccion(async (c) => {
    const k = (await c.query<{ plan_id: number }>(
      `UPDATE gobserva_cobros SET estado = 'rechazado', motivo = left($3, 300), validado_por = left($2, 120)
        WHERE numero = $1 AND estado = 'pendiente' AND medio <> 'tarjeta' RETURNING plan_id`, [numero, actor, motivo])).rows[0];
    if (!k) return false;
    await c.query(
      `UPDATE gobserva_planes_cliente SET estado = 'rechazada', motivo = left($2, 300), actualizado_at = now() WHERE id = $1 AND estado = 'pendiente'`,
      [k.plan_id, motivo]);
    return true;
  });
}

/** El panel regala meses de un plan a una cuenta (prensa, aliados, pruebas). La persona tiene que haber creado su cuenta. */
/**
 * Un plan regalado desde el panel. Por correo: la cuenta de la app del producto (desde 2026-11-08 cada app tiene la suya
 * y el mismo correo puede tener una en Empleo y otra en Licitaciones; Obras va con Licitaciones). Por `uid`: cualquier
 * cuenta que exista, también una de Vigía (Firebase), que sólo usa el plan para el MCP.
 */
export async function darCortesia(a: { email?: string; uid?: string; producto: ProductoPago; plan: string; meses: number; actor: string }): Promise<{ codigo: string; numero: string }> {
  let uid: string | null = null;
  if (a.uid) {
    // Una cuenta de Vigía no tiene fila en gobserva_cuentas (los planes la exigen): se crea con su correo de Vigía.
    await poolAdmin.query(
      `INSERT INTO gobserva_cuentas (firebase_uid, email)
       SELECT firebase_uid, lower(correo) FROM usuarios WHERE firebase_uid = $1 AND correo ~ '@' AND correo !~* '@vigia[.]local$'
       ON CONFLICT (firebase_uid) DO NOTHING`, [a.uid]);
    const existe = await poolAdmin.query(`SELECT 1 FROM gobserva_cuentas WHERE firebase_uid = $1 AND baja_at IS NULL`, [a.uid]);
    if (existe.rowCount) uid = a.uid;
  } else if (a.email) {
    const app = a.producto === "empleo" ? "empleo" : "licitaciones";
    uid = (await poolAdmin.query<{ uid: string }>(
      `SELECT firebase_uid AS uid FROM gobserva_cuentas WHERE lower(email) = lower($1) AND baja_at IS NULL
        ORDER BY COALESCE(CASE WHEN producto_origen = 'obras' THEN 'licitaciones' ELSE producto_origen END = $2, false) DESC,
                 ultimo_ingreso_at DESC NULLS LAST
        LIMIT 1`,
      [a.email.trim(), app])).rows[0]?.uid ?? null;
  }
  if (!uid) throw new ErrorCobro(404, "sin_cuenta", "Esa persona todavía no creó su cuenta de Gobserva con ese correo.");
  const p = await prepararPlan(uid, a.producto, a.plan, "cortesia");
  const r = await enTransaccion(async (c) => {
    const numero = await nuevoRecibo(c);
    const k = await c.query<{ id: number }>(
      `INSERT INTO gobserva_cobros (numero, plan_id, firebase_uid, medio, monto_pen, meses, estado, pagado_at, validado_por, motivo)
       VALUES ($1, $2, $3, 'cortesia', 0, $4, 'pagado', now(), left($5, 120), 'Cortesía') RETURNING id`,
      [numero, p.id, uid, a.meses, a.actor]);
    await c.query(`UPDATE gobserva_planes_cliente SET cobros = cobros + $2, renovar = false WHERE id = $1`, [p.id, a.meses]);
    const cancelar = await activar(c, p.id, `now() + make_interval(months => $2::int)`, [a.meses]);
    return { numero, cancelar, cobro: k.rows[0].id };
  });
  await cancelarEnMp(r.cancelar);
  return { codigo: p.codigo, numero: r.numero };
}

/**
 * Cancela un plan. Con tarjeta, deja de cobrar en Mercado Pago y el plan sigue hasta el final de lo pagado; un pago
 * pendiente con QR se anula. `uid` null = lo cancela el panel.
 */
export async function cancelarPlan(codigo: string, uid: string | null, motivo: string): Promise<{ estado: string; vigenteHasta: string | null } | null> {
  const p = (await poolAdmin.query<{ id: number; estado: string; preapproval_id: string | null }>(
    `SELECT id, estado, preapproval_id FROM gobserva_planes_cliente WHERE codigo = $1 AND ($2::text IS NULL OR firebase_uid = $2)`,
    [codigo, uid])).rows[0];
  if (!p) return null;
  if (p.preapproval_id) {
    try {
      await cancelarSuscripcion(p.preapproval_id);
    } catch (e) {
      // Ya cancelada en Mercado Pago (o no existe) no impide cancelarla acá; otro error, sí.
      if (!(e instanceof ErrorMp && (e.status === 404 || e.status === 400))) throw e;
    }
  }
  const r = await poolAdmin.query<{ estado: string; vigente: string | null }>(
    `UPDATE gobserva_planes_cliente
        SET renovar = false, cancelada_at = now(), motivo = left($2, 300), actualizado_at = now(),
            estado = CASE WHEN estado = 'pendiente' THEN 'rechazada' ELSE estado END
      WHERE id = $1
      RETURNING estado, to_char(vigente_hasta AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS vigente`,
    [p.id, motivo || (uid ? "Cancelado por quien pagaba" : "Cancelado desde el panel")]);
  await poolAdmin.query(
    `UPDATE gobserva_cobros SET estado = 'rechazado', motivo = 'Plan cancelado' WHERE plan_id = $1 AND estado = 'pendiente'`, [p.id]);
  return { estado: r.rows[0]?.estado ?? p.estado, vigenteHasta: r.rows[0]?.vigente ?? null };
}

// ─── Webhook de Mercado Pago ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Un cobro aprobado de una suscripción de Gobserva: su recibo y un mes más. Sólo cuenta si es en soles, de la cuenta
 * propia y por el monto del plan (el de fundador o el regular). Dos avisos del mismo cobro dan un solo recibo.
 */
async function registrarCobro(preapproval: string | null, codigo: string | null, pagoId: string, monto: number, moneda: string | undefined, cobrador?: number): Promise<void> {
  const propia = await cuentaPropia();
  if ((moneda ?? "PEN") !== "PEN" || (propia != null && cobrador != null && cobrador !== propia)) {
    registrar("WARNING", `[gobserva] cobro ${pagoId}: no es en soles o no es de la cuenta propia`);
    return;
  }
  const r = await enTransaccion(async (c) => {
    const p = (await c.query<{ id: number; uid: string; estado: string; monto: number; regular: number; cobros: number; meses_fundador: number | null; preapproval_id: string | null }>(
      `SELECT id, firebase_uid AS uid, estado, monto_pen::float AS monto, monto_regular::float AS regular, cobros, meses_fundador, preapproval_id
         FROM gobserva_planes_cliente WHERE (preapproval_id = $1 OR codigo = $2) AND medio = 'tarjeta' FOR UPDATE`,
      [preapproval, codigo])).rows[0];
    if (!p) return null;
    if (Math.abs(monto - p.monto) >= 0.005 && Math.abs(monto - p.regular) >= 0.005) {
      // El cobro mínimo con el que Mercado Pago verifica la tarjeta (y devuelve) cae aquí.
      registrar("WARNING", `[gobserva] cobro ${pagoId} de S/ ${monto} no es el monto del plan ${p.id}: no cuenta`);
      return null;
    }
    const numero = await nuevoRecibo(c);
    const k = await c.query<{ id: number }>(
      `INSERT INTO gobserva_cobros (numero, plan_id, firebase_uid, medio, monto_pen, meses, estado, pasarela_ref, validado_por, pagado_at)
       VALUES ($1, $2, $3, 'tarjeta', $4, 1, 'pagado', $5, 'mercadopago', now())
       ON CONFLICT (pasarela_ref) DO NOTHING RETURNING id`,
      [numero, p.id, p.uid, monto, pagoId]);
    if (!k.rows.length) return null;   // el otro aviso del mismo cobro llegó primero
    const cobros = p.cobros + 1;
    if (p.estado === "cancelada") {
      // Un cobro que llegó después de cancelar (o de cambiar de plan): queda registrado, pero no reactiva el plan viejo
      // ni cierra el nuevo. Se revisa a mano para devolverlo.
      await c.query(`UPDATE gobserva_planes_cliente SET cobros = $2 WHERE id = $1`, [p.id, cobros]);
      registrar("ERROR", `[gobserva] cobro ${pagoId} de un plan cancelado (${p.id}): revisar si se devuelve`);
      return { cobro: k.rows[0].id, cancelar: [] as string[], terminaFundador: false, preapproval: null, regular: p.regular };
    }
    // El primer cobro cuenta un mes desde hoy (los 3 días provisorios no se suman); los siguientes, desde lo pagado.
    const cancelar = await activar(c, p.id,
      p.cobros === 0 ? `now() + interval '1 month'` : `GREATEST(COALESCE(vigente_hasta, now()), now()) + interval '1 month'`);
    const terminaFundador = !!p.meses_fundador && cobros >= p.meses_fundador && p.monto < p.regular;
    await c.query(
      `UPDATE gobserva_planes_cliente SET cobros = $2, monto_pen = CASE WHEN $3 THEN monto_regular ELSE monto_pen END WHERE id = $1`,
      [p.id, cobros, terminaFundador]);
    return { cobro: k.rows[0].id, cancelar, terminaFundador, preapproval: p.preapproval_id, regular: p.regular };
  });
  if (!r) return;
  await cancelarEnMp(r.cancelar);
  if (r.terminaFundador && r.preapproval) {
    await cambiarMontoSuscripcion(r.preapproval, round2(r.regular)).catch((e) =>
      registrar("ERROR", `[gobserva] no se pudo pasar ${r.preapproval} al precio regular: ${(e as Error).message}`));
  }
  await avisarRecibo(r.cobro).catch((e) => registrar("WARNING", `[gobserva] recibo del cobro ${pagoId}: ${(e as Error).message}`));
}

/** Un pago devuelto o desconocido con el banco: su mes deja de contar. */
export async function reembolsoGobserva(pagoId: string): Promise<void> {
  await enTransaccion(async (c) => {
    const k = (await c.query<{ plan_id: number }>(
      `UPDATE gobserva_cobros SET estado = 'reembolsado' WHERE pasarela_ref = $1 AND estado = 'pagado' RETURNING plan_id`, [pagoId])).rows[0];
    if (!k) return;
    await c.query(
      `UPDATE gobserva_planes_cliente SET vigente_hasta = vigente_hasta - interval '1 month', actualizado_at = now() WHERE id = $1 AND vigente_hasta IS NOT NULL`,
      [k.plan_id]);
  });
}

/** payment: un cobro de una suscripción de Gobserva (referencia GOB-) o su devolución. */
export async function alPagoGobserva(p: PagoMp): Promise<void> {
  const devuelto = Number(p.transaction_amount_refunded ?? 0);
  if (p.status === "refunded" || p.status === "charged_back" || (devuelto > 0 && devuelto >= Number(p.transaction_amount) - 0.005)) {
    await reembolsoGobserva(String(p.id));
    return;
  }
  if (p.status !== "approved") return;
  await registrarCobro(null, p.external_reference, String(p.id), Number(p.transaction_amount), p.currency_id, p.collector_id);
}

/** subscription_preapproval: el estado de la suscripción (cancelada o pausada en Mercado Pago: deja de renovarse). */
export async function alSuscripcionGobserva(s: SuscripcionMp): Promise<void> {
  await poolAdmin.query(
    `UPDATE gobserva_planes_cliente
        SET estado_mp = $2, renovar = renovar AND $2 IN ('authorized', 'pending'),
            estado = CASE WHEN estado = 'pendiente' AND $2 = 'cancelled' THEN 'rechazada' ELSE estado END,
            actualizado_at = now()
      WHERE preapproval_id = $1`,
    [s.id, s.status]);
}

/** ¿Es de Gobserva esta suscripción? (subscription_authorized_payment trae sólo el id de la suscripción) */
export async function esSuscripcionGobserva(preapproval: string): Promise<boolean> {
  const r = await poolAdmin.query(`SELECT 1 FROM gobserva_planes_cliente WHERE preapproval_id = $1`, [preapproval]);
  return r.rows.length > 0;
}

/** subscription_authorized_payment: el cobro de un mes. */
export async function alCobroGobserva(k: CobroMp): Promise<void> {
  if (!k.preapproval_id || k.payment?.status !== "approved") return;
  await registrarCobro(k.preapproval_id, null, String(k.payment.id), Number(k.transaction_amount), k.currency_id);
}

