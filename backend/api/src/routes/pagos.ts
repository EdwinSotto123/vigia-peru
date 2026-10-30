import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { esErrorPg, pool, poolAdmin } from "../lib/db.js";
import { optionalAuth } from "../lib/auth.js";
import { claveIp, cuantasEn, dentroDeTope, exigirCaptcha, ipCliente, limiteEscritura } from "../lib/antibots.js";
import { invalidarMemosEnTodas } from "../lib/cache.js";
import { SIN_CACHE } from "../lib/http.js";
import { registrar } from "../lib/registro.js";
import {
  ErrorMp,
  cancelarSuscripcion,
  corresponde,
  crearPago,
  crearSuscripcion,
  cuentaPropia,
  firmaValida,
  leerCobro,
  leerContracargo,
  leerPago,
  leerSuscripcion,
  mensajeRechazo,
  mpConfigurado,
} from "../lib/mercadopago.js";
import { TOPE_APORTE, resolverFinanciador } from "./contribuciones.js";

/**
 * Aportes con tarjeta por Mercado Pago (migración 216; lib/mercadopago.ts):
 *
 *   POST /pagos/aporte                        el aporte de «Ayúdanos a seguir vigilando» con el token del Card Payment
 *                                             Brick: una vez (un pago) o cada mes (una suscripción con cobro automático).
 *                                             Con el límite por IP y el captcha de todas las escrituras, más los topes
 *                                             propios de la tarjeta (abajo).
 *   POST /pagos/suscripcion/:codigo/cancelar  quien aporta cada mes detiene el cobro desde su comprobante, con su sesión
 *                                             o el correo del aporte (y captcha).
 *   POST /pagos/mercadopago/webhook           los avisos de Mercado Pago (pagos, suscripciones, cobros, contracargos), sólo
 *                                             con firma válida (lib/antibots.ts → cerradaAlPublico los deja pasar por eso);
 *                                             cada uno se confirma pidiéndole el recurso a Mercado Pago con el token propio.
 *
 * Un aporte queda validado (pagada) sólo con un pago aprobado que Mercado Pago confirma y que corresponde (en soles, por el
 * monto del aporte y cobrado por la cuenta de Vigía); cada cobro mensual aprobado es un aporte nuevo del mismo aliado, y
 * así cuenta para la constancia del podio. Lo que valida, rechaza o registra cobros va por el rol del panel (poolAdmin): el
 * rol público sigue sin poder marcar un aporte como pagado. El documento de identidad de quien paga va a Mercado Pago y no
 * se guarda.
 *
 * Contra quien prueba tarjetas robadas (auditoría 2026-10-30): por IP (una IPv6 por su /64) 3 intentos cada 10 minutos y
 * 8 por día, y 8 por día por correo; un mensaje de rechazo único; el dispositivo y el detalle del pago para el antifraude
 * de Mercado Pago; y un corte general: con 15 rechazos en 15 minutos la tarjeta queda en pausa para todos hasta que bajen.
 */
export const pagosRouter = new Hono();

/** Adonde vuelve quien autoriza una suscripción (Mercado Pago lo exige; con la tarjeta en el formulario no se usa). */
const VOLVER = "https://vigia.gobserva.cloud/app/apoyar";
const CODIGO = /^[A-Z]{2,6}-\d{4}-\d{3,8}$/;

const TARJETA_10_MIN = 3;
const TARJETA_DIA = 8;
const CORTE_RECHAZOS = 15;
const CORTE_VENTANA_S = 15 * 60;
const RECHAZOS = "tarjeta-rechazos|global";

const AporteBody = z.object({
  montoPen: z.number().min(5).max(TOPE_APORTE),
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
    // El id de dispositivo de Mercado Pago: si no tiene la forma esperada, no se manda (lib/mercadopago.ts), sin rechazar el aporte.
    dispositivo: z.string().max(300).optional(),
  }),
});

function muchosIntentos(c: Context): Response {
  c.header("Retry-After", "600");
  c.header("Cache-Control", SIN_CACHE);
  return c.json({ error: "demasiados_intentos", detail: "Hiciste varios intentos con tarjeta. Espera unos minutos o aporta con QR." }, 429);
}

/** Antes del captcha: el corte general por rechazos y los topes por IP de la tarjeta. */
const limiteTarjeta: MiddlewareHandler = async (c, next) => {
  if ((await cuantasEn(RECHAZOS, CORTE_VENTANA_S, true)) >= CORTE_RECHAZOS) {
    c.header("Cache-Control", SIN_CACHE);
    return c.json({ error: "tarjeta_pausada", detail: "El pago con tarjeta está en pausa unos minutos. Puedes aportar con QR o volver más tarde." }, 503);
  }
  const ip = claveIp(ipCliente(c));
  if (!(await dentroDeTope(`tarjeta-10m|${ip}`, TARJETA_10_MIN, 600, true))) return muchosIntentos(c);
  if (!(await dentroDeTope(`tarjeta-dia|${ip}`, TARJETA_DIA, 86_400, true))) return muchosIntentos(c);
  return next();
};

/** Un rechazo de Mercado Pago suma al corte general; el que lo completa queda en el registro como ERROR. */
async function contarRechazo(): Promise<void> {
  await dentroDeTope(RECHAZOS, 100_000, CORTE_VENTANA_S, true).catch(() => true);
  const n = await cuantasEn(RECHAZOS, CORTE_VENTANA_S, true).catch(() => 0);
  if (n === CORTE_RECHAZOS) {
    registrar("ERROR", `[pagos] ${n} rechazos de tarjeta en 15 minutos: la tarjeta queda en pausa hasta que bajen (¿prueba de tarjetas robadas?)`);
  }
}

/** El correo como clave del tope, sin guardarlo en claro en el limitador. */
async function huellaCorreo(correo: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(correo.trim().toLowerCase())));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── POST /pagos/aporte ──────────────────────────────────────────────────────
pagosRouter.post("/aporte", limiteEscritura, limiteTarjeta, exigirCaptcha, optionalAuth, async (c) => {
  if (!mpConfigurado()) {
    return c.json({ error: "tarjeta_cerrada", detail: "El pago con tarjeta todavía no está disponible. Puedes aportar con QR." }, 503);
  }
  const body = AporteBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { montoPen, periodicidad, financiador: f, mensajePublico, para, tarjeta } = body.data;
  if ((f.tipo === "empresa" || f.tipo === "organizacion") && !f.ruc) {
    return c.json({ error: "ruc_required", detail: "Empresas y organizaciones deben indicar RUC" }, 400);
  }
  if (!(await dentroDeTope(`tarjeta-correo|${await huellaCorreo(tarjeta.email)}`, TARJETA_DIA, 86_400, true))) return muchosIntentos(c);
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
      const pago = await crearPago(tarjeta, monto, codigo, ipCliente(c));
      if (pago.status === "approved") {
        if (corresponde(pago, monto, await cuentaPropia())) {
          await validarAporte(codigo, String(pago.id));
          return c.json({ codigo, estado: "pagada", periodicidad, montoPen: monto }, 201);
        }
        registrar("ERROR", `[pagos] ${codigo}: el pago ${pago.id} se aprobó pero no corresponde (monto, moneda o cuenta): queda para revisión`);
      }
      if (["approved", "in_process", "pending", "authorized"].includes(pago.status)) {
        await poolAdmin.query(`UPDATE contribuciones SET pasarela_ref = $2 WHERE codigo = $1 AND estado = 'pendiente_pago'`, [codigo, String(pago.id)]);
        return c.json({
          codigo, estado: "en_revision", periodicidad, montoPen: monto,
          detail: "Mercado Pago está revisando el pago. En cuanto lo apruebe, tu aporte queda confirmado.",
        }, 202);
      }
      await rechazarAporte(codigo, pago.status_detail || pago.status, String(pago.id));
      await contarRechazo();
      return c.json({ error: "pago_rechazado", detail: mensajeRechazo(pago.status_detail) }, 402);
    }
    const s = await crearSuscripcion(tarjeta, monto, codigo, VOLVER);
    if (s.status !== "authorized") {
      await rechazarAporte(codigo, `suscripcion_${s.status}`, null);
      await contarRechazo();
      return c.json({ error: "pago_rechazado", detail: mensajeRechazo(null) }, 402);
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
      registrar("WARNING", `[pagos] Mercado Pago ${e.status} en ${codigo}${causa ? ` (causa ${causa})` : ""}`);
      await rechazarAporte(codigo, `error_${e.status}${causa ? `_${causa}` : ""}`, null).catch(() => {});
      if (e.status < 500) await contarRechazo();
      return c.json({ error: "pago_rechazado", detail: mensajeRechazo(null) }, 402);
    }
    throw e;
  }
});

// ─── POST /pagos/suscripcion/:codigo/cancelar ────────────────────────────────
// Con el código de cualquier aporte de la suscripción (el primero o uno de un mes) y la prueba de que es tuyo: la sesión
// de la cuenta dueña o el correo con el que se aportó (como el comprobante, routes/contribuciones.ts). La respuesta es la
// misma si el código no es de un aporte mensual o si el correo no coincide: no sirve para confirmar correos ajenos.
const CancelarBody = z.object({ email: z.string().trim().max(254).optional() });

pagosRouter.post("/suscripcion/:codigo/cancelar", limiteEscritura, exigirCaptcha, optionalAuth, async (c) => {
  const codigo = c.req.param("codigo").toUpperCase();
  const body = CancelarBody.safeParse(await c.req.json().catch(() => ({})));
  if (!CODIGO.test(codigo) || !body.success) return c.json({ error: "invalid_body" }, 400);
  const uid = c.get("user")?.uid ?? null;
  const correo = body.data.email?.toLowerCase() || null;
  if (!uid && !correo) return c.json({ error: "titularidad_requerida", detail: "Escribe el correo con el que aportaste." }, 403);
  const fila = (await poolAdmin.query<{ preapproval: string; estado: string; esTitular: boolean }>(
    `SELECT s.preapproval_id AS preapproval, s.estado,
            COALESCE(($2::text IS NOT NULL AND (f.firebase_uid = $2
               OR EXISTS (SELECT 1 FROM usuarios u WHERE u.firebase_uid = $2 AND u.financiador_id = co.financiador_id)))
             OR ($3::text IS NOT NULL AND lower(btrim(f.email)) = $3), false) AS "esTitular"
       FROM contribuciones co
       JOIN suscripciones_mp s ON s.id = co.suscripcion_id
       JOIN financiadores f ON f.id = co.financiador_id
      WHERE co.codigo = $1 AND co.pasarela = 'mercadopago'`, [codigo, uid, correo])).rows[0];
  if (!fila || !fila.esTitular) {
    return c.json({ error: "no_coincide", detail: "No encontramos un aporte mensual con ese código y ese correo." }, 404);
  }
  if (fila.estado !== "cancelled") {
    try {
      await cancelarSuscripcion(fila.preapproval);
    } catch (e) {
      if (e instanceof ErrorMp) {
        registrar("ERROR", `[pagos] no se pudo cancelar el aporte mensual de ${codigo}: Mercado Pago ${e.status}`);
        return c.json({ error: "mp_no_disponible", detail: "No pudimos cancelarlo ahora. Vuelve a intentarlo en unos minutos o escríbenos." }, 502);
      }
      throw e;
    }
    await poolAdmin.query(`UPDATE suscripciones_mp SET estado = 'cancelled', updated_at = now() WHERE preapproval_id = $1`, [fila.preapproval]);
    registrar("INFO", `[pagos] aporte mensual de ${codigo} cancelado por quien aporta`);
  }
  return c.json({ ok: true, estado: "cancelada" });
});

// ─── POST /pagos/mercadopago/webhook ─────────────────────────────────────────
pagosRouter.post("/mercadopago/webhook", async (c) => {
  const url = new URL(c.req.url);
  const cuerpo = (await c.req.json().catch(() => null)) as { type?: string; data?: { id?: string | number } } | null;
  const id = url.searchParams.get("data.id");
  if (!(await firmaValida(process.env.MP_WEBHOOK_SECRET, c.req.header("x-signature"), c.req.header("x-request-id"), id))) {
    return c.json({ error: "firma_invalida" }, 401);
  }
  // La firma cubre el id de la URL: uno que sólo venga en el cuerpo no está firmado, y si los dos no coinciden, algo anda mal.
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.json({ error: "sin_data_id" }, 400);
  if (cuerpo?.data?.id != null && String(cuerpo.data.id) !== id) return c.json({ error: "id_distinto" }, 400);
  const tipo = url.searchParams.get("type") ?? cuerpo?.type ?? null;
  if (!tipo) return c.json({ ok: true, ignorado: true });
  try {
    if (tipo === "payment") await alPago(id);
    else if (tipo === "subscription_preapproval") await alSuscripcion(id);
    else if (tipo === "subscription_authorized_payment") await alCobro(id);
    else if (tipo === "chargebacks" || tipo === "topic_chargebacks_wh") await alContracargo(id);
    // Reclamos y lo demás no cambian ningún aporte: se atienden en el panel de Mercado Pago.
  } catch (e) {
    // La simulación del panel manda ids que no existen (404); un contracargo que no existe da 400 «Case not found».
    if (e instanceof ErrorMp && (e.status === 404 || (e.status === 400 && tipo.includes("chargeback")))) {
      return c.json({ ok: true, ignorado: "no_existe" });
    }
    throw e; // 500: Mercado Pago vuelve a avisar
  }
  return c.json({ ok: true });
});

/** Un pago: el de un aporte único (por su código) o un cobro de una suscripción (va a registrarCobro). */
async function alPago(id: string) {
  const p = await leerPago(id);
  // Devuelto o desconocido con el banco: por la referencia del pago, traiga o no el código del aporte.
  const devuelto = Number(p.transaction_amount_refunded ?? 0);
  if (p.status === "refunded" || p.status === "charged_back" || (devuelto > 0 && devuelto >= Number(p.transaction_amount) - 0.005)) {
    await reembolsar(String(p.id));
    return;
  }
  if (devuelto > 0) registrar("WARNING", `[pagos] el pago ${p.id} tiene una devolución parcial: revisarlo a mano`);
  const codigo = p.external_reference;
  if (!codigo || !CODIGO.test(codigo)) return;
  const fila = (await poolAdmin.query<{ preapproval: string | null; monto: number; montoSuscripcion: number | null }>(
    `SELECT s.preapproval_id AS preapproval, co.monto_pen::float AS monto, s.monto_pen::float AS "montoSuscripcion"
       FROM contribuciones co LEFT JOIN suscripciones_mp s ON s.id = co.suscripcion_id
      WHERE co.codigo = $1 AND co.pasarela = 'mercadopago'`, [codigo])).rows[0];
  if (!fila) return;
  if (p.status === "approved") {
    if (!corresponde(p, fila.montoSuscripcion ?? fila.monto, await cuentaPropia())) {
      // En una suscripción, el cobro mínimo con el que Mercado Pago verifica la tarjeta (y devuelve) cae aquí.
      registrar(fila.preapproval ? "WARNING" : "ERROR", `[pagos] ${codigo}: el pago ${p.id} no corresponde (monto, moneda o cuenta): no valida nada`);
      return;
    }
    if (fila.preapproval) await registrarCobro(fila.preapproval, String(p.id), p.transaction_amount, p.currency_id);
    else await validarAporte(codigo, String(p.id));
  } else if (p.status === "rejected" || p.status === "cancelled") {
    if (!fila.preapproval) await rechazarAporte(codigo, p.status_detail || p.status, String(p.id));
  }
}

async function alSuscripcion(id: string) {
  const s = await leerSuscripcion(id);
  await poolAdmin.query(`UPDATE suscripciones_mp SET estado = $2, updated_at = now() WHERE preapproval_id = $1`, [id, s.status]);
}

async function alCobro(id: string) {
  const k = await leerCobro(id);
  if (k.preapproval_id && k.payment?.status === "approved") {
    await asegurarSuscripcion(k.preapproval_id);
    await registrarCobro(k.preapproval_id, String(k.payment.id), k.transaction_amount, k.currency_id);
  }
}

async function alContracargo(id: string) {
  const k = await leerContracargo(id);
  for (const pago of k.payments ?? []) await reembolsar(String(pago));
}

/**
 * La fila de una suscripción que no se llegó a guardar al crearla (la base falló justo después de que Mercado Pago la
 * autorizó): se arma con lo que dice Mercado Pago, para que sus cobros no se pierdan.
 */
async function asegurarSuscripcion(preapproval: string): Promise<void> {
  const hay = await poolAdmin.query(`SELECT 1 FROM suscripciones_mp WHERE preapproval_id = $1`, [preapproval]);
  if (hay.rows.length) return;
  const s = await leerSuscripcion(preapproval);
  const codigo = s.external_reference;
  if (!codigo || !CODIGO.test(codigo)) return;   // una suscripción que no es de Vigía
  await poolAdmin.query(
    `WITH s AS (
       INSERT INTO suscripciones_mp (preapproval_id, financiador_id, contribucion_inicial, monto_pen, estado)
       SELECT $1, co.financiador_id, co.id, co.monto_pen, $3 FROM contribuciones co WHERE co.codigo = $2 AND co.pasarela = 'mercadopago'
       ON CONFLICT (preapproval_id) DO NOTHING
       RETURNING id)
     UPDATE contribuciones SET suscripcion_id = (SELECT id FROM s) WHERE codigo = $2 AND EXISTS (SELECT 1 FROM s)`,
    [preapproval, codigo, s.status]);
  registrar("WARNING", `[pagos] la suscripción de ${codigo} se registró desde el aviso de un cobro (faltaba)`);
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

/**
 * El cobro de un mes de una suscripción: valida el aporte con el que empezó o, si ya lo estaba, suma un aporte nuevo.
 * Una suscripción sin fila es un error (500: Mercado Pago vuelve a avisar y asegurarSuscripcion la arma); un cobro en
 * otra moneda o de otro monto no cuenta.
 */
async function registrarCobro(preapproval: string, pagoId: string, monto: number | null, moneda?: string): Promise<boolean> {
  const client = await poolAdmin.connect();
  try {
    await client.query("BEGIN");
    const s = (await client.query<{ id: number; financiador: number; inicial: number | null; monto: number }>(
      `SELECT id, financiador_id AS financiador, contribucion_inicial AS inicial, monto_pen::float AS monto
         FROM suscripciones_mp WHERE preapproval_id = $1`, [preapproval])).rows[0];
    if (!s) throw new Error(`[pagos] el cobro ${pagoId} es de una suscripción sin registrar`);
    if ((moneda ?? "PEN") !== "PEN" || (monto != null && Math.abs(Number(monto) - s.monto) >= 0.005)) {
      await client.query("ROLLBACK");
      registrar("WARNING", `[pagos] el cobro ${pagoId} de una suscripción no es de su monto ni en soles: no cuenta`);
      return false;
    }
    const ya = await client.query(`SELECT 1 FROM contribuciones WHERE pasarela = 'mercadopago' AND pasarela_ref = $1`, [pagoId]);
    if (ya.rows.length) {
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
  await poolAdmin.query("SELECT refresh_financiamiento()").catch((e) => registrar("WARNING", `[pagos] refresh_financiamiento: ${(e as Error).message}`));
  await invalidarMemosEnTodas().catch(() => {});
}
