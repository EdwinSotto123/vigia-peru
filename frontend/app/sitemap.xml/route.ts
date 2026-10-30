import { CABECERAS_XML, archivosSitemap, xmlIndice } from "@/lib/sitemap";
import { absoluta } from "@/lib/seo";

/** /sitemap.xml: el índice de los archivos de /sitemaps (lib/sitemap.ts). En cada pedido, no en el build. */
export const dynamic = "force-dynamic";

export async function GET() {
  const archivos = await archivosSitemap();
  if (!archivos) return new Response("El índice no está disponible ahora.", { status: 503, headers: { "Retry-After": "3600" } });
  return new Response(xmlIndice(archivos.map((a) => absoluta(`/sitemaps/${a}`))), { headers: CABECERAS_XML });
}
