import { API_BASE } from "@/lib/api-client";
import { sitemapDe, type UrlSitemap } from "@/lib/gobserva-seo";

/**
 * El sitemap de licitaciones.gobserva.cloud: sus páginas, el mercado de los rubros de ejemplo y las fichas de las
 * convocatorias de los últimos 30 días (GET /licitaciones/oportunidades, de 50 en 50, hasta 1,000).
 */
// En cada pedido y no en el build (que no alcanza la API): las fichas salen de la API, con su caché.
export const dynamic = "force-dynamic";

const RUBROS = ["combustible", "alimentos", "medicamentos", "mantenimiento de vias", "consultoria de obras", "uniformes", "utiles de oficina", "computadoras"];

export async function GET() {
  const fijas: UrlSitemap[] = [
    { ruta: "/", prioridad: 1 },
    { ruta: "/oportunidades", prioridad: 0.9 },
    { ruta: "/mercado", prioridad: 0.8 },
    { ruta: "/planes", prioridad: 0.6 },
    ...RUBROS.map((r) => ({ ruta: `/mercado?q=${encodeURIComponent(r)}`, prioridad: 0.5 })),
  ];
  const fichas: UrlSitemap[] = [];
  for (let page = 1; page <= 20; page++) {
    try {
      const r = await fetch(`${API_BASE}/licitaciones/oportunidades?dias=30&size=50&page=${page}`, { next: { revalidate: 3600 } } as RequestInit);
      if (!r.ok) break;
      const j = (await r.json()) as { data?: { ocid: string; fecha?: string | null; fechaConvocatoria?: string | null }[] };
      const datos = j.data ?? [];
      for (const o of datos) fichas.push({ ruta: `/oportunidad/${encodeURIComponent(o.ocid)}`, fecha: o.fechaConvocatoria ?? o.fecha ?? null, prioridad: 0.6 });
      if (datos.length < 50) break;
    } catch {
      break;
    }
  }
  return sitemapDe("licitaciones", [...fijas, ...fichas]);
}
