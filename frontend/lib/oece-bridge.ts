/**
 * Bridge cliente-side hacia OECE pasando por el Cloudflare Worker.
 *
 * Motivo: OECE bloquea por ASN/IP — permite Perú residencial pero rechaza
 * todo egress de datacenter (incluyendo Cloud Run en cualquier región GCP).
 * Cloudflare elige el colo según la IP del cliente. Cuando el browser del
 * usuario está en LATAM, el Worker se ejecuta en un colo permitido (EZE/LIM
 * idealmente) y OECE responde 200.
 *
 * Por eso movemos OCDS + descarga de PDFs al browser. Después el servidor
 * recibe los bytes y los archiva a GCS + reenvía al orchestrator.
 */

const RELAY_URL =
  process.env.NEXT_PUBLIC_OECE_RELAY_URL ||
  "https://oece-relay.vigia-peru.workers.dev";

const OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1";

function viaRelay(targetUrl: string): string {
  return `${RELAY_URL.replace(/\/$/, "")}/?url=${encodeURIComponent(targetUrl)}`;
}

export function resolveOcid(input: string): string {
  const s = input.trim();
  if (s.startsWith("ocds-")) return s;
  if (/^\d+$/.test(s)) return `ocds-dgv273-seacev3-${s}`;
  return s;
}

/**
 * Resultado enriquecido del fetch del OCDS desde el browser.
 *   - cr: el compiledRelease cuando todo OK
 *   - reason: "ok" | "not_found" (404 real) | "blocked" (proxy bloqueado) | "error"
 *   - upstream_status: status del Worker (debug)
 *   - relay_status: header `x-relay-status` que el Worker añade con el HTTP real del upstream OECE
 */
export type OcdsFetchResult = {
  cr: any | null;
  reason: "ok" | "not_found" | "blocked" | "error";
  upstream_status?: number;
  relay_status?: number;
};

export async function fetchOcdsFromBrowserDetailed(
  ocid: string,
): Promise<OcdsFetchResult> {
  const target = `${OECE_BASE}/record/${encodeURIComponent(ocid)}`;
  try {
    const r = await fetch(viaRelay(target), { cache: "no-store" });
    // El Worker propaga el status del upstream en este header
    const relayStatus = Number(r.headers.get("x-relay-status") || "0") || undefined;
    if (r.ok) {
      const data = await r.json();
      const cr = data?.records?.[0]?.compiledRelease ?? null;
      if (cr) return { cr, reason: "ok", upstream_status: r.status, relay_status: relayStatus };
      return { cr: null, reason: "not_found", upstream_status: r.status, relay_status: relayStatus };
    }
    // Distinguir 404 real (no existe) de 403/5xx (proxy bloqueado)
    const effective = relayStatus ?? r.status;
    if (effective === 404) {
      return { cr: null, reason: "not_found", upstream_status: r.status, relay_status: relayStatus };
    }
    return { cr: null, reason: "blocked", upstream_status: r.status, relay_status: relayStatus };
  } catch {
    return { cr: null, reason: "error" };
  }
}

/** Backwards-compatible wrapper que solo devuelve el compiledRelease o null. */
export async function fetchOcdsFromBrowser(ocid: string): Promise<any | null> {
  const r = await fetchOcdsFromBrowserDetailed(ocid);
  return r.cr;
}

// Cap por PDF individual. Subido de 15MB → 50MB para cubrir Bases de 100+ páginas
// que vienen rasterizadas (cada página como imagen embebida → fácilmente > 20 MB).
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface FetchedDoc {
  url: string;           // URL original del OECE
  filename: string;      // nombre derivado para el bucket
  contentType: string;
  base64: string;        // payload base64 para enviar al server
  size_bytes: number;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // browser-side base64: chunked para evitar stack overflow en buffers grandes
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as any,
    );
  }
  return btoa(binary);
}

function inferFilename(url: string, contentType: string | null): string {
  try {
    const u = new URL(url);
    const last = (u.pathname.split("/").pop() || "doc").split("?")[0];
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {}
  const ext =
    contentType?.includes("pdf") ? "pdf" :
    contentType?.includes("zip") ? "zip" :
    "bin";
  return `doc-${Date.now()}.${ext}`;
}

export async function fetchPdfFromBrowser(url: string): Promise<FetchedDoc | null> {
  try {
    const r = await fetch(viaRelay(url), { cache: "no-store" });
    if (!r.ok) return null;
    const cl = Number(r.headers.get("content-length") ?? 0);
    if (cl > MAX_PDF_BYTES) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES) return null;
    const contentType = r.headers.get("content-type") || "application/octet-stream";
    return {
      url,
      filename: inferFilename(url, contentType),
      contentType,
      base64: arrayBufferToBase64(buf),
      size_bytes: buf.byteLength,
    };
  } catch {
    return null;
  }
}

export async function fetchAllDocsFromOcds(
  ocds: any,
  opts: { maxDocs?: number; maxTotalBytes?: number } = {},
): Promise<{ docs: FetchedDoc[]; skipped: number }> {
  // Caps generosos: 6 docs / 150 MB total. El bridge se encarga de no inflar
  // el body al orchestrator (si pasa ~22 MB en b64, manda solo doc_urls).
  const maxDocs = opts.maxDocs ?? 6;
  const maxTotal = opts.maxTotalBytes ?? 150 * 1024 * 1024;
  const docs = (ocds?.tender?.documents ?? []).slice(0, maxDocs) as Array<{
    url: string;
  }>;
  const results: FetchedDoc[] = [];
  let totalBytes = 0;
  let skipped = 0;
  // Secuencial para no saturar la cuenta free del Worker ni la red del usuario.
  for (const d of docs) {
    if (!d?.url) { skipped++; continue; }
    const fetched = await fetchPdfFromBrowser(d.url);
    if (!fetched) { skipped++; continue; }
    if (totalBytes + fetched.size_bytes > maxTotal) { skipped++; continue; }
    results.push(fetched);
    totalBytes += fetched.size_bytes;
  }
  return { docs: results, skipped };
}
