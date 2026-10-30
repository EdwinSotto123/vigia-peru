// Vigía Perú · servidor MCP remoto en Cloudflare Workers (réplica de backend/mcp/server.py).
//
// Expone datos PÚBLICOS de Vigía (alertas de riesgo, banderas con su evidencia, sanciones OSCE) a
// cualquier cliente LLM como tools read-only. Abierto como el de Cloud Run (--allow-unauthenticated):
// no hay token ni cabecera de autenticación.
//
// Transporte: Streamable HTTP en `/mcp`, sin estado. Cada POST arma su propio Server + transporte
// (sin Mcp-Session-Id ni Durable Objects): ninguna tool depende de la sesión, así que un cliente que
// hablaba con el FastMCP con sesiones funciona igual. Las respuestas salen como SSE, como en Python.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Env } from "./db";
import { ejecutarHerramienta, HERRAMIENTAS } from "./herramientas";

const RUTA = "/mcp";
const SERVIDOR = { name: "vigia-peru", version: "1.0.0" };

// Las mismas capacidades que anuncia FastMCP (prompts y resources vacíos incluidos).
const CAPACIDADES = {
  experimental: {},
  prompts: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
  tools: { listChanged: false },
};

function crearServidor(env: Env, ctx: ExecutionContext): Server {
  const server = new Server(SERVIDOR, { capabilities: CAPACIDADES });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: HERRAMIENTAS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    ejecutarHerramienta(req.params.name, req.params.arguments ?? {}, env, ctx),
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  return server;
}

// Abierto, pero no sin fondo: cada llamada consulta la base. 120 por minuto por IP (una IPv6 por su /64), contadas por el
// Durable Object `Limitador` de vigia-api, el mismo que limita la API y la web (backend/api/src/lib/antibots.ts). Alto
// a propósito: los clientes de IA alojados (Claude, ChatGPT) salen por pocas IPs compartidas entre sus usuarios.
const TOPE_POR_MINUTO = 120;

/** Una IPv4 entera; una IPv6 por su /64 (como backend/api/src/lib/antibots.ts → claveIp). */
function claveIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const comprimida = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = comprimida && cola ? cola.split(":") : [];
  const grupos = comprimida ? [...antes, ...Array<string>(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** true si el pedido entra en el límite; si el limitador falla, se atiende (mejor eso que dejar el MCP caído). */
async function dentroDelLimite(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.LIMITADOR) return true;
  try {
    const objeto = env.LIMITADOR.get(env.LIMITADOR.idFromName(`mcp|${claveIp(ip)}`)) as unknown as {
      contar(tope: number, ventanaMs: number): Promise<boolean>;
    };
    return await objeto.contar(TOPE_POR_MINUTO, 60_000);
  } catch {
    return true;
  }
}

// Sin sesiones no hay stream GET ni DELETE: sólo POST. Cuerpo con el formato de error del SDK Python.
function metodoNoPermitido(): Response {
  const cuerpo = { jsonrpc: "2.0", id: "server-error", error: { code: -32600, message: "Method Not Allowed" } };
  return Response.json(cuerpo, { status: 405, headers: { Allow: "POST" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === `${RUTA}/`) {
      // Starlette (redirect_slashes) redirige /mcp/ → /mcp con 307, que conserva método y cuerpo.
      url.pathname = RUTA;
      return new Response(null, { status: 307, headers: { Location: url.toString() } });
    }
    if (url.pathname !== RUTA) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST") return metodoNoPermitido();
    if (!(await dentroDelLimite(request, env))) {
      const cuerpo = { jsonrpc: "2.0", id: "server-error", error: { code: -32000, message: "Demasiados pedidos desde tu conexión: espera un minuto." } };
      return Response.json(cuerpo, { status: 429, headers: { "Retry-After": "60" } });
    }

    const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await crearServidor(env, ctx).connect(transporte);
    return transporte.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
