/**
 * POST /api/upload
 *
 * Recibe multipart con un campo "file" (foto o documento de un reporte
 * ciudadano), lo sube al bucket público `vigia-peru-reportes` en GCS y
 * devuelve la URL pública.
 */
import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = process.env.REPORTES_BUCKET || "hacklatam-vigia-reportes";

let _storage: Storage | null = null;
function getStorage() {
  if (_storage) return _storage;
  _storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "vivid-spot-480905-a4",
  });
  return _storage;
}

// Permite hasta 50MB por archivo. Suficiente para fotos hi-res, videos cortos
// (móvil, ~30 seg) y documentos PDF voluminosos.
const MAX_BYTES = 50 * 1024 * 1024;

function detectarTipo(file: File): "foto" | "video" | "documento" | "audio" {
  const ct = (file.type || "").toLowerCase();
  if (ct.startsWith("image/")) return "foto";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  return "documento";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "file_too_big", detail: `máx ${MAX_BYTES / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 8);
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const tipo = detectarTipo(file);
    const path = `reportes/${stamp}.${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const bucket = getStorage().bucket(BUCKET);
    const blob = bucket.file(path);
    await blob.save(buf, {
      contentType: file.type || "application/octet-stream",
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000" },
    });

    const url = `https://storage.googleapis.com/${BUCKET}/${path}`;
    return NextResponse.json({
      ok: true, url, path, tipo,
      filename: file.name,
      size_bytes: file.size,
      content_type: file.type || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "upload_failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
