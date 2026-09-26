/**
 * OpenNext para Cloudflare Workers (réplica del frontend de Cloud Run). Ver CLOUDFLARE.md.
 *
 * Caché: la LRU en memoria de cloudflare/cache-memoria.ts, el equivalente de cache-handler.js.
 * Revalidación ISR: `memory-queue`, que le pide al propio worker (WORKER_SELF_REFERENCE en
 * wrangler.jsonc) la página vencida. No se usan etiquetas (no hay `revalidateTag`).
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";
import cacheMemoria from "./cloudflare/cache-memoria";

// `opennextjs-cloudflare build` carga este archivo antes de correr `next build`, que hereda el
// entorno: next.config.js deja fuera del worker lo que sólo usa Node (ver ahí).
process.env.VIGIA_DESTINO = "cloudflare";

export default defineCloudflareConfig({
  incrementalCache: cacheMemoria,
  queue: memoryQueue,
});
