import type { MetadataRoute } from "next";

/**
 * /robots.txt. Los rastreadores que juntan páginas para ENTRENAR modelos de IA no entran (además, Cloudflare los bloquea
 * en gobserva.cloud: infrastructure/deploy/cloudflare/gobserva-redirect/README.md). Los buscadores y los asistentes que
 * abren una página porque una persona lo pidió (OAI-SearchBot, ChatGPT-User, Claude-User, PerplexityBot…) sí.
 *
 * Para todos, las listas de /app con filtros quedan fuera: son combinaciones sin fin (el 2026-10-30 un rastreador recorría
 * /app/personas con un filtro distinto en cada pedido) y cada ficha se encuentra igual por su enlace, que va por la ruta
 * (/empresa/<RUC>, /app/contratos/<id>). Las páginas de una lista (`?pagina=`) sí se recorren.
 */
const ENTRENAMIENTO_IA = [
  "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent",
  "FacebookBot", "Amazonbot", "cohere-ai", "cohere-training-data-crawler", "Diffbot", "omgili", "Timpibot", "ImagesiftBot",
  "AI2Bot", "PanguBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ENTRENAMIENTO_IA, disallow: "/" },
      {
        userAgent: "*",
        allow: ["/", "/app/*?pagina=", "/app/*?page="],
        disallow: ["/api/", "/admin", "/app/*?"],
      },
    ],
  };
}
