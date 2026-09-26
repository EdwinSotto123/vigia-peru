/**
 * `next/og` en runtime Node no encuentra su fuente en Windows ("Invalid URL … noto-sans…ttf"): el
 * ícono, el de Apple y las tarjetas Open Graph devolverían 500 en `next dev` / `next start` locales.
 * Ahí se sirve el logo fijo. En Linux (Cloud Run, Cloudflare Workers) se dibujan como siempre.
 */
export async function imagenFijaEnWindows(): Promise<Response | null> {
  if (process.platform !== "win32") return null;
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const png = await readFile(join(process.cwd(), "public", "assets", "logo", "vigia_peru_512.png"));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
