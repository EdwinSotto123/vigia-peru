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

async function mp<T>(
  ruta: string,
  init: { metodo?: "GET" | "POST" | "PUT"; cuerpo?: unknown; idempotencia?: string; cabeceras?: Record<string, string> } = {},
): Promise<T> {
  const r = await fetch(`${API_MP}${ruta}`, {
    method: init.metodo ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.idempotencia ? { "X-Idempotency-Key": init.idempotencia } : {}),
      ...init.cabeceras,
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
  currency_id?: string;
  /** La cuenta que cobra: debe ser la de Vigía (cuentaPropia). */
  collector_id?: number;
  transaction_amount_refunded?: number;
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
  currency_id?: string;
  payment?: { id: number; status: string; status_detail?: string } | null;
}

/** Lo que entrega el Card Payment Brick (más el correo de quien paga y el dispositivo, para el antifraude). */
export interface Tarjeta {
  token: string;
  paymentMethodId: string;
  issuerId?: string | number;
  email: string;
  identificacion?: { tipo: string; numero: string };
  /** `MP_DEVICE_SESSION_ID` del script de seguridad de Mercado Pago (va en X-meli-session-id). */
  dispositivo?: string;
}

/** Cómo aparece en el estado de cuenta de la tarjeta (Mercado Pago admite hasta 13 caracteres). */
export const DESCRIPTOR = "VIGIA PERU";

/**
 * `ip`: la de quien aporta. Con el dispositivo y el detalle del ítem, el antifraude de Mercado Pago tiene con qué
 * separar a una persona de quien prueba tarjetas robadas (y aprueba más pagos legítimos).
 */
export function crearPago(t: Tarjeta, monto: number, codigo: string, ip?: string): Promise<PagoMp> {
  return mp<PagoMp>("/v1/payments", {
    metodo: "POST",
    idempotencia: `pago-${codigo}`,
    cabeceras: t.dispositivo && /^[\w.:-]{1,200}$/.test(t.dispositivo) ? { "X-meli-session-id": t.dispositivo } : undefined,
    cuerpo: {
      transaction_amount: monto,
      token: t.token,
      installments: 1,
      payment_method_id: t.paymentMethodId,
      ...(t.issuerId ? { issuer_id: Number(t.issuerId) } : {}),
      description: `Aporte a Vigía Perú ${codigo}`,
      external_reference: codigo,
      statement_descriptor: DESCRIPTOR,
      payer: {
        email: t.email,
        ...(t.identificacion ? { identification: { type: t.identificacion.tipo, number: t.identificacion.numero } } : {}),
      },
      additional_info: {
        items: [{ id: "aporte-vigilancia", title: "Aporte a Vigía Perú", description: "Donación voluntaria para seguir vigilando", quantity: 1, unit_price: monto }],
        ...(ip && ip !== "desconocida" ? { ip_address: ip } : {}),
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
/** Detiene el cobro mensual (lo pide quien aporta desde su comprobante, routes/pagos.ts). */
export const cancelarSuscripcion = (id: string) =>
  mp<SuscripcionMp>(`/preapproval/${encodeURIComponent(id)}`, { metodo: "PUT", cuerpo: { status: "cancelled" } });

/** El id de la cuenta de Mercado Pago de Vigía (la del token), leído una vez por instancia. */
let cuenta: Promise<number | null> | null = null;
export function cuentaPropia(): Promise<number | null> {
  cuenta ??= mp<{ id: number }>("/users/me").then((u) => u.id ?? null, () => {
    cuenta = null;   // se vuelve a intentar en el próximo aviso
    return null;
  });
  return cuenta;
}

/**
 * Un pago aprobado valida un aporte sólo si es lo que se esperaba: en soles, por el monto del aporte y cobrado por la
 * cuenta de Vigía (auditoría 2026-10-30: antes bastaba la referencia; el cobro mínimo de verificación de una suscripción
 * o un pago de otro monto con la misma referencia validaba el aporte). `propia` null = no se pudo leer la cuenta: no se
 * descarta por eso (lo demás igual se mira).
 */
export function corresponde(p: Pick<PagoMp, "transaction_amount" | "currency_id" | "collector_id">, monto: number, propia: number | null): boolean {
  if ((p.currency_id ?? "PEN") !== "PEN") return false;
  if (Math.abs(Number(p.transaction_amount) - monto) >= 0.005) return false;
  return propia == null || p.collector_id == null || p.collector_id === propia;
}

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

/**
 * Por qué no se aprobó un pago, dicho para quien paga: UN solo mensaje (auditoría 2026-10-30). Decir «sin saldo» o
 * «revisa el código de seguridad» le confirma a quien prueba tarjetas robadas que la tarjeta existe. El motivo de Mercado
 * Pago (status_detail) queda en `rechazada_motivo` para atender a quien escriba.
 */
export const MENSAJE_RECHAZO = "Tu banco o Mercado Pago no aprobó el pago. Revisa los datos, prueba con otra tarjeta o aporta con QR.";
export const mensajeRechazo = (_detalle?: string | null) => MENSAJE_RECHAZO;
