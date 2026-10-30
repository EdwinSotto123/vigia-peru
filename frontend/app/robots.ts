import type { MetadataRoute } from "next";
import { absoluta } from "@/lib/seo";

/**
 * /robots.txt. Los rastreadores que juntan páginas para ENTRENAR modelos de IA no entran (además, Cloudflare los bloquea
 * en gobserva.cloud: infrastructure/deploy/cloudflare/gobserva-redirect/README.md). Los buscadores y los asistentes que
 * abren una página porque una persona lo pidió (OAI-SearchBot, ChatGPT-User, Claude-User, PerplexityBot…) sí.
 *
 * Para todos quedan fuera las páginas con consulta: listas con filtros y páginas, pestañas de una ficha (`?seccion=`) y
 * vistas de un contrato. Son combinaciones sin fin de lo mismo (el 2026-10-30 un rastreador recorría /app/personas con un
 * filtro distinto en cada pedido) y cada ficha ya está en el sitemap (lib/sitemap.ts) por su ruta, que es su canónica
 * (lib/seo.ts). Las fichas de personas no se prohíben aquí: llevan `noindex`, y un buscador sólo lo ve si puede entrar.
 */
const ENTRENAMIENTO_IA = [
  "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent",
  "FacebookBot", "Amazonbot", "cohere-ai", "cohere-training-data-crawler", "Diffbot", "omgili", "Timpibot", "ImagesiftBot",
  "AI2Bot", "PanguBot", "Kangaroo Bot", "ICC-Crawler", "Webzio-Extended", "img2dataset",
];

/** Rastreadores comerciales de SEO: recorren el sitio entero para vender índices de enlaces. Que pidan con calma. */
const SEO_COMERCIAL = ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "DataForSeoBot", "BLEXBot", "Barkrowler", "serpstatbot"];

const FUERA = [
  "/api/",
  // /v1/: lo que el navegador le pide a la API (worker-prod.js); no es una página.
  "/v1/",
  "/admin",
  "/app/*?",
  "/entidad/*?",
  "/empresa/*?",
  "/region/*?",
  // La trampa para rastreadores (worker-prod.js): quien la pide queda vetado una hora.
  "/app/indice-completo",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ENTRENAMIENTO_IA, disallow: "/" },
      { userAgent: SEO_COMERCIAL, allow: "/", disallow: FUERA, crawlDelay: 10 },
      { userAgent: "*", allow: "/", disallow: FUERA },
    ],
    sitemap: absoluta("/sitemap.xml"),
  };
}
