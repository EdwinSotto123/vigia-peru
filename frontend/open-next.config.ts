/**
 * OpenNext para Cloudflare Workers (réplica del frontend de Cloud Run). Ver CLOUDFLARE.md.
 *
 * Caché de páginas (ISR): en R2 (`vigia-web-cache`, binding NEXT_INC_CACHE_R2_BUCKET), compartida
 * por todas las instancias del worker, con una capa regional (Cache API de cada punto de Cloudflare)
 * delante para no ir a R2 en cada pedido. `opennextjs-cloudflare deploy` sube a R2 las páginas
 * prerenderizadas en el build. Antes era una LRU en memoria por instancia (como cache-handler.js
 * en Cloud Run): cada instancia nueva arrancaba vacía y dos instancias podían mostrar versiones distintas.
 * Revalidación ISR: `memory-queue`, que le pide al propio worker (WORKER_SELF_REFERENCE en
 * wrangler.jsonc) la página vencida. No se usan etiquetas (no hay `revalidateTag`).
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

// `opennextjs-cloudflare build` carga este archivo antes de correr `next build`, que hereda el
// entorno: next.config.js deja fuera del worker lo que sólo usa Node (ver ahí).
process.env.VIGIA_DESTINO = "cloudflare";

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  queue: memoryQueue,
});
