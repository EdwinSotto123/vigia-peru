/**
 * Copia GCS → R2 de los buckets de Vigía (réplica en Cloudflare, 2026-09-26).
 *
 * Mientras conviven las dos nubes, GCS es la fuente: ahí escriben los agentes, el batch nocturno y la
 * web de Cloud Run. Este Worker:
 *   · copia a R2 lo que falta o cambió (tamaño o MD5 distinto), con su Content-Type, Cache-Control y
 *     metadatos, sin cargar el archivo en memoria (FixedLengthStream);
 *   · cada hora (cron) repite la pasada: lo nuevo en GCS llega a R2 en menos de una hora;
 *   · GET /verificar compara GCS contra R2 objeto por objeto (nombre, tamaño, MD5).
 * No borra nada en R2 aunque desaparezca de GCS (el ciclo de vida de GCS no se replica a ciegas).
 *
 *   POST /sincronizar?bucket=<nombre>&max=<n>   (Authorization: Bearer SYNC_TOKEN)
 *   GET  /verificar?bucket=<nombre>             (idem)
 */
import { tokenGoogle } from "./gcp";

interface Env {
  B_DOCUMENTOS: R2Bucket;
  B_PRIVADO: R2Bucket;
  B_REPORTES: R2Bucket;
  B_RAG: R2Bucket;
  GCP_SA_KEY?: string;
  SYNC_TOKEN?: string;
}

const BUCKETS: Record<string, keyof Env> = {
  "vigia-peru-documentos": "B_DOCUMENTOS",
  "vigia-peru-privado": "B_PRIVADO",
  "vigia-peru-reportes": "B_REPORTES",
  "vigia-peru-rag": "B_RAG",
};

interface ObjetoGcs {
  name: string;
  size: string;
  md5Hash?: string;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  metadata?: Record<string, string>;
}

const hexDeBase64 = (b64?: string) =>
  b64 ? Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("") : "";

async function listarGcs(token: string, bucket: string): Promise<ObjetoGcs[]> {
  const out: ObjetoGcs[] = [];
  let pagina = "";
  do {
    const u = new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o`);
    u.searchParams.set("maxResults", "1000");
    u.searchParams.set("fields", "nextPageToken,items(name,size,md5Hash,contentType,cacheControl,contentDisposition,contentEncoding,metadata)");
    if (pagina) u.searchParams.set("pageToken", pagina);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`listar gs://${bucket}: HTTP ${r.status}`);
    const d = (await r.json()) as { items?: ObjetoGcs[]; nextPageToken?: string };
    out.push(...(d.items || []));
    pagina = d.nextPageToken || "";
  } while (pagina);
  return out;
}

async function listarR2(b: R2Bucket): Promise<Map<string, { size: number; etag: string }>> {
  const m = new Map<string, { size: number; etag: string }>();
  let cursor: string | undefined;
  do {
    const r = await b.list({ limit: 1000, cursor });
    for (const o of r.objects) m.set(o.key, { size: o.size, etag: o.etag });
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return m;
}

/** Objetos de GCS que faltan en R2 o difieren (tamaño o MD5; el etag de R2 es el MD5 de un PUT simple). */
function pendientes(gcs: ObjetoGcs[], r2: Map<string, { size: number; etag: string }>): ObjetoGcs[] {
  return gcs.filter((o) => {
    const x = r2.get(o.name);
    if (!x) return true;
    if (x.size !== Number(o.size)) return true;
    const md5 = hexDeBase64(o.md5Hash);
    return Boolean(md5) && x.etag !== md5;
  });
}

async function copiar(token: string, bucket: string, destino: R2Bucket, o: ObjetoGcs): Promise<void> {
  const u = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(o.name)}?alt=media`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" } });
  if (!r.ok || !r.body) throw new Error(`leer gs://${bucket}/${o.name}: HTTP ${r.status}`);
  const largo = Number(o.size);
  const { readable, writable } = new FixedLengthStream(largo);
  const tubo = r.body.pipeTo(writable);
  await destino.put(o.name, readable, {
    httpMetadata: {
      contentType: o.contentType,
      cacheControl: o.cacheControl,
      contentDisposition: o.contentDisposition,
      contentEncoding: o.contentEncoding,
    },
    customMetadata: { ...(o.metadata || {}), gcs_md5: hexDeBase64(o.md5Hash) },
    md5: hexDeBase64(o.md5Hash) || undefined,   // R2 rechaza el PUT si el contenido no coincide
  });
  await tubo;
}

async function sincronizar(env: Env, bucket: string, max: number) {
  const destino = env[BUCKETS[bucket]] as R2Bucket;
  const token = await tokenGoogle(env.GCP_SA_KEY, "https://www.googleapis.com/auth/devstorage.read_only");
  const [gcs, r2] = await Promise.all([listarGcs(token, bucket), listarR2(destino)]);
  const faltan = pendientes(gcs, r2);
  let copiados = 0;
  let bytes = 0;
  const errores: string[] = [];
  // 6 copias a la vez: el máximo de conexiones abiertas simultáneas de una invocación.
  const cola = faltan.slice(0, max);
  const trabajador = async () => {
    for (let o = cola.shift(); o; o = cola.shift()) {
      try {
        await copiar(token, bucket, destino, o);
        copiados++;
        bytes += Number(o.size);
      } catch (e) {
        errores.push(String((e as Error).message || e).slice(0, 160));
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajador));
  return { bucket, en_gcs: gcs.length, pendientes_antes: faltan.length, copiados, bytes, quedan: faltan.length - copiados, errores: errores.slice(0, 10) };
}

async function verificar(env: Env, bucket: string) {
  const destino = env[BUCKETS[bucket]] as R2Bucket;
  const token = await tokenGoogle(env.GCP_SA_KEY, "https://www.googleapis.com/auth/devstorage.read_only");
  const [gcs, r2] = await Promise.all([listarGcs(token, bucket), listarR2(destino)]);
  const difieren = pendientes(gcs, r2);
  const bytesGcs = gcs.reduce((s, o) => s + Number(o.size), 0);
  let bytesR2 = 0;
  for (const v of r2.values()) bytesR2 += v.size;
  return {
    bucket, objetos_gcs: gcs.length, objetos_r2: r2.size, bytes_gcs: bytesGcs, bytes_r2: bytesR2,
    faltan_o_difieren: difieren.length, ejemplos: difieren.slice(0, 10).map((o) => o.name),
    solo_en_r2: [...r2.keys()].filter((k) => !gcs.some((o) => o.name === k)).length,
    identico: difieren.length === 0 && gcs.length === r2.size,
  };
}

function autorizado(req: Request, env: Env): boolean {
  const esperado = (env.SYNC_TOKEN || "").trim();
  const dado = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!esperado || dado.length !== esperado.length) return false;
  let d = 0;
  for (let i = 0; i < dado.length; i++) d |= dado.charCodeAt(i) ^ esperado.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    if (!autorizado(req, env)) return Response.json({ detail: "unauthorized" }, { status: 401 });
    const bucket = u.searchParams.get("bucket") || "";
    if (!(bucket in BUCKETS)) return Response.json({ detail: "bucket desconocido", buckets: Object.keys(BUCKETS) }, { status: 400 });
    try {
      if (req.method === "POST" && u.pathname === "/sincronizar") {
        return Response.json(await sincronizar(env, bucket, Math.min(Number(u.searchParams.get("max") || "200"), 2000)));
      }
      if (req.method === "GET" && u.pathname === "/verificar") return Response.json(await verificar(env, bucket));
    } catch (e) {
      return Response.json({ detail: String((e as Error).message || e).slice(0, 300) }, { status: 500 });
    }
    return Response.json({ detail: "no encontrado" }, { status: 404 });
  },

  // Cada hora: lo nuevo de GCS a R2 (tope por bucket para no pasar los límites de una invocación).
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      for (const bucket of Object.keys(BUCKETS)) {
        try {
          console.log(JSON.stringify({ msg: "sync", ...(await sincronizar(env, bucket, 300)) }));
        } catch (e) {
          console.log(JSON.stringify({ msg: "sync_error", bucket, error: String(e).slice(0, 200) }));
        }
      }
    })());
  },
} satisfies ExportedHandler<Env>;
