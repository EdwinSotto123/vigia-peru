/**
 * Correo de Gobserva por Amazon SES (2026-11-01): alertas, recordatorios y recibos, desde alertas@gobserva.cloud.
 *
 * El dominio gobserva.cloud está verificado en SES (us-east-2) con DKIM y MAIL FROM propio (mail.gobserva.cloud), y la
 * cuenta tiene la lista de supresión de rebotes y quejas. Se llama a la API v2 de SES (SendEmail) firmando con SigV4 en
 * WebCrypto: sin SDK ni dependencias, corre igual en Workers y en Node.
 *
 * Secretos del Worker: SES_ACCESS_KEY_ID y SES_SECRET_ACCESS_KEY (un usuario IAM que sólo puede enviar desde
 * @gobserva.cloud: infrastructure/aws/crear_envio_ses.sh). Sin ellos `correoConfigurado()` es false y nada se envía: lo
 * avisado queda en la bandeja de la cuenta, en la web. Variables: SES_REGION (us-east-2), CORREO_REMITENTE.
 */

const REGION = () => process.env.SES_REGION || "us-east-2";
const REMITENTE = () => process.env.CORREO_REMITENTE || "Gobserva <alertas@gobserva.cloud>";
export const RESPONDER_A = "hello@gobserva.cloud";

export const correoConfigurado = () => Boolean(process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY);

export interface Correo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** Enlace de baja de un clic (cabeceras List-Unsubscribe, RFC 8058). */
  baja?: string;
}

export class ErrorCorreo extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hmac(clave: ArrayBuffer | Uint8Array, dato: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", clave as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(dato));
}

/** Firma SigV4 de un POST JSON a SES: devuelve las cabeceras que lo autorizan. */
async function firmar(host: string, ruta: string, cuerpo: string, ahora = new Date()): Promise<Record<string, string>> {
  const fecha = ahora.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20261101T120000Z
  const dia = fecha.slice(0, 8);
  const hashCuerpo = await sha256(cuerpo);
  const cabeceras: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": hashCuerpo,
    "x-amz-date": fecha,
  };
  const nombres = Object.keys(cabeceras).sort();
  const canonica = ["POST", ruta, "", ...nombres.map((n) => `${n}:${cabeceras[n]}`), "", nombres.join(";"), hashCuerpo].join("\n");
  const alcance = `${dia}/${REGION()}/ses/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", fecha, alcance, await sha256(canonica)].join("\n");
  let clave: ArrayBuffer = await hmac(enc.encode(`AWS4${process.env.SES_SECRET_ACCESS_KEY}`), dia);
  for (const parte of [REGION(), "ses", "aws4_request"]) clave = await hmac(clave, parte);
  const firma = hex(await hmac(clave, aFirmar));
  return {
    ...cabeceras,
    authorization: `AWS4-HMAC-SHA256 Credential=${process.env.SES_ACCESS_KEY_ID}/${alcance}, SignedHeaders=${nombres.join(";")}, Signature=${firma}`,
  };
}

/** Envía un correo. Devuelve el id del mensaje de SES; lanza ErrorCorreo si SES lo rechaza o no está configurado. */
export async function enviarCorreo(c: Correo): Promise<string> {
  if (!correoConfigurado()) throw new ErrorCorreo(503, "correo_sin_configurar");
  const host = `email.${REGION()}.amazonaws.com`;
  const ruta = "/v2/email/outbound-emails";
  const cuerpo = JSON.stringify({
    FromEmailAddress: REMITENTE(),
    Destination: { ToAddresses: [c.para] },
    ReplyToAddresses: [RESPONDER_A],
    Content: {
      Simple: {
        Subject: { Data: c.asunto, Charset: "UTF-8" },
        Body: { Html: { Data: c.html, Charset: "UTF-8" }, Text: { Data: c.texto, Charset: "UTF-8" } },
        ...(c.baja
          ? { Headers: [{ Name: "List-Unsubscribe", Value: `<${c.baja}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] }
          : {}),
      },
    },
  });
  // `host` se firma pero no se manda: fetch lo pone de la URL (y algunos entornos rechazan que se fije a mano).
  const { host: _host, ...cabeceras } = await firmar(host, ruta, cuerpo);
  const r = await fetch(`https://${host}${ruta}`, { method: "POST", headers: cabeceras, body: cuerpo });
  const j = (await r.json().catch(() => null)) as { MessageId?: string; message?: string } | null;
  if (!r.ok) throw new ErrorCorreo(r.status, (j?.message ?? `SES respondió ${r.status}`).slice(0, 300));
  return j?.MessageId ?? "";
}

// ─── Plantilla ────────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface FilaCorreo {
  titulo: string;
  enlace: string;
  /** Datos cortos debajo del título: «S/ 3,500 al mes», «Cierra el 5 nov.», «Cusco». */
  datos: string[];
  /** Una etiqueta destacada (en ámbar): «Cierra mañana». */
  marca?: string;
}

export interface ContenidoCorreo {
  /** «empleo», «licitaciones» u «obras»: va junto a la marca. */
  producto: string;
  titular: string;
  bajada: string;
  filas?: FilaCorreo[];
  /** Párrafos de texto (recibos, avisos). */
  parrafos?: string[];
  /** Pares etiqueta y valor (el detalle de un recibo). */
  detalle?: [string, string][];
  boton?: { texto: string; enlace: string };
  pie: string[];
}

/** Un correo con la marca de Gobserva: HTML con estilos en línea (los clientes de correo ignoran las hojas) y su texto. */
export function armarCorreo(c: ContenidoCorreo): { html: string; texto: string } {
  const filas = (c.filas ?? [])
    .map(
      (f) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e3e8e3">
  ${f.marca ? `<div style="display:inline-block;margin-bottom:6px;padding:2px 8px;border-radius:999px;background:#fff4d6;color:#7a5200;font-size:12px;font-weight:600">${esc(f.marca)}</div>` : ""}
  <a href="${esc(f.enlace)}" style="display:block;color:#123d1f;font-size:16px;font-weight:700;line-height:1.35;text-decoration:none">${esc(f.titulo)}</a>
  <div style="margin-top:4px;color:#4b5a4f;font-size:13px;line-height:1.5">${f.datos.map(esc).join(" &nbsp;|&nbsp; ")}</div>
</td></tr>`,
    )
    .join("");
  const parrafos = (c.parrafos ?? []).map((p) => `<p style="margin:0 0 12px;color:#26332a;font-size:15px;line-height:1.6">${esc(p)}</p>`).join("");
  const detalle = c.detalle?.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;margin:8px 0 16px">${c.detalle
        .map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b6a5f;font-size:13px">${esc(k)}</td><td style="padding:6px 0;color:#16211a;font-size:14px;font-weight:600;text-align:right">${esc(v)}</td></tr>`)
        .join("")}</table>`
    : "";
  const boton = c.boton
    ? `<p style="margin:20px 0 4px"><a href="${esc(c.boton.enlace)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f5c2e;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${esc(c.boton.texto)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.titular)}</title></head>
<body style="margin:0;background:#f2f5f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;border-collapse:collapse;background:#ffffff;border-radius:16px">
<tr><td style="padding:22px 24px;background:#0b1a10;border-radius:16px 16px 0 0">
  <span style="font-family:Menlo,Consolas,monospace;font-size:20px;font-weight:700;color:#ffffff">gobserva<span style="color:#d4ff3f">_</span></span>
  <span style="margin-left:8px;padding:2px 8px;border:1px solid #d4ff3f;border-radius:8px;color:#d4ff3f;font-family:Menlo,Consolas,monospace;font-size:13px">${esc(c.producto)}</span>
</td></tr>
<tr><td style="padding:24px">
  <h1 style="margin:0 0 6px;color:#0f1a12;font-size:22px;line-height:1.3">${esc(c.titular)}</h1>
  <p style="margin:0 0 16px;color:#4b5a4f;font-size:15px;line-height:1.5">${esc(c.bajada)}</p>
  ${parrafos}${detalle}
  ${filas ? `<table role="presentation" width="100%" style="border-collapse:collapse">${filas}</table>` : ""}
  ${boton}
</td></tr>
<tr><td style="padding:18px 24px;border-top:1px solid #e3e8e3;color:#6b786e;font-size:12px;line-height:1.6">${c.pie.map(esc).join("<br>")}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [
    c.titular,
    c.bajada,
    "",
    ...(c.parrafos ?? []),
    ...(c.detalle ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(c.filas ?? []).flatMap((f) => [`${f.marca ? `[${f.marca}] ` : ""}${f.titulo}`, `  ${f.datos.join(" | ")}`, `  ${f.enlace}`, ""]),
    c.boton ? `${c.boton.texto}: ${c.boton.enlace}` : "",
    "",
    ...c.pie,
  ].join("\n");
  return { html, texto };
}
