/**
 * Mercado Pago (2026-10-30): el aporte con tarjeta de «Ayúdanos a seguir vigilando», una vez o cada mes.
 *
 * La tarjeta se escribe en el formulario de Mercado Pago (Card Payment Brick, frontend/components/financiar/PagoTarjeta):
 * a la API sólo llega un token de un uso. Con él se crea el pago (/v1/payments) o la suscripción con cobro automático
 * cada mes (/preapproval). Los avisos del webhook se aceptan sólo con la firma de la clave del panel (`x-signature`) y,
 * aun así, no se les cree: se le pide el pago o la suscripción a Mercado Pago con el token propio. El documento de
 * identidad de quien paga va a Mercado Pago y no se guarda en Vigía.
 *
 * Secretos del Worker (copia en SSM /vigia/mercadopago/<entorno>/…): MP_ACCESS_TOKEN, MP_PUBLIC_KEY, MP_WEBHOOK_SECRET.
 * En vigia-api-dev son los de la cuenta de prueba (vendedor de prueba): ahí se paga con las tarjetas de prueba.
 */
const API_MP = "https://api.mercadopago.com";

export const mpConfigurado = () => Boolean(process.env.MP_ACCESS_TOKEN && process.env.MP_PUBLIC_KEY);
export const mpPublicKey = () => (mpConfigurado() ? (process.env.MP_PUBLIC_KEY as string) : null);

/** Una respuesta de error de Mercado Pago (el cuerpo no se reenvía al navegador). */
export class ErrorMp extends Error {
  constructor(public status: number, public cuerpo: unknown) {
    super(`Mercado Pago respondió ${status}`);
  }
}

async function mp<T>(ruta: string, init: { metodo?: "GET" | "POST"; cuerpo?: unknown; idempotencia?: string } = {}): Promise<T> {
  const r = await fetch(`${API_MP}${ruta}`, {
    method: init.metodo ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.idempotencia ? { "X-Idempotency-Key": init.idempotencia } : {}),
    },
    body: init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorMp(r.status, j);
  return j as T;
}

export interface PagoMp {
  id: number;
  status: string;
  status_detail: string;
  external_reference: string | null;
  transaction_amount: number;
}
export interface SuscripcionMp {
  id: string;
  status: string;
  external_reference: string | null;
}
export interface CobroMp {
  id: number;
  preapproval_id: string;
  transaction_amount: number;
  payment?: { id: number; status: string; status_detail?: string } | null;
}

/** Lo que entrega el Card Payment Brick (más el correo de quien paga). */
export interface Tarjeta {
  token: string;
  paymentMethodId: string;
  issuerId?: string | number;
  email: string;
  identificacion?: { tipo: string; numero: string };
}

export function crearPago(t: Tarjeta, monto: number, codigo: string): Promise<PagoMp> {
  return mp<PagoMp>("/v1/payments", {
    metodo: "POST",
    idempotencia: `pago-${codigo}`,
    cuerpo: {
      transaction_amount: monto,
      token: t.token,
      installments: 1,
      payment_method_id: t.paymentMethodId,
      ...(t.issuerId ? { issuer_id: Number(t.issuerId) } : {}),
      description: `Aporte a Vigía Perú ${codigo}`,
      external_reference: codigo,
      statement_descriptor: "VIGIA GOBSERVA",
      payer: {
        email: t.email,
        ...(t.identificacion ? { identification: { type: t.identificacion.tipo, number: t.identificacion.numero } } : {}),
      },
    },
  });
}

/** Suscripción sin plan, ya autorizada con la tarjeta: Mercado Pago cobra `monto` cada mes hasta que se cancele. */
export function crearSuscripcion(t: Tarjeta, monto: number, codigo: string, volver: string): Promise<SuscripcionMp> {
  return mp<SuscripcionMp>("/preapproval", {
    metodo: "POST",
    idempotencia: `suscripcion-${codigo}`,
    cuerpo: {
      reason: "Aporte mensual a Vigía Perú",
      external_reference: codigo,
      payer_email: t.email,
      card_token_id: t.token,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: monto, currency_id: "PEN" },
      back_url: volver,
      status: "authorized",
    },
  });
}

export const leerPago = (id: string) => mp<PagoMp>(`/v1/payments/${encodeURIComponent(id)}`);
export const leerSuscripcion = (id: string) => mp<SuscripcionMp>(`/preapproval/${encodeURIComponent(id)}`);
export const leerCobro = (id: string) => mp<CobroMp>(`/authorized_payments/${encodeURIComponent(id)}`);
export const leerContracargo = (id: string) => mp<{ id: string; payments?: (number | string)[] }>(`/v1/chargebacks/${encodeURIComponent(id)}`);

/**
 * La firma de un aviso: `x-signature: ts=…,v1=…`, con v1 = HMAC-SHA256 (hex) de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * con la clave secreta del webhook. El `data.id` es el de la URL del aviso (en minúsculas si es alfanumérico); una parte
 * que no vino se omite.
 */
export async function firmaValida(
  secreto: string | undefined,
  firma: string | null | undefined,
  requestId: string | null | undefined,
  dataId: string | null | undefined,
): Promise<boolean> {
  if (!secreto || !firma) return false;
  const partes = new Map<string, string>();
  for (const p of firma.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) partes.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !v1) return false;
  const manifiesto =
    (dataId ? `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};` : "") +
    (requestId ? `request-id:${requestId};` : "") +
    `ts:${ts};`;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(manifiesto)));
  const esperado = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return iguales(esperado, v1.toLowerCase());
}

function iguales(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/** Por qué no se aprobó un pago, dicho para quien paga (status_detail de Mercado Pago). */
const RECHAZOS: Record<string, string> = {
  cc_rejected_insufficient_amount: "La tarjeta no tiene saldo suficiente.",
  cc_rejected_bad_filled_security_code: "Revisa el código de seguridad de la tarjeta.",
  cc_rejected_bad_filled_date: "Revisa la fecha de vencimiento de la tarjeta.",
  cc_rejected_bad_filled_card_number: "Revisa el número de la tarjeta.",
  cc_rejected_bad_filled_other: "Revisa los datos de la tarjeta.",
  cc_rejected_call_for_authorize: "Tu banco pide que autorices este pago: comunícate con él y vuelve a intentarlo.",
  cc_rejected_card_disabled: "La tarjeta no está activa: actívala con tu banco o usa otra.",
  cc_rejected_duplicated_payment: "Ya hiciste un pago igual hace un momento.",
  cc_rejected_high_risk: "El pago no se aprobó por seguridad. Prueba con otra tarjeta.",
  cc_rejected_max_attempts: "Llegaste al límite de intentos con esta tarjeta. Prueba con otra.",
  cc_rejected_blacklist: "El pago no se aprobó. Prueba con otra tarjeta.",
  cc_rejected_other_reason: "Tu banco no aprobó el pago. Prueba con otra tarjeta.",
};
export const mensajeRechazo = (detalle: string | null | undefined) =>
  (detalle && RECHAZOS[detalle]) || "El pago no se aprobó. Prueba con otra tarjeta o con Yape o Plin.";
