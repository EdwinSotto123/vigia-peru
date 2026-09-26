/**
 * Caché de datos de Next ACOTADA, en memoria y sin escribir a disco (auditoría A7, fase 2).
 *
 * Por defecto Next 14 guarda cada `fetch` cacheado y cada página ISR en `.next/cache` (disco
 * del contenedor, que en Cloud Run es RAM) y además en una LRU de 50 MB: una entrada por
 * OCID, por búsqueda, por combinación de filtros. Un rastreador que recorre 100 000
 * contratos la hace crecer sin tope hasta el OOM de la instancia de 1 GiB. Acá hay UNA
 * sola LRU por proceso, con tope en bytes (64 MB, `VIGIA_CACHE_MAX_MB` para cambiarlo),
 * que expulsa lo menos usado; nada se escribe a disco. Se activa en next.config.js con
 * `cacheHandler` y `cacheMaxMemorySize: 0` (apaga la LRU propia de Next, que duplicaría).
 *
 * Qué se conserva del manejador por defecto:
 *  - Las páginas prerenderizadas en el build (`.next/server/app/*.html`) se LEEN de disco la
 *    primera vez que se piden (la "semilla"), con el lector del propio Next; después viven
 *    en esta LRU. Nunca se escribe.
 *  - `revalidateTag`: una etiqueta revalidada invalida las entradas guardadas antes.
 *
 * Interfaz: la de `CacheHandler` de next/dist/server/lib/incremental-cache (14.2):
 * `get(clave, ctx)`, `set(clave, valor, ctx)`, `revalidateTag(tags)`, `resetRequestCache()`.
 */

const MB = 1024 * 1024;
const TOPE = (Number(process.env.VIGIA_CACHE_MAX_MB) || 64) * MB;
/** Una sola entrada no puede ocupar más de esto: una respuesta enorme expulsaría todo lo demás. */
const TOPE_ENTRADA = 8 * MB;
/** Cabecera donde Next guarda las etiquetas de una página (NEXT_CACHE_TAGS_HEADER). */
const CABECERA_TAGS = "x-next-cache-tags";

// Estado del proceso: Next puede crear varias instancias del manejador, la caché es una.
// Map conserva el orden de inserción: el primero es el menos usado (se reinserta al leer).
const entradas = new Map();
let bytes = 0;
/** etiqueta → ms en que se revalidó. */
const revalidadas = new Map();

/** Tamaño aproximado en bytes (UTF-16: 2 por carácter), sin serializar buffers. */
function medir(valor) {
  if (!valor) return 64;
  switch (valor.kind) {
    case "FETCH": {
      const d = valor.data || {};
      return 2 * ((d.body ? d.body.length : 0) + JSON.stringify(d.headers || {}).length + (d.url ? d.url.length : 0)) + 256;
    }
    case "ROUTE":
      return (valor.body ? valor.body.length : 0) + 256;
    case "IMAGE":
      return (valor.buffer ? valor.buffer.length : 0) + 256;
    case "REDIRECT":
      return 2 * JSON.stringify(valor.props || {}).length + 256;
    case "PAGE": {
      const html = typeof valor.html === "string" ? valor.html.length : 0;
      const datos = typeof valor.pageData === "string" ? valor.pageData.length : JSON.stringify(valor.pageData || {}).length;
      return 2 * (html + datos) + 256;
    }
    default:
      return 2 * JSON.stringify(valor).length;
  }
}

function etiquetasDe(valor, ctx) {
  const tags = [];
  if (ctx && Array.isArray(ctx.tags)) tags.push(...ctx.tags);
  if (valor && valor.kind === "FETCH" && Array.isArray(valor.tags)) tags.push(...valor.tags);
  const cab = valor && valor.headers && valor.headers[CABECERA_TAGS];
  if (typeof cab === "string" && cab) tags.push(...cab.split(","));
  return tags;
}

function borrar(clave) {
  const e = entradas.get(clave);
  if (!e) return;
  bytes -= e.bytes;
  entradas.delete(clave);
}

function guardar(clave, valor, lastModified, tags) {
  borrar(clave);
  const tam = medir(valor);
  if (tam > TOPE_ENTRADA) return;
  entradas.set(clave, { valor, lastModified, tags, bytes: tam });
  bytes += tam;
  // Expulsa lo menos usado hasta volver bajo el tope.
  for (const [k] of entradas) {
    if (bytes <= TOPE) break;
    borrar(k);
  }
}

/**
 * La semilla del build: el lector del manejador por defecto, sin memoria y sin escribir.
 * Una por proceso (Next crea un manejador por request). Si la ruta interna cambia en otra
 * versión de Next, simplemente no hay semilla y la página se renderiza en su primera visita.
 */
let semilla;
function lectorSemilla(ctx) {
  if (semilla !== undefined) return semilla;
  semilla = null;
  try {
    const FileSystemCache = require("next/dist/server/lib/incremental-cache/file-system-cache").default;
    if (ctx && ctx.fs && ctx.serverDistDir) {
      semilla = new FileSystemCache({ ...ctx, flushToDisk: false, maxMemoryCacheSize: 0 });
    }
  } catch {
    semilla = null;
  }
  return semilla;
}

class CacheAcotada {
  constructor(ctx) {
    this.revalidatedTags = (ctx && ctx.revalidatedTags) || [];
    // En `next dev` no hay build que leer.
    this.semilla = ctx && ctx.dev ? null : lectorSemilla(ctx);
  }

  async get(clave, ctx = {}) {
    let e = entradas.get(clave);
    if (e) {
      // Uso reciente: al final de la cola de expulsión.
      entradas.delete(clave);
      entradas.set(clave, e);
    } else if (this.semilla && ctx.kindHint !== "fetch") {
      try {
        const leido = await this.semilla.get(clave, ctx);
        if (leido && leido.value) {
          guardar(clave, leido.value, leido.lastModified || Date.now(), etiquetasDe(leido.value, ctx));
          e = entradas.get(clave);
        }
      } catch {
        /* sin semilla para esta clave */
      }
    }
    if (!e) return null;

    const tags = [...(e.tags || []), ...(ctx.tags || []), ...(ctx.softTags || [])];
    const vencida = tags.some(
      (t) => this.revalidatedTags.includes(t) || (revalidadas.has(t) && revalidadas.get(t) >= (e.lastModified || 0)),
    );
    if (vencida) {
      borrar(clave);
      return null;
    }
    return { lastModified: e.lastModified, value: e.valor };
  }

  async set(clave, valor, ctx = {}) {
    guardar(clave, valor, Date.now(), etiquetasDe(valor, ctx));
  }

  async revalidateTag(tags) {
    const lista = Array.isArray(tags) ? tags : [tags];
    const ahora = Date.now();
    for (const t of lista) if (t) revalidadas.set(t, ahora);
  }

  resetRequestCache() {}
}

module.exports = CacheAcotada;
