import { urlCanonica, type Producto } from "@/lib/gobserva";

/**
 * robots.txt de un producto de Gobserva (su subdominio lo pide en /robots.txt y el middleware lo trae aquí). La misma
 * política que Vigía (app/robots.ts): fuera los rastreadores que entrenan IA; los buscadores, bienvenidos.
 */
const ENTRENAMIENTO_IA = [
  "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent",
  "FacebookBot", "Amazonbot", "cohere-ai", "cohere-training-data-crawler", "Diffbot", "omgili", "Timpibot", "ImagesiftBot",
  "AI2Bot", "PanguBot", "Kangaroo Bot", "ICC-Crawler", "Webzio-Extended", "img2dataset",
];

export function robotsDe(producto: Producto): Response {
  const lineas = [
    ...ENTRENAMIENTO_IA.map((a) => `User-agent: ${a}`),
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /v1/",
    "",
    `Sitemap: ${urlCanonica(producto, "/sitemap.xml")}`,
    "",
  ];
  return new Response(lineas.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

/** Una URL del sitemap: la ruta del producto (canónica) y, si hay, la fecha de su último cambio. */
export interface UrlSitemap {
  ruta: string;
  fecha?: string | null;
  prioridad?: number;
}

/** sitemap.xml de un producto de Gobserva: sus páginas fijas y las fichas que trae su API. */
export function sitemapDe(producto: Producto, urls: UrlSitemap[]): Response {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cuerpo = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `<url><loc>${esc(urlCanonica(producto, u.ruta))}</loc>${u.fecha ? `<lastmod>${esc(u.fecha)}</lastmod>` : ""}${
          u.prioridad != null ? `<priority>${u.prioridad.toFixed(1)}</priority>` : ""
        }</url>`,
    ),
    "</urlset>",
  ].join("\n");
  return new Response(cuerpo, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
