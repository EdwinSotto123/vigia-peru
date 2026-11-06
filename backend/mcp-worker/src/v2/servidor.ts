// El servidor MCP v2: todas las herramientas, los recursos y los prompts, sobre Streamable HTTP sin estado (cada POST
// arma su servidor y su transporte; nada depende de la sesión).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { INSTRUCCIONES, registrarGuias } from "./guias";
import { HERRAMIENTAS_ACTORES } from "./herramientas/actores";
import { HERRAMIENTAS_CONTRATOS } from "./herramientas/contratos";
import { HERRAMIENTAS_CUENTA } from "./herramientas/cuenta";
import { HERRAMIENTAS_DATOS } from "./herramientas/datos";
import { HERRAMIENTAS_ENTIDAD } from "./herramientas/entidad";
import { HERRAMIENTAS_PRODUCTOS } from "./herramientas/productos";
import { registrar, type Contexto } from "./registro";

export const HERRAMIENTAS = [
  ...HERRAMIENTAS_CONTRATOS,
  ...HERRAMIENTAS_ACTORES,
  ...HERRAMIENTAS_ENTIDAD,
  ...HERRAMIENTAS_DATOS,
  ...HERRAMIENTAS_CUENTA,
  ...HERRAMIENTAS_PRODUCTOS,
];

/** Las que piden cuenta: sin token, el pedido HTTP se responde 401 y Claude muestra «Conectar» (autenticación perezosa). */
export const PROTEGIDAS = new Set(HERRAMIENTAS.filter((h) => h.cuenta).map((h) => h.nombre));

export function crearServidor(cx: Contexto): McpServer {
  const server = new McpServer(
    { name: "vigia", title: "Vigía by Gobserva", version: "2.0.0", websiteUrl: cx.env.VIGIA_URL },
    { instructions: INSTRUCCIONES, capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } } },
  );
  for (const h of HERRAMIENTAS) registrar(server, h, cx);
  registrarGuias(server, cx);
  return server;
}

export async function atenderMcp(request: Request, cx: Contexto): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Este servidor no tiene sesiones: solo POST." } },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await crearServidor(cx).connect(transporte);
  return transporte.handleRequest(request);
}

/** ¿El cuerpo JSON-RPC (uno o un lote) llama a una herramienta que pide cuenta? */
export function llamaProtegida(cuerpo: unknown): boolean {
  const mensajes = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  return mensajes.some((m) => {
    if (!m || typeof m !== "object") return false;
    const x = m as { method?: unknown; params?: { name?: unknown } };
    return x.method === "tools/call" && typeof x.params?.name === "string" && PROTEGIDAS.has(x.params.name);
  });
}
