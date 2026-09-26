/**
 * GCS: buckets de Vigía + helpers para firmar URLs de upload/lectura y leer objetos privados.
 *
 * Flujo de upload desde el frontend:
 *  1. Cliente pide POST /upload/sign con {bucket, filename, contentType}
 *  2. API devuelve {uploadUrl, blobUrl} — uploadUrl tiene firma temporal
 *  3. Cliente hace PUT directo a uploadUrl (no pasa por la API)
 *  4. Cuando termina, cliente nos manda el blobUrl y lo guardamos en Postgres
 *
 * Esto evita que la foto pase por nuestro Cloud Run (ahorra egress y memoria).
 *
 * El acceso a GCS depende de dónde corre (lib/plataforma.ts): en Node, @google-cloud/storage con la
 * identidad del servicio (node/plataforma.ts); en Workers, la API REST de GCS y firma v4 con la
 * cuenta de servicio de GCP_SA_KEY (workers/gcs.ts).
 */

import { plataforma, type MetadatosObjeto } from "./plataforma.js";

export const BUCKETS = {
  documentos: process.env.GCS_BUCKET_DOCUMENTOS ?? "vigia-peru-documentos",
  reportes: process.env.GCS_BUCKET_REPORTES ?? "vigia-peru-reportes",
} as const;

export type BucketName = keyof typeof BUCKETS;

/**
 * Buckets donde puede vivir un comprobante de aporte (auditoría C4): el privado (el frontend sube
 * ahí desde la fase 0) y, por compatibilidad, el de documentos (ruta vieja `comprobantes/`). Nada
 * fuera de estos se lee ni se sirve.
 */
export const BUCKET_PRIVADO = process.env.GCS_BUCKET_PRIVADO || "vigia-peru-privado";
export const BUCKETS_COMPROBANTE: readonly string[] = Array.from(new Set([BUCKET_PRIVADO, BUCKETS.documentos]));

export const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `https://storage.googleapis.com/<bucket propio>/comprobantes/<archivo>` → {bucket, ruta}; si no, null. */
export function ubicarComprobante(url: string): { bucket: string; ruta: string } | null {
  const m = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(comprobantes\/[A-Za-z0-9._-]{1,120})$/);
  if (!m || !BUCKETS_COMPROBANTE.includes(m[1])) return null;
  return { bucket: m[1], ruta: m[2] };
}

export async function signUploadUrl(opts: {
  bucket: BucketName;
  filename: string;
  contentType: string;
  expiresInMs?: number;
}): Promise<{ uploadUrl: string; blobUrl: string }> {
  const bucketName = BUCKETS[opts.bucket];
  const uploadUrl = await plataforma().firmarUrl(bucketName, opts.filename, {
    action: "write",
    expires: Date.now() + (opts.expiresInMs ?? 15 * 60 * 1000),
    contentType: opts.contentType,
  });
  // Como los buckets son public-read, el blobUrl es directo
  const blobUrl = `https://storage.googleapis.com/${bucketName}/${opts.filename}`;
  return { uploadUrl, blobUrl };
}

/**
 * URL firmada de LECTURA (v4, 15 min) para un objeto `gs://bucket/ruta` — usada para
 * previsualizar/descargar documentos del SEACE guardados en el bucket de lotes (retención 90 días).
 * El bucket es privado: el enlace vence solo y no expone el resto del almacén.
 */
export async function signReadUrl(gsUri: string, opts: { expiresInMs?: number; filename?: string; contentType?: string } = {}): Promise<string> {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri);
  if (!m) throw new Error(`gs uri inválida: ${gsUri}`);
  return plataforma().firmarUrl(m[1], m[2], {
    action: "read",
    expires: Date.now() + (opts.expiresInMs ?? 15 * 60 * 1000),
    ...(opts.filename ? { responseDisposition: `inline; filename="${opts.filename.replace(/["\r\n]/g, "")}"` } : {}),
    ...(opts.contentType ? { responseType: opts.contentType } : {}),
  });
}

/** Metadatos de un objeto (tipo y tamaño); tira si no existe o no hay acceso. */
export function metadatosObjeto(bucket: string, ruta: string): Promise<MetadatosObjeto> {
  return plataforma().metadatosObjeto(bucket, ruta);
}

/** Contenido completo de un objeto; tira si no existe o no hay acceso. */
export function descargarObjeto(bucket: string, ruta: string): Promise<Uint8Array<ArrayBuffer>> {
  return plataforma().descargarObjeto(bucket, ruta);
}
