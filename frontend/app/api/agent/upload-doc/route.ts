/**
 * POST /api/agent/upload-doc
 *
 * Sube UN PDF/DOCX/ZIP a GCS (bucket DOCS_BUCKET). El cliente llama esta ruta
 * una vez por documento para evitar que el body del análisis exceda 32 MB de
 * Cloud Run. Después el cliente pasa los `gcs_url` resultantes al endpoint
 * `/api/agent/analyze/stream` en el campo `doc_urls`.
 *
 * Body:
 *   {
 *     ocid: string,
 *     url: string,           // URL original del documento (clave de mapeo)
 *     base64: string,        // contenido del documento en base64
 *     filename: string,
 *     contentType?: string,
 *   }
 *
 * Response:
 *   { ok: true, original_url: "...", gcs_url: "https://...", gcs_path: "gs://..." }
 */
import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DOCS_BUCKET = process.env.DOCS_BUCKET || "vigia-peru-documentos";

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (_storage) return _storage;
  _storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "vivid-spot-480905-a4",
  });
  return _storage;
}

function safeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 200);
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { ocid, url, base64, filename, contentType } = body || {};
  if (!ocid || !url || !base64) {
    return NextResponse.json({ error: "missing fields (ocid, url, base64)" }, { status: 400 });
  }

  try {
    const cleanOcid = safeName(ocid);
    const safeFile = safeName(filename || "doc.bin");
    const path = `convocatorias/${cleanOcid}/${safeFile}`;
    const buf = Buffer.from(base64, "base64");
    const bucket = getStorage().bucket(DOCS_BUCKET);
    const blob = bucket.file(path);
    await blob.save(buf, {
      contentType: contentType || "application/octet-stream",
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=86400",
        metadata: { ocid, original_url: url },
      },
    });
    return NextResponse.json({
      ok: true,
      original_url: url,
      gcs_url: `https://storage.googleapis.com/${DOCS_BUCKET}/${path}`,
      gcs_path: `gs://${DOCS_BUCKET}/${path}`,
      bytes: buf.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "gcs_upload_failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
