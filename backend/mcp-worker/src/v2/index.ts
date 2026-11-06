// Entrada del MCP v2 (mcp.gobserva.cloud; en DEV, vigia-mcp-dev.vigiaperu.workers.dev).
//
// Autenticación perezosa (claude.com/docs/connectors/building/lazy-authentication): sin token, initialize, tools/list y
// las herramientas abiertas responden; una llamada a una herramienta que pide cuenta recibe 401 con WWW-Authenticate
// ANTES de llegar al SDK, y Claude muestra «Conectar» y reintenta la misma llamada con el token. Con token, todo pasa
// por OAuthProvider, que lo valida y entrega las props de la cuenta.
import type { EnvV2, PropsCuenta } from "./entorno";
import { proveedorOAuth, SCOPES } from "./oauth";
import { atenderMcp, llamaProtegida } from "./servidor";

async function conCuenta(request: Request, env: EnvV2, ctx: ExecutionContext): Promise<Response> {
  const c = ctx as ExecutionContext & { props?: PropsCuenta; auth?: { scope?: string[] } };
  const props = c.props;
  if (!props?.uid) return new Response("Token sin cuenta", { status: 401 });
  return atenderMcp(request, {
    env,
    ctx,
    usuario: { ...props, planes: props.planes ?? [], scope: c.auth?.scope ?? [] },
    ip: request.headers.get("cf-connecting-ip"),
  });
}

function desafio(env: EnvV2): Response {
  const cabecera =
    `Bearer error="invalid_token", error_description="This tool needs a Gobserva account", ` +
    `resource_metadata="${env.MCP_URL}/.well-known/oauth-protected-resource/mcp", scope="${SCOPES.join(" ")}"`;
  return Response.json(
    { error: "invalid_token", error_description: "Esta herramienta necesita tu cuenta gratis de Gobserva." },
    { status: 401, headers: { "WWW-Authenticate": cabecera, "Cache-Control": "no-store" } },
  );
}

/** Comparación en tiempo constante (la cabecera interna es un secreto). */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function manejarV2(request: Request, env: EnvV2, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // El chat del panel (vigia-api por service binding) entra como la cuenta del equipo: todas las herramientas, sin cupo.
  const interno = request.headers.get("x-vigia-interno");
  if (url.pathname === "/mcp" && interno && env.MCP_INTERNO_TOKEN && iguales(interno, env.MCP_INTERNO_TOKEN)) {
    return atenderMcp(request, {
      env, ctx, ip: null,
      usuario: { uid: "equipo-vigia", planes: ["interno"], planesAl: Date.now(), scope: [...SCOPES] },
    });
  }
  if (url.pathname === "/mcp/") {
    url.pathname = "/mcp";
    return new Response(null, { status: 307, headers: { Location: url.toString() } });
  }
  if (url.pathname === "/mcp" && !request.headers.has("authorization")) {
    if (request.method === "POST") {
      const cuerpo = await request.clone().json().catch(() => null);
      if (llamaProtegida(cuerpo)) return desafio(env);
    }
    return atenderMcp(request, { env, ctx, usuario: null, ip: request.headers.get("cf-connecting-ip") });
  }
  return proveedorOAuth(env, conCuenta).fetch(request, env, ctx);
}
