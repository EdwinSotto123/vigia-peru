import { sitemapDe } from "@/lib/gobserva-seo";

/** El sitemap de car.gobserva.cloud: sus páginas fijas (las de cada placa no van: son noindex). */
export const dynamic = "force-static";

export function GET() {
  return sitemapDe("car", [
    { ruta: "/", prioridad: 1 },
    { ruta: "/placa", prioridad: 0.9 },
    { ruta: "/revision-tecnica", prioridad: 0.9 },
    { ruta: "/fuentes", prioridad: 0.5 },
  ]);
}
