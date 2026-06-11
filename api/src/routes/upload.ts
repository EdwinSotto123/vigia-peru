/**
 * Endpoint para firmar URLs de upload a GCS.
 *
 * Flujo:
 *  1. Frontend pide: POST /upload/sign { bucket, filename, contentType }
 *  2. API devuelve: { uploadUrl, blobUrl }
 *  3. Frontend hace: PUT uploadUrl (Content-Type debe coincidir)
 *  4. Frontend nos manda blobUrl al endpoint que guarda en BD
 *
 * Anti-abuso básico: requireAuth para que sólo usuarios logueados puedan
 * generar URLs. Los buckets son public-read, los uploads no.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { signUploadUrl, type BucketName } from "../lib/storage.js";

export const uploadRouter = new Hono();

const SignBody = z.object({
  bucket: z.enum(["documentos", "reportes"]),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
});

uploadRouter.post("/sign", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SignBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const { bucket, filename, contentType } = parsed.data;

  // Prefija con uid del usuario para evitar colisiones y trazabilidad
  const user = c.var.user;
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = Date.now();
  const finalName = `${user.uid}/${ts}-${safe}`;

  const { uploadUrl, blobUrl } = await signUploadUrl({
    bucket: bucket as BucketName,
    filename: finalName,
    contentType,
  });
  return c.json({ uploadUrl, blobUrl, filename: finalName });
});
