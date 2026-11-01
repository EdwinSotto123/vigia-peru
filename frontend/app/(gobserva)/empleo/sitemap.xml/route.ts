import { API_BASE } from "@/lib/api-client";
import { sitemapDe, type UrlSitemap } from "@/lib/gobserva-seo";

/** El sitemap de empleo.gobserva.cloud: sus páginas y la ficha de cada plaza abierta (GET /empleo/sitemap). */
// En cada pedido y no en el build (que no alcanza la API): las fichas salen de la API, con su caché.
export const dynamic = "force-dynamic";

export async function GET() {
  const fijas: UrlSitemap[] = [
    { ruta: "/", prioridad: 1 },
    { ruta: "/plazas", prioridad: 0.9 },
    { ruta: "/planes", prioridad: 0.6 },
    { ruta: "/mcp", prioridad: 0.5 },
  ];
  let plazas: UrlSitemap[] = [];
  try {
    const r = await fetch(`${API_BASE}/empleo/sitemap`, { next: { revalidate: 3600 } } as RequestInit);
    if (r.ok) {
      const j = (await r.json()) as { data?: { aviso: number; fecha: string | null }[] };
      plazas = (j.data ?? []).map((p) => ({ ruta: `/plaza/${p.aviso}`, fecha: p.fecha, prioridad: 0.7 }));
    }
  } catch {
    /* sin la API, sólo las páginas fijas */
  }
  return sitemapDe("empleo", [...fijas, ...plazas]);
}
