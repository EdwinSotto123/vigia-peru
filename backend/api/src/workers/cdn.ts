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
 * `X-Vigia-Cdn: HIT | STALE | MISS` dice de dónde salió cada respuesta.
 *
 * stale-while-revalidate (2026-10-20): se guarda por `s-maxage` + `stale-while-revalidate`. Vencido el primero pero dentro
 * del segundo, se responde lo guardado al instante (STALE) y se pide de nuevo en segundo plano. Antes, al vencer los
 * 60 s, la siguiente visita pagaba la consulta entera a la base (hasta 8 s en frío con la historia desde 2015).
 */

const PRIVADAS = /^\/(?:v1\/)?(?:admin|cuentas|upload)(?:\/|$)/;
const CC_ORIGINAL = "X-Vigia-Cache-Control";
const GUARDADO = "X-Vigia-Guardado";
/**
 * Subir este número descarta de golpe todo lo guardado (2026-10-11: saneado de datos personales;
 * 2026-10-13: DNI y RUC 10 como referencias, apellidos tapados en el servidor, traza pública sin datos;
 * "4": una candidatura del JNE ya no vuelve pública a una persona; "5": las fechas ya no salen como `{}`; "6": las señales del dossier traen agente, puntua y verificada; "7": /entidades/:ruc/gasto con específicas, fuentes, meses y programas);
 * "13": montos dudosos de CONOSCE fuera de los totales y planilla con sueldo base, migraciones 98-100;
 * "14": datos dudosos con su motivo en órdenes, planilla y contratos, y buscador en las listas, migraciones 102-103;
 * "15": el monto dudoso se devuelve tal como lo publicó CONOSCE, la ficha y el resumen nombran lo que va aparte, y la
 * planilla se busca también por el nombre; "16": línea de tiempo de sueldos en la planilla y de órdenes en la ficha;
 * "17": empresas con su puntaje de antecedentes, migración 109, y la razón social sin el objeto del contrato; "18": cada
 * contrato de una empresa dice si estaba inhabilitada al ganar, sancionada antes o después; "19": filtros con conteos y
 * orden en los contratos, órdenes y postulaciones de una empresa, migración 110; "20": empresas sin puntaje, sus
 * antecedentes como hechos, migración 112; "21": señales SUNAT en empresas, migración 116, y los contratos de la empresa
 * desglosan el antecedente del ganador por tipo —no sólo "Con antecedentes"—).
 */
const VERSION_CACHE = "21";

function cacheable(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.has("authorization") || req.headers.has("x-admin-token") || req.headers.has("cookie")) return false;
  return !PRIVADAS.test(new URL(req.url).pathname);
}

function clave(req: Request): Request {
  const u = new URL(req.url);
  u.searchParams.set("__origen", req.headers.get("origin") ?? "-");
  u.searchParams.set("__v", VERSION_CACHE);
  return new Request(u.toString(), { method: "GET" });
}

function marcar(r: Response, estado: "HIT" | "STALE" | "MISS"): Response {
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
  headers.delete(GUARDADO);
  headers.set("X-Vigia-Cdn", vencida(guardada) ? "STALE" : "HIT");
  const etag = headers.get("etag");
  const pedido = req.headers.get("if-none-match");
  if (etag && pedido && pedido.split(",").map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(guardada.body, { status: guardada.status, statusText: guardada.statusText, headers });
}

/** Pasó su `s-maxage` (sigue guardada sólo por el margen de stale-while-revalidate). */
function vencida(guardada: Response): boolean {
  const cc = guardada.headers.get(CC_ORIGINAL) ?? "";
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? 0);
  const desde = Number(guardada.headers.get(GUARDADO) ?? 0);
  return desde > 0 && Date.now() - desde > sMaxAge * 1000;
}

/** Guarda la respuesta si la API la marcó pública, por s-maxage + stale-while-revalidate. */
function guardar(ctx: ExecutionContext, cache: Cache, k: Request, r: Response): void {
  const cc = r.headers.get("cache-control") ?? "";
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? 0);
  const swr = Number(/stale-while-revalidate=(\d+)/.exec(cc)?.[1] ?? 0);
  if (r.status === 200 && /\bpublic\b/.test(cc) && sMaxAge > 0 && !r.headers.has("set-cookie")) {
    const copia = new Response(r.clone().body, r);
    copia.headers.set(CC_ORIGINAL, cc);
    copia.headers.set(GUARDADO, String(Date.now()));
    copia.headers.set("Cache-Control", `public, max-age=${sMaxAge + swr}`);   // TTL en el borde
    ctx.waitUntil(cache.put(k, copia));
  }
}

export async function conCdn(req: Request, ctx: ExecutionContext, atender: () => Promise<Response>): Promise<Response> {
  if (!cacheable(req)) return atender();
  const k = clave(req);
  const cache = (caches as unknown as { default: Cache }).default;
  const guardada = await cache.match(k);
  if (guardada) {
    // Vencida pero en el margen: se responde ya y se renueva detrás (si falla, queda la anterior hasta su TTL). Si ya no
    // existe (404/410: una alerta retirada, un pedido de privacidad), se borra en vez de seguir sirviéndola horas.
    if (vencida(guardada)) {
      ctx.waitUntil(atender()
        .then((r) => (r.status === 404 || r.status === 410 ? cache.delete(k).then(() => undefined) : guardar(ctx, cache, k, r)))
        .catch(() => undefined));
    }
    return desdeCache(req, guardada);
  }
  const r = await atender();
  guardar(ctx, cache, k, r);
  return marcar(r, "MISS");
}
