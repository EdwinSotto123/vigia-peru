/**
 * GCS en Workers, sin SDK: la API JSON por fetch con el access token de GCP_SA_KEY, y URLs firmadas
 * v4 (GOOG4-RSA-SHA256) firmadas localmente con la llave de esa cuenta (workers/google.ts).
 *
 * La firma reproduce la de @google-cloud/storage (host de ruta `storage.googleapis.com/<bucket>/…`,
 * `host` y `content-type` como cabeceras firmadas, `UNSIGNED-PAYLOAD`, mismos parámetros y
 * codificación): con la misma llave y la misma hora, la URL es idéntica (test/gcs.test.ts).
 */

import type { MetadatosObjeto, OpcionesFirma } from "../lib/plataforma.js";
import { credencial, tokenAccesoCuenta } from "./google.js";

const HOST = "storage.googleapis.com";
const SIETE_DIAS_S = 7 * 24 * 60 * 60;

/** Codificación de la firma v4: todo salvo `A-Z a-z 0-9 - . _ ~` (y `/` en rutas, si `barra` es false). */
const componente = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const codificar = (s: string, barra: boolean) => s.split("/").map(componente).join(barra ? "%2F" : "/");

const dos = (n: number) => String(n).padStart(2, "0");
/** `YYYYMMDD` o `YYYYMMDDTHHMMSSZ` en UTC. */
function fechaUtc(d: Date, conHora = false): string {
  const fecha = `${String(d.getUTCFullYear()).padStart(4, "0")}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`;
  return conHora ? `${fecha}T${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}Z` : fecha;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function sha256Hex(texto: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto))));
}

/** URL firmada v4 de `gs://bucket/ruta`. `ahoraMs` sólo para las pruebas. */
export async function firmarUrlV4(bucket: string, ruta: string, o: OpcionesFirma, ahoraMs = Date.now()): Promise<string> {
  const cred = credencial();
  const expiraS = Math.floor(new Date(o.expires).valueOf() / 1000);
  if (Number.isNaN(expiraS)) throw new Error("fecha de vencimiento inválida");
  if (expiraS * 1000 < ahoraMs) throw new Error("la fecha de vencimiento ya pasó");
  const desde = new Date(Math.floor(ahoraMs / 1000) * 1000);
  const periodo = expiraS - desde.valueOf() / 1000;
  if (periodo > SIETE_DIAS_S) throw new Error(`vencimiento máximo: siete días (${SIETE_DIAS_S} s)`);

  const cabeceras: Record<string, string> = { host: HOST };
  if (o.contentType) cabeceras["content-type"] = o.contentType;
  const nombres = Object.keys(cabeceras).sort();
  const firmadas = nombres.join(";");
  const canonicas = nombres.map((k) => `${k}:${cabeceras[k].trim().replace(/\s{2,}/g, " ")}\n`).join("");

  const fecha = fechaUtc(desde);
  const fechaHora = fechaUtc(desde, true);
  const alcance = `${fecha}/auto/storage/goog4_request`;
  const query: Record<string, string> = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${cred.email}/${alcance}`,
    "X-Goog-Date": fechaHora,
    "X-Goog-Expires": String(periodo),
    "X-Goog-SignedHeaders": firmadas,
  };
  if (typeof o.responseType === "string") query["response-content-type"] = o.responseType;
  if (typeof o.responseDisposition === "string") query["response-content-disposition"] = o.responseDisposition;

  const recurso = `/${bucket}/${codificar(ruta, false)}`;
  const queryCanonica = Object.entries(query)
    .map(([k, v]) => [codificar(k, true), codificar(v, true)])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const metodo = o.action === "write" ? "PUT" : "GET";
  const pedidoCanonico = [metodo, recurso, queryCanonica, canonicas, firmadas, "UNSIGNED-PAYLOAD"].join("\n");
  const aFirmar = ["GOOG4-RSA-SHA256", fechaHora, alcance, await sha256Hex(pedidoCanonico)].join("\n");
  const firma = hex(await cred.firmar(aFirmar));

  const final = { ...query, "X-Goog-Signature": firma };
  const busqueda = Object.entries(final).map(([k, v]) => `${codificar(k, true)}=${codificar(v, true)}`).join("&");
  return `https://${HOST}${recurso}?${busqueda}`;
}

// ─── API JSON ────────────────────────────────────────────────────────────────
/** Error de GCS con el status HTTP en `code` (como el ApiError del SDK). */
class ErrorGcs extends Error {
  constructor(readonly code: number, mensaje: string) {
    super(mensaje);
  }
}

async function pedirObjeto(bucket: string, ruta: string, media: boolean): Promise<Response> {
  const token = await tokenAccesoCuenta();
  const url = `https://${HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(ruta)}${media ? "?alt=media" : ""}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ErrorGcs(r.status, `GCS ${r.status} en gs://${bucket}/${ruta}: ${j?.error?.message ?? "sin detalle"}`);
  }
  return r;
}

export async function metadatosObjeto(bucket: string, ruta: string): Promise<MetadatosObjeto> {
  return (await (await pedirObjeto(bucket, ruta, false)).json()) as MetadatosObjeto;
}

export async function descargarObjeto(bucket: string, ruta: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await pedirObjeto(bucket, ruta, true)).arrayBuffer());
}
