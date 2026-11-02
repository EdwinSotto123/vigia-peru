/**
 * Correo de Gobserva (2026-11-01): alertas, recordatorios y recibos, desde alertas@gobserva.cloud por Amazon SES.
 *
 * La API no tiene llaves de AWS: le pide cada envío a la Lambda `vigia-gobserva-correo` (infrastructure/aws/
 * correo_gobserva), cuyo rol sólo puede mandar desde @gobserva.cloud. El dominio está verificado en SES (us-east-2) con
 * DKIM y MAIL FROM propio (mail.gobserva.cloud), y la cuenta tiene la lista de supresión de rebotes y quejas.
 *
 * Secretos del Worker: CORREO_URL (la URL de la función) y CORREO_TOKEN. Sin ellos no se envía nada y lo avisado queda en
 * la bandeja de la cuenta, en la web. Mientras SES tenga la cuenta en sandbox sólo llega a direcciones @gobserva.cloud:
 * la Lambda lo dice (GET) y `estadoCorreo()` lo guarda diez minutos, para no prometer correos que no salen.
 */
import { Memo } from "./cache.js";

export const RESPONDER_A = "hello@gobserva.cloud";

export const correoConfigurado = () => Boolean(process.env.CORREO_URL && process.env.CORREO_TOKEN);

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

export interface EstadoCorreo {
  configurado: boolean;
  /** SES fuera del sandbox: llega a cualquier dirección. */
  produccion: boolean;
  /** La solicitud de producción en SES: PENDING, DENIED, GRANTED… (null si no se sabe). */
  revision: string | null;
}

const memoEstado = new Memo<EstadoCorreo>({ nombre: "correo-estado", ttlMs: 600_000, staleMs: 3_600_000, max: 1 });

const llamar = (metodo: "GET" | "POST", cuerpo?: string) =>
  fetch(process.env.CORREO_URL as string, {
    method: metodo,
    headers: { authorization: `Bearer ${process.env.CORREO_TOKEN}`, "content-type": "application/json" },
    body: cuerpo,
  });

/** Si el correo está configurado y si SES ya salió del sandbox (diez minutos en memoria). */
export function estadoCorreo(): Promise<EstadoCorreo> {
  if (!correoConfigurado()) return Promise.resolve({ configurado: false, produccion: false, revision: null });
  return memoEstado.obtener("estado", async () => {
    try {
      const r = await llamar("GET");
      const j = (await r.json().catch(() => null)) as { produccion?: boolean; revision?: string | null } | null;
      return { configurado: true, produccion: r.ok && !!j?.produccion, revision: j?.revision ?? null };
    } catch {
      return { configurado: true, produccion: false, revision: null };
    }
  });
}

/** Si los avisos salen por correo a cualquiera (para decirlo en las páginas y en el panel). */
export const correoAbierto = async () => (await estadoCorreo()).produccion;

/** Si a esta dirección le llega un correo hoy: en sandbox, sólo a @gobserva.cloud. */
export async function llegaCorreo(email: string): Promise<boolean> {
  const e = await estadoCorreo();
  return e.configurado && (e.produccion || email.toLowerCase().endsWith("@gobserva.cloud"));
}

/** Envía un correo. Devuelve el id del mensaje de SES; lanza ErrorCorreo si no se pudo. */
export async function enviarCorreo(c: Correo): Promise<string> {
  if (!correoConfigurado()) throw new ErrorCorreo(503, "correo_sin_configurar");
  const r = await llamar("POST", JSON.stringify({ para: c.para, asunto: c.asunto, html: c.html, texto: c.texto, baja: c.baja }));
  const j = (await r.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string; detail?: string } | null;
  if (!r.ok || !j?.ok) throw new ErrorCorreo(r.status, (j?.detail || j?.error || `El envío respondió ${r.status}`).slice(0, 300));
  return j.id ?? "";
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
