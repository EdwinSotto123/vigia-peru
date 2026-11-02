import { API_BASE } from "@/lib/api-client";
import { sitemapDe, type UrlSitemap } from "@/lib/gobserva-seo";
import { SECTORES } from "@/lib/gobserva-obras";
import { REGIONES_UBIGEO } from "@/lib/licitaciones";

/**
 * El sitemap de obras.gobserva.cloud: sus páginas, cada pestaña de proyectos, el mercado de cada región y de cada sector,
 * y las fichas de los proyectos que se vienen o están en marcha (GET /proyectos/sitemap: los 5,000 de mayor costo).
 */
// En cada pedido y no en el build (que no alcanza la API): las fichas salen de la API, con su caché.
export const dynamic = "force-dynamic";

export async function GET() {
  const fijas: UrlSitemap[] = [
    { ruta: "/", prioridad: 1 },
    { ruta: "/proyectos", prioridad: 0.9 },
    { ruta: "/proyectos?pestana=en_marcha", prioridad: 0.8 },
    { ruta: "/proyectos?pestana=paralizadas", prioridad: 0.7 },
    { ruta: "/mercado", prioridad: 0.8 },
    { ruta: "/planes", prioridad: 0.6 },
    { ruta: "/mcp", prioridad: 0.5 },
    ...REGIONES_UBIGEO.map((r) => ({ ruta: `/mercado?region=${r.ubigeo}`, prioridad: 0.6 })),
    ...SECTORES.filter((s) => s.clave !== "otros").map((s) => ({ ruta: `/mercado?sector=${s.clave}`, prioridad: 0.5 })),
  ];
  const fichas: UrlSitemap[] = [];
  try {
    const r = await fetch(`${API_BASE}/proyectos/sitemap`, { next: { revalidate: 3600 } } as RequestInit);
    if (r.ok) {
      const j = (await r.json()) as { data?: { cui: string; fecha?: string | null }[] };
      for (const p of j.data ?? []) if (/^\d{7}$/.test(p.cui)) fichas.push({ ruta: `/proyecto/${p.cui}`, fecha: p.fecha ?? null, prioridad: 0.6 });
    }
  } catch {
    // Sin la API, el sitemap sale con las páginas fijas.
  }
  return sitemapDe("obras", [...fijas, ...fichas]);
}
