/**
 * vigia-gobserva-correo (2026-11-01): manda los correos de Gobserva por Amazon SES. La API (un Worker de Cloudflare) no
 * tiene llaves de AWS: le pide el envío a esta función por su URL, con un token. El rol de la función sólo puede enviar
 * desde @gobserva.cloud y leer el estado de la cuenta de SES.
 *
 *   POST  {para, asunto, html, texto, baja?}  →  {ok, id}       envía un correo (baja: enlace de un clic, RFC 8058)
 *   GET                                       →  {produccion}   si SES ya salió del sandbox (si no, sólo llega a @gobserva.cloud)
 *
 * Variables: TOKEN (el mismo de CORREO_TOKEN en el Worker), REMITENTE, RESPONDER_A. Se despliega con desplegar.py.
 */
import { GetAccountCommand, SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { timingSafeEqual } from "node:crypto";

const ses = new SESv2Client({});
const TOKEN = process.env.TOKEN ?? "";
const REMITENTE = process.env.REMITENTE ?? "Gobserva <alertas@gobserva.cloud>";
const RESPONDER_A = process.env.RESPONDER_A ?? "hello@gobserva.cloud";
const CORREO = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
const BAJA = /^https:\/\/[a-z0-9.-]+\.gobserva\.cloud\/[^\s<>"]*$/;

const respuesta = (status, cuerpo) => ({ statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

function autorizado(evento) {
  const dado = Buffer.from(String(evento.headers?.authorization ?? ""));
  const esperado = Buffer.from(`Bearer ${TOKEN}`);
  return TOKEN.length >= 32 && dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

export const handler = async (evento) => {
  if (!autorizado(evento)) return respuesta(401, { error: "no_autorizado" });
  const metodo = evento.requestContext?.http?.method;

  if (metodo === "GET") {
    const c = await ses.send(new GetAccountCommand({}));
    return respuesta(200, {
      produccion: !!c.ProductionAccessEnabled,
      envio: !!c.SendingEnabled,
      cuota: { dia: c.SendQuota?.Max24HourSend ?? null, enviados: c.SendQuota?.SentLast24Hours ?? null },
      revision: c.Details?.ReviewDetails?.Status ?? null,
    });
  }
  if (metodo !== "POST") return respuesta(405, { error: "metodo" });

  let c;
  try {
    c = JSON.parse(evento.isBase64Encoded ? Buffer.from(evento.body ?? "", "base64").toString("utf8") : (evento.body ?? ""));
  } catch {
    return respuesta(400, { error: "json" });
  }
  const { para, asunto, html, texto, baja } = c ?? {};
  if (typeof para !== "string" || !CORREO.test(para) || para.length > 254) return respuesta(400, { error: "para" });
  if (typeof asunto !== "string" || !asunto.trim() || asunto.length > 200) return respuesta(400, { error: "asunto" });
  if (typeof html !== "string" || html.length > 400_000 || typeof texto !== "string" || texto.length > 200_000) return respuesta(400, { error: "cuerpo" });

  const cabeceras = typeof baja === "string" && BAJA.test(baja)
    ? [{ Name: "List-Unsubscribe", Value: `<${baja}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }]
    : undefined;
  try {
    const r = await ses.send(new SendEmailCommand({
      FromEmailAddress: REMITENTE,
      ReplyToAddresses: [RESPONDER_A],
      Destination: { ToAddresses: [para] },
      Content: {
        Simple: {
          Subject: { Data: asunto, Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: texto, Charset: "UTF-8" } },
          ...(cabeceras ? { Headers: cabeceras } : {}),
        },
      },
    }));
    return respuesta(200, { ok: true, id: r.MessageId ?? null });
  } catch (e) {
    // MessageRejected en sandbox = el destinatario no está verificado; el Worker lo deja en la bandeja de la web.
    return respuesta(502, { error: e?.name ?? "ses", detail: String(e?.message ?? "").slice(0, 300) });
  }
};
