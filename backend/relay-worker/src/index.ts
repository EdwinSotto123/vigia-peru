/**
 * Relay de descargas de Vigía en Cloudflare: réplica de backend/relay/app.py (el puente de Lima),
 * con la misma API para que los agentes no cambien nada salvo LOCAL_DOWNLOADER_URL.
 *
 *   GET  /health    → {ok, bucket, project, protected}
 *   POST /fetch     {url}                 → {ok, status, content_type, body}   (metadata OCDS)
 *   POST /download  {url, ocid, filename} → sube a gs://<bucket>/convocatorias/<ocid>/<archivo>
 *   POST /raw       {url}                 → los bytes tal cual, con el status del origen
 *
 * Dónde funciona: OECE (API OCDS) y prod1.seace.gob.pe filtran por la IP de SALIDA, que en un Worker
 * es la del punto de Cloudflare donde corre (no se reenvía la IP de quien llama). Medido 2026-09-30 con
 * sondas llamadas desde GCP us-central1 y desde Perú:
 *   · 200: salida por Buenos Aires (EZE) o Zúrich (ZRH);
 *   · 403: Chicago (ORD), Dallas (DFW), Santiago (SCL), São Paulo (GRU), Fráncfort (FRA).
 * Sin `placement`, el Worker corre donde entra la llamada: desde Perú (entra por EZE) funcionaba y
 * desde Cloud Run (entra por ORD) no. Con `placement` en la región gcp:europe-west6 (wrangler.jsonc)
 * corre siempre en Zúrich, llame quien llame: así reemplaza al relay de Lima, que ya no existe.
 * Además de *.gob.pe acepta la ficha de empresas de universidadperu.com (respaldo de SUNAT); con el
 * token filtrado no sirve como proxy abierto.
 */
import { subirGcs, tokenGoogle } from "./gcp";

interface Env {
  GCS_BUCKET: string;
  GCP_PROJECT: string;
  MAX_BYTES: string;
  VIGIA_DL_TOKEN?: string;
  GCP_SA_KEY?: string;
}

// UA de navegador real: SEACE rechaza clientes "robot".
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const json = (d: unknown, status = 200) => Response.json(d, { status });
const error = (status: number, detail: string) => json({ detail }, status);

/** Comparación en tiempo constante (el token no se filtra por el tiempo de respuesta). */
function iguales(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function autorizado(req: Request, env: Env): boolean {
  const esperado = (env.VIGIA_DL_TOKEN || "").trim();
  if (!esperado) return false;          // sin token configurado no se atiende (el de Lima quedaba abierto)
  const auth = req.headers.get("Authorization") || "";
  const dado = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : req.headers.get("X-Vigia-Token") || "").trim();
  return iguales(dado, esperado);
}

/** *.gob.pe y la ficha pública de empresas de universidadperu.com (fecha de inicio y CIIU). */
function hostPermitido(h: string): boolean {
  return h === "gob.pe" || h.endsWith(".gob.pe") || h === "www.universidadperu.com";
}

function urlPermitida(u: string): URL | null {
  try {
    const p = new URL(u);
    if (!["http:", "https:"].includes(p.protocol)) return null;
    return hostPermitido(p.hostname) ? p : null;
  } catch {
    return null;
  }
}

/** Mismo saneo que el upload-doc del frontend (NFD, sin tildes, [A-Za-z0-9._-]). */
function nombreSeguro(n: string): string {
  const s = (n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return s.slice(0, 200) || "doc.bin";
}

function nombreArchivo(u: URL, tipo: string): string {
  const ultimo = (u.pathname.split("/").pop() || "").split("?")[0];
  if (ultimo && /\.[a-z0-9]{2,5}$/i.test(ultimo)) return ultimo;
  const ext = tipo.includes("pdf") ? "pdf" : tipo.includes("zip") ? "zip" : "bin";
  const fc = u.searchParams.get("fileCode");   // SEACE usa ?fileCode=<uuid>: nombre estable
  return fc ? `${nombreSeguro(fc)}.${ext}` : `doc.${ext}`;
}

async function leerConTope(r: Response, maximo: number): Promise<ArrayBuffer | null> {
  const largo = Number(r.headers.get("content-length") || "0");
  if (largo > maximo) return null;
  const datos = await r.arrayBuffer();
  return datos.byteLength > maximo ? null : datos;
}

async function fetchUrl(req: Request, env: Env): Promise<Response> {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const u = urlPermitida(url || "");
  if (!u) return error(400, "url inválida o fuera de los dominios permitidos");
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { "User-Agent": UA, Referer: `${u.protocol}//${u.host}/`, Accept: "application/json, */*" } });
  } catch (e) {
    return error(502, `fetch_exception: ${String(e).slice(0, 200)}`);
  }
  const datos = await leerConTope(r, Number(env.MAX_BYTES));
  if (!datos) return error(413, `body > ${env.MAX_BYTES} bytes`);
  return json({
    ok: r.status === 200,
    status: r.status,
    content_type: (r.headers.get("content-type") || "").split(";")[0].trim(),
    body: decodificar(datos, r.headers.get("content-type")),
  });
}

/**
 * El texto con la codificación real de la respuesta. El encabezado no basta: universidadperu declara
 * UTF-8 y manda Latin-1 ("Condici�n"). Se prueba UTF-8 estricto; si los bytes no lo son, la etiqueta
 * del encabezado (si es otra) y, si no, Latin-1.
 */
function decodificar(datos: ArrayBuffer, contentType: string | null): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(datos);
  } catch {
    // no es UTF-8 válido
  }
  const charset = /charset=([^;]+)/i.exec(contentType || "")?.[1]?.trim().replace(/"/g, "").toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(datos);
    } catch {
      // etiqueta desconocida
    }
  }
  // Latin-1 a mano: cada byte es su punto de código (no depende de qué etiquetas acepte el runtime).
  const b = new Uint8Array(datos);
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

/** Los bytes tal cual (para el lote que descarga en la nube): mismo control de dominio y tope. */
async function crudo(req: Request, env: Env): Promise<Response> {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const u = urlPermitida(url || "");
  if (!u) return error(400, "url inválida o fuera de los dominios permitidos");
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { "User-Agent": UA, Referer: `${u.protocol}//${u.host}/`, Accept: "*/*" } });
  } catch (e) {
    return error(502, `fetch_exception: ${String(e).slice(0, 200)}`);
  }
  const datos = await leerConTope(r, Number(env.MAX_BYTES));
  if (!datos) return error(413, `body > ${env.MAX_BYTES} bytes`);
  return new Response(datos, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") || "application/octet-stream",
      "x-relay-status": String(r.status),
      ...(r.headers.get("content-disposition") ? { "content-disposition": r.headers.get("content-disposition") as string } : {}),
    },
  });
}

async function download(req: Request, env: Env): Promise<Response> {
  const cuerpo = (await req.json().catch(() => ({}))) as { url?: string; ocid?: string; filename?: string };
  const u = urlPermitida(cuerpo.url || "");
  if (!u) return error(400, "url inválida o fuera de los dominios permitidos");
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { "User-Agent": UA, Referer: "https://prod1.seace.gob.pe/", Accept: "*/*" } });
  } catch (e) {
    return error(502, `download_exception: ${String(e).slice(0, 200)}`);
  }
  if (r.status !== 200) return error(502, `upstream HTTP ${r.status}`);
  const datos = await leerConTope(r, Number(env.MAX_BYTES));
  if (!datos) return error(413, `file > ${env.MAX_BYTES} bytes`);
  if (!datos.byteLength) return error(502, "respuesta vacía");
  const tipo = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const ocid = nombreSeguro(cuerpo.ocid || "sin-ocid");
  const archivo = nombreSeguro(cuerpo.filename || nombreArchivo(u, tipo));
  const ruta = `convocatorias/${ocid}/${archivo}`;
  try {
    const token = await tokenGoogle(env.GCP_SA_KEY);
    await subirGcs(token, env.GCS_BUCKET, ruta, datos, tipo, { original_url: u.toString(), ocid, fuente: "relay-cloudflare" });
  } catch (e) {
    return error(500, String((e as Error).message || e).slice(0, 200));
  }
  console.log(JSON.stringify({ msg: "OK", url: u.toString().slice(0, 80), bytes: datos.byteLength, tipo, destino: `gs://${env.GCS_BUCKET}/${ruta}` }));
  return json({
    ok: true,
    original_url: u.toString(),
    gcs_url: `https://storage.googleapis.com/${env.GCS_BUCKET}/${ruta}`,
    gcs_path: `gs://${env.GCS_BUCKET}/${ruta}`,
    bytes: datos.byteLength,
    content_type: tipo,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/health") {
      return json({ ok: true, bucket: env.GCS_BUCKET, project: env.GCP_PROJECT, protected: Boolean((env.VIGIA_DL_TOKEN || "").trim()) });
    }
    if (req.method !== "POST" || !["/fetch", "/download", "/raw"].includes(pathname)) return error(404, "no encontrado");
    if (!autorizado(req, env)) return error(401, "unauthorized");
    if (pathname === "/raw") return crudo(req, env);
    return pathname === "/fetch" ? fetchUrl(req, env) : download(req, env);
  },
} satisfies ExportedHandler<Env>;
