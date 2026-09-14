/**
 * Cliente GCS + helper para firmar URLs de upload.
 *
 * Flujo de upload desde el frontend:
 *  1. Cliente pide POST /upload/sign con {bucket, filename, contentType}
 *  2. API devuelve {uploadUrl, blobUrl} — uploadUrl tiene firma temporal
 *  3. Cliente hace PUT directo a uploadUrl (no pasa por la API)
 *  4. Cuando termina, cliente nos manda el blobUrl y lo guardamos en Postgres
 *
 * Esto evita que la foto pase por nuestro Cloud Run (ahorra egress y memoria).
 */

import { Storage } from "@google-cloud/storage";

export const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
});

export const BUCKETS = {
  documentos: process.env.GCS_BUCKET_DOCUMENTOS ?? "vigia-peru-documentos",
  reportes: process.env.GCS_BUCKET_REPORTES ?? "vigia-peru-reportes",
} as const;

export type BucketName = keyof typeof BUCKETS;

export async function signUploadUrl(opts: {
  bucket: BucketName;
  filename: string;
  contentType: string;
  expiresInMs?: number;
}): Promise<{ uploadUrl: string; blobUrl: string }> {
  const bucketName = BUCKETS[opts.bucket];
  const file = storage.bucket(bucketName).file(opts.filename);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + (opts.expiresInMs ?? 15 * 60 * 1000),
    contentType: opts.contentType,
  });
  // Como los buckets son public-read, el blobUrl es directo
  const blobUrl = `https://storage.googleapis.com/${bucketName}/${opts.filename}`;
  return { uploadUrl, blobUrl };
}
