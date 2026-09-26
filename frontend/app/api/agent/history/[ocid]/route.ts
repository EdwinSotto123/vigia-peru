/**
 * GET /api/agent/history/[ocid]            el informe (sin traza) por OCID, código de convocatoria o de alerta
 * GET /api/agent/history/[ocid]?traza=1    sólo la traza, las métricas y la autoevaluación ("Cómo se hizo")
 *
 * La página /app/convocatoria/[id] ya llega armada del servidor (lib/dossier-servidor.ts); esta
 * ruta queda para el navegador: reintentar cuando el servidor no pudo, y la traza cuando la API
 * no tiene `/alertas/:id/traza` (COMPAT-API-VIEJA: la de prod todavía no la tiene).
 *
 * Antes cada request re-armaba el dossier (~480 KB) y lo volvía a comprimir con gzip. Ahora el
 * resultado ya comprimido queda en una caché LRU acotada en memoria, por dossier y por versión
 * de lo que mandó la API (su ETag o, si no manda, un hash del cuerpo): si no cambió, no se
 * re-arma ni se re-comprime. La respuesta lleva `ETag` y contesta 304 a `If-None-Match`.
 *
 * En Cloudflare Workers no se comprime a mano: el runtime vuelve a comprimir todo cuerpo con
 * `Content-Encoding` (saldría gzip dentro de gzip) y el borde ya comprime el JSON. Ahí se guarda
 * el JSON plano.
 */
import { createHash } from "crypto";
import { gunzipSync, gzipSync } from "zlib";
import { NextResponse } from "next/server";
import { API_DOSSIER, armarDossier, claveDossier, extraerTraza, noEsDossier } from "@/lib/dossier-servidor";
import { EN_WORKERS } from "@/lib/entorno";

export const dynamic = "force-dynamic";

// ─── Caché LRU acotada: por cantidad y por bytes (sólo se guarda el gzip) ───
const MAX_ENTRADAS = 64;
const MAX_BYTES = 16 * 1024 * 1024;

interface Entrada {
  /** Versión de lo que mandó la API: su ETag o `h:<sha1 del cuerpo>`. */
  origen: string;
  /** ETag propio de esta respuesta ya transformada. */
  etag: string;
  /** El JSON en gzip (en Workers, plano). */
  gz: Buffer;
}

const cache = new Map<string, Entrada>();
let bytesEnCache = 0;

function leer(k: string): Entrada | undefined {
  const e = cache.get(k);
  if (e) {
    // LRU por uso: lo leído pasa al final (lo más reciente).
    cache.delete(k);
    cache.set(k, e);
  }
  return e;
}

function guardar(k: string, e: Entrada) {
  const previa = cache.get(k);
  if (previa) {
    bytesEnCache -= previa.gz.length;
    cache.delete(k);
  }
  cache.set(k, e);
  bytesEnCache += e.gz.length;
  while (cache.size > MAX_ENTRADAS || bytesEnCache > MAX_BYTES) {
    const primera = cache.keys().next();
    if (primera.done) break;
    const vieja = cache.get(primera.value);
    cache.delete(primera.value);
    if (vieja) bytesEnCache -= vieja.gz.length;
  }
}

const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("base64url");

const noEncontrado = (query: string) => NextResponse.json({ error: "not_found", query }, { status: 404 });

export async function GET(req: Request, { params }: { params: { ocid: string } }) {
  const clave = claveDossier(params.ocid);
  if (!clave) return noEncontrado("");
  const soloTraza = new URL(req.url).searchParams.get("traza") === "1";
  const k = `${soloTraza ? "traza" : "informe"}:${clave.toUpperCase()}`;
  const previa = leer(k);

  try {
    // OJO: sin caché de datos de Next acá (cache: "no-store"): la versión la decide la API, y
    // la caché de esta ruta guarda el resultado ya transformado. `If-None-Match` hacia la API
    // ahorra el cuerpo entero si la API contesta 304 (la de prod lo ignora: no pasa nada).
    // La traza sale de `/full` sin `sinTraza`: la API vieja y la nueva la incluyen por defecto.
    const ruta = soloTraza ? `/alertas/${encodeURIComponent(clave)}/full` : `/alertas/${encodeURIComponent(clave)}/full?sinTraza=1`;
    const condicional: Record<string, string> = {};
    if (previa && !previa.origen.startsWith("h:")) condicional["If-None-Match"] = previa.origen;
    const r = await fetch(`${API_DOSSIER}${ruta}`, { cache: "no-store", headers: condicional, signal: AbortSignal.timeout(25_000) });

    let entrada: Entrada;
    if (r.status === 304 && previa) {
      entrada = previa;
    } else {
      if (r.status === 404) return noEncontrado(clave);
      if (!r.ok) {
        return NextResponse.json(
          { error: "upstream_failed", status: r.status, detail: (await r.text()).slice(0, 300) },
          { status: 502 },
        );
      }
      const texto = await r.text();
      const origen = r.headers.get("etag") ?? `h:${sha1(texto)}`;
      if (previa && previa.origen === origen) {
        // Mismo dossier que la última vez: no se re-arma ni se re-comprime.
        entrada = previa;
      } else {
        let loaded: any;
        try {
          loaded = JSON.parse(texto);
        } catch {
          return NextResponse.json({ error: "upstream_failed", detail: "Respuesta ilegible" }, { status: 502 });
        }
        // Las 10 alertas de demo `ALT-2026-00xx` (lib/semillas.ts) no son un dossier.
        if (noEsDossier(loaded)) return noEncontrado(clave);
        const cuerpo = soloTraza ? extraerTraza(loaded) : await armarDossier(loaded, clave);
        const json = JSON.stringify(cuerpo);
        // Next no gzipea las route handlers en Cloud Run: se comprime a mano, una sola vez.
        entrada = { origen, etag: `W/"${sha1(json)}"`, gz: EN_WORKERS ? Buffer.from(json) : gzipSync(Buffer.from(json)) };
        guardar(k, entrada);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // Un dossier se puede reprocesar (lib/dossier-cache.ts promete que una recarga trae la
      // última corrida): caché corta, y el ETag hace barata la revalidación.
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
      ETag: entrada.etag,
      Vary: "Accept-Encoding",
    };
    const pedido = req.headers.get("if-none-match");
    if (pedido && pedido.split(/\s*,\s*/).some((t) => t === entrada.etag || t === "*")) {
      return new Response(null, { status: 304, headers });
    }
    if (EN_WORKERS) return new Response(entrada.gz, { status: 200, headers });
    if ((req.headers.get("accept-encoding") || "").includes("gzip")) {
      return new Response(entrada.gz, { status: 200, headers: { ...headers, "Content-Encoding": "gzip" } });
    }
    // Un cliente sin gzip (raro): se descomprime lo guardado en vez de guardar dos copias.
    return new Response(gunzipSync(entrada.gz), { status: 200, headers });
  } catch (e) {
    return NextResponse.json({ error: "fetch_failed", detail: (e as Error).message }, { status: 502 });
  }
}
