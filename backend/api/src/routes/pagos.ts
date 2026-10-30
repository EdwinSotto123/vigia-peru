import { Hono } from "hono";
import { z } from "zod";
import { esErrorPg, pool, poolAdmin } from "../lib/db.js";
import { optionalAuth } from "../lib/auth.js";
import { exigirCaptcha, limiteEscritura } from "../lib/antibots.js";
import { invalidarMemosEnTodas } from "../lib/cache.js";
import {
  ErrorMp,
  crearPago,
  crearSuscripcion,
  firmaValida,
  leerCobro,
  leerContracargo,
  leerPago,
  leerSuscripcion,
  mensajeRechazo,
  mpConfigurado,
} from "../lib/mercadopago.js";
import { resolverFinanciador } from "./contribuciones.js";

/**
 * Aportes con tarjeta por Mercado Pago (migración 216; lib/mercadopago.ts):
 *
 *   POST /pagos/aporte                 el aporte de «Ayúdanos a seguir vigilando» con el token del Card Payment Brick:
 *                                      una vez (un pago) o cada mes (una suscripción con cobro automático). Con el
 *                                      mismo límite por IP y el mismo captcha que el aporte por Yape o Plin.
 *   POST /pagos/mercadopago/webhook    los avisos de Mercado Pago (pagos, suscripciones, cobros, contracargos), sólo con
 *                                      firma válida (lib/antibots.ts → cerradaAlPublico los deja pasar por eso); cada
 *                                      uno se confirma pidiéndole el recurso a Mercado Pago con el token propio.
 *
 * Un aporte queda validado (pagada) sólo con un pago aprobado que Mercado Pago confirma; cada cobro mensual aprobado es
 * un aporte nuevo del mismo aliado, y así cuenta para la constancia del podio. Lo que valida, rechaza o registra cobros
 * va por el rol del panel (poolAdmin): el rol público sigue sin poder marcar un aporte como pagado. El documento de
 * identidad de quien paga va a Mercado Pago y no se guarda.
 */
export const pagosRouter = new Hono();

/** Adonde vuelve quien autoriza una suscripción (Mercado Pago lo exige; con la tarjeta en el formulario no se usa). */
const VOLVER = "https://vigia.gobserva.cloud/app/apoyar";
const CODIGO = /^[A-Z]{2,6}-\d{4}-\d{3,8}$/;

const AporteBody = z.object({
  montoPen: z.number().min(5).max(50_000),
  periodicidad: z.enum(["unica", "mensual"]),
  financiador: z.object({
    tipo: z.enum(["empresa", "persona", "organizacion"]),
    nombrePublico: z.string().trim().min(2).max(80).optional(),
    ruc: z.string().regex(/^\d{11}$/).optional(),
    email: z.string().email().max(254).optional(),
  }),
  mensajePublico: z.string().trim().max(140).optional(),
  para: z.object({
    ruc: z.string().regex(/^\d{11}$/).optional(),
    ubigeo: z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/).optional(),
  }).optional(),
  tarjeta: z.object({
    token: z.string().min(8).max(200),
    paymentMethodId: z.string().regex(/^[a-z0-9_]{2,40}$/),
    issuerId: z.union([z.string().regex(/^\d{1,12}$/), z.number().int().positive()]).optional(),
    email: z.string().email().max(254),
    identificacion: z.object({
      tipo: z.string().regex(/^[A-Za-z]{2,10}$/),
      numero: z.string().regex(/^[0-9A-Za-z]{4,20}$/),
    }).optional(),
  }),
});

// ─── POST /pagos/aporte ──────────────────────────────────────────────────────
pagosRouter.post("/aporte", limiteEscritura, exigirCaptcha, optionalAuth, async (c) => {
  if (!mpConfigurado()) {
    return c.json({ error: "tarjeta_cerrada", detail: "El pago con tarjeta todavía no está disponible. Puedes aportar con Yape o Plin." }, 503);
  }
  const body = AporteBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { montoPen, periodicidad, financiador: f, mensajePublico, para, tarjeta } = body.data;
  if ((f.tipo === "empresa" || f.tipo === "organizacion") && !f.ruc) {
    return c.json({ error: "ruc_required", detail: "Empresas y organizaciones deben indicar RUC" }, 400);
  }
  const uid = c.get("user")?.uid ?? null;
  const monto = Math.round(montoPen * 100) / 100;

  // 1) El aporte, pendiente: su código va a Mercado Pago como referencia externa (así lo encuentra el aviso).
  const client = await pool.connect();
  let codigo: string;
  try {
    await client.query("BEGIN");
    const financiadorId = await resolverFinanciador(client, uid, { ...f, email: f.email ?? tarjeta.email });
    codigo = (await client.query("SELECT next_codigo_contribucion() AS c")).rows[0].c as string;
    await client.query(
      `INSERT INTO contribuciones (codigo, financiador_id, contratos, monto_pen, pasarela, mensaje_publico, tipo, periodicidad, para_ruc, para_ubigeo)
       VALUES ($1, $2, 0, $3, 'mercadopago', $4, 'apoyo', $5, $6, $7)`,
      [codigo, financiadorId, monto, mensajePublico ?? null, periodicidad, para?.ruc ?? null, para?.ubigeo ?? null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // 2) El cobro.
  try {
    if (periodicidad === "unica") {
      const pago = await crearPago(tarjeta, monto, codigo);
      if (pago.status === "approved") {
        await validarAporte(codigo, String(pago.id));
        return c.json({ codigo, estado: "pagada", periodicidad, montoPen: monto }, 201);
      }
      if (pago.status === "in_process" || pago.status === "pending" || pago.status === "authorized") {
        await poolAdmin.query(`UPDATE contribuciones SET pasarela_ref = $2 WHERE codigo = $1 AND estado = 'pendiente_pago'`, [codigo, String(pago.id)]);
        return c.json({
          codigo, estado: "en_revision", periodicidad, montoPen: monto,
          detail: "Mercado Pago está revisando el pago. En cuanto lo apruebe, tu aporte queda confirmado.",
        }, 202);
      }
      await rechazarAporte(codigo, pago.status_detail || pago.status, String(pago.id));
      return c.json({ error: "pago_rechazado", detail: mensajeRechazo(pago.status_detail) }, 402);
    }
    const s = await crearSuscripcion(tarjeta, monto, codigo, VOLVER);
    if (s.status !== "authorized") {
      await rechazarAporte(codigo, `suscripcion_${s.status}`, null);
      return c.json({ error: "pago_rechazado", detail: "Mercado Pago no autorizó la suscripción. Prueba con otra tarjeta." }, 402);
    }
    await poolAdmin.query(
      `WITH s AS (
         INSERT INTO suscripciones_mp (preapproval_id, financiador_id, contribucion_inicial, monto_pen, estado)
         SELECT $1, co.financiador_id, co.id, co.monto_pen, $3 FROM contribuciones co WHERE co.codigo = $2
         ON CONFLICT (preapproval_id) DO UPDATE SET estado = EXCLUDED.estado, updated_at = now()
         RETURNING id)
       UPDATE contribuciones SET suscripcion_id = (SELECT id FROM s) WHERE codigo = $2`,
      [s.id, codigo, s.status]);
    return c.json({ codigo, estado: "suscrita", periodicidad, montoPen: monto }, 201);
  } catch (e) {
    if (e instanceof ErrorMp) {
      // Sólo el código y la causa: el cuerpo de Mercado Pago puede repetir datos de quien paga.
      const causa = (e.cuerpo as { cause?: { code?: string | number }[]; message?: string } | null)?.cause?.map((x) => x.code).join(",");
      console.warn(`[pagos] Mercado Pago ${e.status} en ${codigo}${causa ? ` (causa ${causa})` : ""}`);
      await rechazarAporte(codigo, `error_${e.status}${causa ? `_${causa}` : ""}`, null).catch(() => {});
      return c.json({ error: "pago_rechazado", detail: "Mercado Pago no pudo procesar la tarjeta. Revisa los datos o prueba con otra." }, 402);
    }
    throw e;
  }
});

// ─── POST /pagos/mercadopago/webhook ─────────────────────────────────────────
pagosRouter.post("/mercadopago/webhook", async (c) => {
  const url = new URL(c.req.url);
  const cuerpo = (await c.req.json().catch(() => null)) as { type?: string; data?: { id?: string | number } } | null;
  const idUrl = url.searchParams.get("data.id");
  if (!(await firmaValida(process.env.MP_WEBHOOK_SECRET, c.req.header("x-signature"), c.req.header("x-request-id"), idUrl))) {
    return c.json({ error: "firma_invalida" }, 401);
  }
  const tipo = url.searchParams.get("type") ?? cuerpo?.type ?? null;
  const id = idUrl ?? (cuerpo?.data?.id != null ? String(cuerpo.data.id) : null);
  if (!tipo || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.json({ ok: true, ignorado: true });
  try {
    if (tipo === "payment") await alPago(id);
    else if (tipo === "subscription_preapproval") await alSuscripcion(id);
    else if (tipo === "subscription_authorized_payment") await alCobro(id);
    else if (tipo === "chargebacks" || tipo === "topic_chargebacks_wh") await alContracargo(id);
    // Reclamos y lo demás no cambian ningún aporte: se atienden en el panel de Mercado Pago.
  } catch (e) {
    // La simulación del panel manda ids que no existen: no hay nada que reintentar.
    if (e instanceof ErrorMp && e.status === 404) return c.json({ ok: true, ignorado: "no_existe" });
    throw e; // 500: Mercado Pago vuelve a avisar
  }
  return c.json({ ok: true });
});

/** Un pago: el de un aporte único (por su código) o un cobro de una suscripción (va a registrarCobro). */
async function alPago(id: string) {
  const p = await leerPago(id);
  const codigo = p.external_reference;
  if (!codigo || !CODIGO.test(codigo)) return;
  const fila = (await poolAdmin.query<{ preapproval: string | null }>(
    `SELECT s.preapproval_id AS preapproval FROM contribuciones co LEFT JOIN suscripciones_mp s ON s.id = co.suscripcion_id
      WHERE co.codigo = $1 AND co.pasarela = 'mercadopago'`, [codigo])).rows[0];
  if (!fila) return;
  if (p.status === "approved") {
    if (fila.preapproval) await registrarCobro(fila.preapproval, String(p.id), p.transaction_amount);
    else await validarAporte(codigo, String(p.id));
  } else if (p.status === "rejected" || p.status === "cancelled") {
    if (!fila.preapproval) await rechazarAporte(codigo, p.status_detail || p.status, String(p.id));
  } else if (p.status === "refunded" || p.status === "charged_back") {
    await reembolsar(String(p.id));
  }
}

async function alSuscripcion(id: string) {
  const s = await leerSuscripcion(id);
  await poolAdmin.query(`UPDATE suscripciones_mp SET estado = $2, updated_at = now() WHERE preapproval_id = $1`, [id, s.status]);
}

async function alCobro(id: string) {
  const k = await leerCobro(id);
  if (k.preapproval_id && k.payment?.status === "approved") {
    await registrarCobro(k.preapproval_id, String(k.payment.id), k.transaction_amount);
  }
}

async function alContracargo(id: string) {
  const k = await leerContracargo(id);
  for (const pago of k.payments ?? []) await reembolsar(String(pago));
}

/** Pendiente → pagada con el pago aprobado (una sola vez: el aviso y la respuesta del pago pueden llegar juntos). */
async function validarAporte(codigo: string, ref: string): Promise<boolean> {
  const client = await poolAdmin.connect();
  let hecho = false;
  try {
    await client.query("BEGIN");
    const r = await client.query<{ id: number }>(
      `UPDATE contribuciones SET estado = 'pagada', pagada_at = now(), validada_por = 'mercadopago', pasarela_ref = $2
        WHERE codigo = $1 AND pasarela = 'mercadopago' AND estado = 'pendiente_pago' RETURNING id`, [codigo, ref]);
    if (r.rows.length) await client.query("SELECT asignar_contribucion($1)", [r.rows[0].id]);
    await client.query("COMMIT");
    hecho = r.rows.length > 0;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (esErrorPg(e, "23505")) return false; // ese pago ya validó otro aporte
    throw e;
  } finally {
    client.release();
  }
  if (hecho) await refrescar();
  return hecho;
}

/** El cobro de un mes de una suscripción: valida el aporte con el que empezó o, si ya lo estaba, suma un aporte nuevo. */
async function registrarCobro(preapproval: string, pagoId: string, monto: number | null): Promise<boolean> {
  const client = await poolAdmin.connect();
  try {
    await client.query("BEGIN");
    const s = (await client.query<{ id: number; financiador: number; inicial: number | null; monto: number }>(
      `SELECT id, financiador_id AS financiador, contribucion_inicial AS inicial, monto_pen::float AS monto
         FROM suscripciones_mp WHERE preapproval_id = $1`, [preapproval])).rows[0];
    const ya = await client.query(`SELECT 1 FROM contribuciones WHERE pasarela = 'mercadopago' AND pasarela_ref = $1`, [pagoId]);
    if (!s || ya.rows.length) {
      await client.query("ROLLBACK");
      return false;
    }
    let id = (await client.query<{ id: number }>(
      `UPDATE contribuciones SET estado = 'pagada', pagada_at = now(), validada_por = 'mercadopago', pasarela_ref = $2
        WHERE id = $1 AND estado = 'pendiente_pago' RETURNING id`, [s.inicial, pagoId])).rows[0]?.id;
    if (!id) {
      id = (await client.query<{ id: number }>(
        `INSERT INTO contribuciones (codigo, financiador_id, contratos, monto_pen, pasarela, pasarela_ref, mensaje_publico, tipo,
                                     periodicidad, para_ruc, para_ubigeo, estado, pagada_at, validada_por, suscripcion_id)
         SELECT next_codigo_contribucion(), $1, 0, $2, 'mercadopago', $3, ci.mensaje_publico, 'apoyo', 'mensual',
                ci.para_ruc, ci.para_ubigeo, 'pagada', now(), 'mercadopago', $4
           FROM (SELECT 1) x LEFT JOIN contribuciones ci ON ci.id = $5
         RETURNING id`, [s.financiador, monto ?? s.monto, pagoId, s.id, s.inicial])).rows[0].id;
    }
    await client.query("SELECT asignar_contribucion($1)", [id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (esErrorPg(e, "23505")) return false; // el otro aviso del mismo cobro llegó primero
    throw e;
  } finally {
    client.release();
  }
  await refrescar();
  return true;
}

async function rechazarAporte(codigo: string, motivo: string, ref: string | null) {
  await poolAdmin.query(
    `UPDATE contribuciones SET estado = 'rechazada', rechazada_motivo = left($2, 300), validada_por = 'mercadopago',
            pasarela_ref = COALESCE($3, pasarela_ref)
      WHERE codigo = $1 AND pasarela = 'mercadopago' AND estado = 'pendiente_pago'`, [codigo, motivo, ref]);
}

/** Un pago devuelto o desconocido con el banco: su aporte deja de contar (lo recaudado, la constancia del podio). */
async function reembolsar(ref: string) {
  const r = await poolAdmin.query(
    `UPDATE contribuciones SET estado = 'reembolsada'
      WHERE pasarela = 'mercadopago' AND pasarela_ref = $1 AND estado IN ('pagada', 'en_proceso', 'procesada') RETURNING id`, [ref]);
  if (r.rows.length) await refrescar();
}

/** Lo mismo que el panel tras validar: las vistas de financiamiento y las cachés de las instancias. */
async function refrescar() {
  await poolAdmin.query("SELECT refresh_financiamiento()").catch((e) => console.warn(`[pagos] refresh_financiamiento: ${(e as Error).message}`));
  await invalidarMemosEnTodas().catch(() => {});
}
