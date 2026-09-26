/**
 * Lectura y subida de objetos en Cloud Storage. Sólo servidor. La usan /api/upload,
 * /api/agent/upload-doc y /api/agent/analyze.
 *
 *  - Node (Cloud Run): `@google-cloud/storage` con las credenciales por defecto de la cuenta de
 *    servicio del frontend, como siempre. Se carga recién en la primera operación.
 *  - Cloudflare Workers: ese paquete no corre ahí (disco, sockets, servidor de metadatos). Se
 *    usa la API JSON con un access token de la misma cuenta de servicio (secreto `GCP_SA_KEY`,
 *    lib/cuenta-google.ts). Mismo objeto, mismos metadatos.
 */
import "server-only";
import type { Storage } from "@google-cloud/storage";
import { accessTokenDeCuenta } from "./cuenta-google";
import { EN_WORKERS } from "./entorno";

export interface OpcionesObjeto {
  contentType: string;
  cacheControl: string;
  /** Metadatos propios del objeto (se guardan como `x-goog-meta-*`). */
  metadata?: Record<string, string>;
}

/** Como `@google-cloud/storage`, respeta `STORAGE_EMULATOR_HOST` (un emulador local de GCS). */
const apiGcs = () => process.env.STORAGE_EMULATOR_HOST?.replace(/\/+$/, "") || "https://storage.googleapis.com";
const SCOPE_GCS = "https://www.googleapis.com/auth/devstorage.read_write";

let storage: Promise<Storage> | null = null;
function storageNode(): Promise<Storage> {
  storage ??= import("@google-cloud/storage").then(
    ({ Storage }) => new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "vivid-spot-480905-a4" }),
  );
  return storage;
}

async function autorizacion(): Promise<string> {
  return `Bearer ${await accessTokenDeCuenta(SCOPE_GCS)}`;
}

/** Guarda `datos` en `gs://bucket/ruta` (reemplaza si existe). Lanza si falla. */
export async function guardarObjeto(bucket: string, ruta: string, datos: Buffer | string, o: OpcionesObjeto): Promise<void> {
  if (!EN_WORKERS) {
    const s = await storageNode();
    await s.bucket(bucket).file(ruta).save(datos, {
      contentType: o.contentType,
      resumable: false,
      metadata: { cacheControl: o.cacheControl, ...(o.metadata ? { metadata: o.metadata } : {}) },
    });
    return;
  }

  // Subida `multipart`: los metadatos (JSON) y el contenido en un solo pedido.
  const limite = `vigia-${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: ruta, contentType: o.contentType, cacheControl: o.cacheControl, metadata: o.metadata });
  const cuerpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${limite}\r\nContent-Type: ${o.contentType}\r\n\r\n`,
    datos,
    `\r\n--${limite}--\r\n`,
  ]);
  const r = await fetch(`${apiGcs()}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: await autorizacion(), "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`GCS respondió ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  await r.body?.cancel();
}

/** El contenido de `gs://bucket/ruta`, o `null` si no existe. Lanza ante cualquier otro error. */
export async function leerObjeto(bucket: string, ruta: string): Promise<Buffer | null> {
  if (!EN_WORKERS) {
    const file = (await storageNode()).bucket(bucket).file(ruta);
    const [existe] = await file.exists();
    if (!existe) return null;
    const [buf] = await file.download();
    return buf;
  }

  const r = await fetch(`${apiGcs()}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(ruta)}?alt=media`, {
    headers: { Authorization: await autorizacion() },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 404) {
    await r.body?.cancel();
    return null;
  }
  if (!r.ok) throw new Error(`GCS respondió ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
