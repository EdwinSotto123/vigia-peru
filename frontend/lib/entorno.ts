/**
 * Dónde corre el servidor: Node (Cloud Run, `next dev`) o Cloudflare Workers (réplica con
 * OpenNext, ver CLOUDFLARE.md). Sólo servidor.
 *
 * El código se bifurca sólo donde Workers no tiene lo que usa Node: el servidor de metadatos de
 * Google, `@google-cloud/storage`, el disco y la compresión a mano. En Node todo sigue igual.
 */
import "server-only";

/** `navigator.userAgent` es "Cloudflare-Workers" en workerd; Node 21+ también define `navigator`. */
export const EN_WORKERS = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

interface Assets {
  fetch(input: string | URL | Request): Promise<Response>;
}

/**
 * Bindings del worker (ASSETS, WORKER_SELF_REFERENCE…). OpenNext deja el contexto de Cloudflare
 * del request en este símbolo global: es lo mismo que `getCloudflareContext()` sin importar el
 * adaptador (que es devDependency y no existe en Cloud Run).
 */
function bindings(): { ASSETS?: Assets } | null {
  const ctx = (globalThis as Record<symbol, { env?: { ASSETS?: Assets } } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
  return ctx?.env ?? null;
}

/**
 * Un archivo de `public/` leído desde los assets del worker (en Workers no hay disco).
 * `null` si no existe o no hay binding.
 */
export async function leerAssetPublico(ruta: string): Promise<string | null> {
  const assets = bindings()?.ASSETS;
  if (!assets) return null;
  const r = await assets.fetch(new URL(ruta.replace(/^\/*/, "/"), "https://assets.local"));
  if (!r.ok) {
    await r.body?.cancel();
    return null;
  }
  return r.text();
}
