// El servidor MCP v2: todas las herramientas, los recursos y los prompts, sobre Streamable HTTP sin estado (cada POST
// arma su servidor y su transporte; nada depende de la sesión).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { INSTRUCCIONES, INSTRUCCIONES_EMPLEO, INSTRUCCIONES_LICITACIONES, INSTRUCCIONES_SALUD, registrarGuias } from "./guias";
import { HERRAMIENTAS_ACTORES } from "./herramientas/actores";
import { HERRAMIENTAS_CONTRATOS } from "./herramientas/contratos";
import { HERRAMIENTAS_CONTROL } from "./herramientas/control";
import { HERRAMIENTAS_CUENTA } from "./herramientas/cuenta";
import { HERRAMIENTAS_DATOS } from "./herramientas/datos";
import { HERRAMIENTAS_ENTIDAD } from "./herramientas/entidad";
import { HERRAMIENTAS_PRODUCTOS } from "./herramientas/productos";
import { HERRAMIENTAS_SALUD } from "./herramientas/salud";
import { registrar, type Contexto, type Perfil } from "./registro";

export const HERRAMIENTAS = [
  ...HERRAMIENTAS_CONTRATOS,
  ...HERRAMIENTAS_CONTROL,
  ...HERRAMIENTAS_ACTORES,
  ...HERRAMIENTAS_ENTIDAD,
  ...HERRAMIENTAS_DATOS,
  ...HERRAMIENTAS_CUENTA,
  ...HERRAMIENTAS_PRODUCTOS,
  ...HERRAMIENTAS_SALUD,
];

/**
 * Las que piden cuenta: TODAS desde 2026-11-08 (el MCP es de los planes de pago). Sin token, el pedido HTTP se responde
 * 401 y Claude muestra «Conectar» (autenticación perezosa); initialize, tools/list, los recursos y los prompts siguen
 * abiertos para que el cliente sepa qué hay.
 */
export const PROTEGIDAS = new Set(HERRAMIENTAS.filter((h) => !h.abierta).map((h) => h.nombre));
/** Las de Gobserva Salud (abiertas, sin cuenta): /mcp/salud. */
const DE_SALUD = new Set(HERRAMIENTAS_SALUD.map((h) => h.nombre));

/**
 * Una dirección por producto (2026-11-08): la IA elige mejor entre pocas herramientas, el conector se llama como el
 * producto y cada portada da la suya. /mcp sigue con todas (el plan Institucional, Vigía).
 */
const DE_EMPLEO = new Set(["buscar_plazas_cas", "ficha_plaza_cas", "estado_fuentes", "mi_cupo"]);
const DE_LICITACIONES = new Set([
  "buscar", "buscar_licitaciones", "compras_menores", "mercado_rubro", "buscar_proyectos_inversion", "ficha_proyecto", "mercado_obras",
  "buscar_contratos", "ficha_contrato", "ficha_empresa", "ficha_entidad", "proveedores_de_entidad", "ordenes", "buscar_documentos",
  "documentos_zip", "estado_fuentes", "mi_cupo",
]);

/** El perfil de una ruta: /mcp, /mcp/empleo, /mcp/licitaciones (o /mcp/obras, que es parte de Licitaciones). */
export function perfilDeRuta(ruta: string): Perfil | null {
  if (ruta === "/mcp") return "todo";
  if (ruta === "/mcp/empleo") return "empleo";
  if (ruta === "/mcp/licitaciones" || ruta === "/mcp/obras") return "licitaciones";
  if (ruta === "/mcp/salud") return "salud";
  return null;
}

export const herramientasDe = (p: Perfil = "todo") =>
  p === "todo" ? HERRAMIENTAS : HERRAMIENTAS.filter((h) => (p === "empleo" ? DE_EMPLEO : p === "salud" ? DE_SALUD : DE_LICITACIONES).has(h.nombre));

const SERVIDOR: Record<Perfil, { name: string; title: string; instrucciones: string; web: (cx: Contexto) => string }> = {
  todo: { name: "vigia", title: "Vigía by Gobserva", instrucciones: INSTRUCCIONES, web: (cx) => cx.env.VIGIA_URL },
  empleo: { name: "gobserva-empleo", title: "Gobserva Empleo", instrucciones: INSTRUCCIONES_EMPLEO, web: () => "https://empleo.gobserva.cloud" },
  licitaciones: { name: "gobserva-licitaciones", title: "Gobserva Licitaciones", instrucciones: INSTRUCCIONES_LICITACIONES, web: () => "https://licitaciones.gobserva.cloud" },
  salud: { name: "gobserva-salud", title: "Gobserva Salud", instrucciones: INSTRUCCIONES_SALUD, web: () => "https://salud.gobserva.cloud" },
};

export function crearServidor(cx: Contexto): McpServer {
  const perfil = cx.perfil ?? "todo";
  const s = SERVIDOR[perfil];
  const server = new McpServer(
    { name: s.name, title: s.title, version: "2.1.0", websiteUrl: s.web(cx) },
    { instructions: s.instrucciones, capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } } },
  );
  for (const h of herramientasDe(perfil)) registrar(server, h, cx);
  // Las guías y los prompts de investigación son de Vigía.
  if (perfil === "todo") registrarGuias(server, cx);
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

/** ¿El cuerpo JSON-RPC (uno o un lote) llama a una herramienta que pide cuenta? (PROTEGIDAS: todas menos las abiertas de Salud) */
export function llamaProtegida(cuerpo: unknown): boolean {
  const mensajes = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  return mensajes.some((m) => {
    if (!m || typeof m !== "object") return false;
    const x = m as { method?: unknown; params?: { name?: unknown } };
    return x.method === "tools/call" && !(typeof x.params?.name === "string" && !PROTEGIDAS.has(x.params.name) && HERRAMIENTAS.some((h) => h.nombre === x.params?.name));
  });
}
