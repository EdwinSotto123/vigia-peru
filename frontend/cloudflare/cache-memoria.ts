/**
 * Caché incremental de Next en Cloudflare Workers: el mismo criterio que cache-handler.js en
 * Cloud Run, sin crear nada en la cuenta (ni R2, ni KV, ni D1).
 *
 *  - UNA LRU en memoria por isolate, con tope en bytes (`VIGIA_CACHE_MAX_MB`, 24 MB por defecto:
 *    un isolate tiene 128 MB en total) y tope por entrada. Expulsa lo menos usado.
 *  - La "semilla" son las páginas prerenderizadas en el build: OpenNext las copia a los assets
 *    del worker (`cdn-cgi/_next_cache`, sólo legibles desde el worker) y se leen la primera vez
 *    que se piden; después viven en la LRU. Nunca se escribe a los assets.
 *
 * Como en Cloud Run, cada isolate tiene su propia copia y un isolate nuevo arranca vacío: una
 * página ISR vencida se sirve y se regenera en segundo plano (cola `memory-queue` de
 * open-next.config.ts).
 *
 * `name` es el de la caché de assets estáticos a propósito: así `opennextjs-cloudflare
 * preview|deploy` copia la semilla a los assets antes de subir.
 */
import type { CacheEntryType, CacheValue, IncrementalCache, WithLastModified } from "@opennextjs/aws/types/overrides";
import assets, { NAME as NOMBRE_ASSETS } from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

const MB = 1024 * 1024;
/** Una sola entrada no puede ocupar más de esto: una respuesta enorme expulsaría todo lo demás. */
const TOPE_ENTRADA = 4 * MB;

interface Entrada {
  valor: WithLastModified<CacheValue<CacheEntryType>>;
  bytes: number;
}

// Estado del isolate. Map conserva el orden de inserción: el primero es el menos usado.
const entradas = new Map<string, Entrada>();
let bytes = 0;

/** Se lee en cada escritura: `process.env` lo llena el worker en el primer request. */
const tope = () => (Number(process.env.VIGIA_CACHE_MAX_MB) || 24) * MB;

const clave = (key: string, tipo: CacheEntryType | undefined) => `${tipo ?? "cache"}:${key}`;

/** Tamaño aproximado en bytes (UTF-16: 2 por carácter). */
function medir(valor: unknown): number {
  const v = valor as Record<string, unknown> | null;
  if (!v) return 64;
  if (v.kind === "FETCH") {
    const d = (v.data ?? {}) as { body?: string; url?: string; headers?: object };
    return 2 * ((d.body?.length ?? 0) + (d.url?.length ?? 0) + JSON.stringify(d.headers ?? {}).length) + 256;
  }
  if (v.type === "app") return 2 * (String(v.html ?? "").length + String(v.rsc ?? "").length) + 256;
  if (v.type === "route") return 2 * String(v.body ?? "").length + 256;
  return 2 * JSON.stringify(v).length + 256;
}

function borrar(k: string) {
  const e = entradas.get(k);
  if (!e) return;
  bytes -= e.bytes;
  entradas.delete(k);
}

function guardar(k: string, valor: Entrada["valor"]) {
  borrar(k);
  const tam = medir(valor.value);
  if (tam > TOPE_ENTRADA) return;
  entradas.set(k, { valor, bytes: tam });
  bytes += tam;
  const max = tope();
  for (const [vieja] of entradas) {
    if (bytes <= max) break;
    borrar(vieja);
  }
}

const cacheMemoria: IncrementalCache = {
  name: NOMBRE_ASSETS,

  async get<T extends CacheEntryType = "cache">(key: string, tipo?: T) {
    const k = clave(key, tipo);
    const e = entradas.get(k);
    if (e) {
      // Uso reciente: al final de la cola de expulsión.
      entradas.delete(k);
      entradas.set(k, e);
      return e.valor as WithLastModified<CacheValue<T>>;
    }
    // Sin la entrada en memoria: lo prerenderizado en el build, si existe.
    if (tipo === "composable") return null;
    const semilla = await assets.get(key, tipo);
    if (semilla?.value) guardar(k, semilla as Entrada["valor"]);
    return semilla;
  },

  async set<T extends CacheEntryType = "cache">(key: string, value: CacheValue<T>, tipo?: T) {
    guardar(clave(key, tipo), { value, lastModified: Date.now() } as Entrada["valor"]);
  },

  async delete(key: string) {
    borrar(clave(key, "cache"));
  },
};

export default cacheMemoria;
