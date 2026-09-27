/**
 * CDN de la API en Cloudflare: lo que Firebase Hosting hace delante de Cloud Run (lib/http.ts).
 *
 * Solo GET públicos: nada con `Authorization`, `x-admin-token` o cookies, ni rutas del panel, de
 * cuentas o de subida. Se guarda lo que la API marca `public` con `s-maxage` > 0, por ese tiempo,
 * en la caché del punto de Cloudflare que atiende (caches.default).
 *
 * La clave incluye el `Origin`: la API responde `Access-Control-Allow-Origin` según quién pregunta
 * (`Vary: Origin`), y la caché de Workers no separa por Vary; sin esto, la respuesta guardada para
 * un origen le llegaría a otro y el navegador la rechazaría.
 *
 * `X-Vigia-Cdn: HIT | MISS` dice de dónde salió cada respuesta.
 */

const PRIVADAS = /^\/(?:v1\/)?(?:admin|cuentas|upload)(?:\/|$)/;
const CC_ORIGINAL = "X-Vigia-Cache-Control";

function cacheable(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.has("authorization") || req.headers.has("x-admin-token") || req.headers.has("cookie")) return false;
  return !PRIVADAS.test(new URL(req.url).pathname);
}

function clave(req: Request): Request {
  const u = new URL(req.url);
  u.searchParams.set("__origen", req.headers.get("origin") ?? "-");
  return new Request(u.toString(), { method: "GET" });
}

function marcar(r: Response, estado: "HIT" | "MISS"): Response {
  const out = new Response(r.body, r);
  out.headers.set("X-Vigia-Cdn", estado);
  return out;
}

/** Respuesta guardada, con el Cache-Control que la API le dio al navegador (y 304 si el ETag coincide). */
function desdeCache(req: Request, guardada: Response): Response {
  const headers = new Headers(guardada.headers);
  const original = headers.get(CC_ORIGINAL);
  if (original) headers.set("Cache-Control", original);
  headers.delete(CC_ORIGINAL);
  headers.set("X-Vigia-Cdn", "HIT");
  const etag = headers.get("etag");
  const pedido = req.headers.get("if-none-match");
  if (etag && pedido && pedido.split(",").map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(guardada.body, { status: guardada.status, statusText: guardada.statusText, headers });
}

export async function conCdn(req: Request, ctx: ExecutionContext, atender: () => Promise<Response>): Promise<Response> {
  if (!cacheable(req)) return atender();
  const k = clave(req);
  const cache = (caches as unknown as { default: Cache }).default;
  const guardada = await cache.match(k);
  if (guardada) return desdeCache(req, guardada);

  const r = await atender();
  const cc = r.headers.get("cache-control") ?? "";
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? 0);
  if (r.status === 200 && /\bpublic\b/.test(cc) && sMaxAge > 0 && !r.headers.has("set-cookie")) {
    const copia = new Response(r.clone().body, r);
    copia.headers.set(CC_ORIGINAL, cc);
    copia.headers.set("Cache-Control", `public, max-age=${sMaxAge}`);   // TTL en el borde
    ctx.waitUntil(cache.put(k, copia));
  }
  return marcar(r, "MISS");
}
