import { sitemapDe, type UrlSitemap } from "@/lib/gobserva-seo";
import { getSitemapSalud, rutaFicha } from "@/lib/gobserva-salud";

/**
 * El sitemap de salud.gobserva.cloud: sus páginas y la ficha de cada establecimiento activo o con sanciones firmes
 * (GET /salud/sitemap, hasta 45,000). Las listas con filtros no van: robots.txt las deja fuera (`/*?`).
 */
// En cada pedido y no en el build (que no alcanza la API): las fichas salen de la API, con su caché.
export const dynamic = "force-dynamic";

export async function GET() {
  const fijas: UrlSitemap[] = [
    { ruta: "/", prioridad: 1 },
    { ruta: "/establecimientos", prioridad: 0.9 },
    { ruta: "/medico", prioridad: 0.9 },
    { ruta: "/medicamentos", prioridad: 0.9 },
    { ruta: "/alertas", prioridad: 0.8 },
    { ruta: "/cerca", prioridad: 0.8 },
    { ruta: "/mapa", prioridad: 0.7 },
    { ruta: "/sanciones", prioridad: 0.8 },
    { ruta: "/asistente", prioridad: 0.6 },
    { ruta: "/fuentes", prioridad: 0.6 },
    { ruta: "/cambios", prioridad: 0.5 },
    { ruta: "/mcp", prioridad: 0.5 },
  ];
  const fichas: UrlSitemap[] = [];
  const d = await getSitemapSalud();
  for (const e of d?.establecimientos ?? []) {
    if (/^\d{1,8}$/.test(e.codigo)) fichas.push({ ruta: rutaFicha(e.codigo), fecha: e.al, prioridad: 0.6 });
  }
  return sitemapDe("salud", [...fijas, ...fichas]);
}
