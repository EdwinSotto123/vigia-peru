// Entrada del MCP v2 (mcp.gobserva.cloud; en DEV, vigia-mcp-dev.vigiaperu.workers.dev).
//
// Autenticación perezosa (claude.com/docs/connectors/building/lazy-authentication): sin token, initialize, tools/list y
// las herramientas abiertas responden; una llamada a una herramienta que pide cuenta recibe 401 con WWW-Authenticate
// ANTES de llegar al SDK, y Claude muestra «Conectar» y reintenta la misma llamada con el token. Con token, todo pasa
// por OAuthProvider, que lo valida y entrega las props de la cuenta.
import type { EnvV2, PropsCuenta } from "./entorno";
import { proveedorOAuth, SCOPES } from "./oauth";
import { atenderMcp, llamaProtegida, perfilDeRuta } from "./servidor";

async function conCuenta(request: Request, env: EnvV2, ctx: ExecutionContext): Promise<Response> {
  const c = ctx as ExecutionContext & { props?: PropsCuenta; auth?: { scope?: string[] } };
  const props = c.props;
  if (!props?.uid) return new Response("Token sin cuenta", { status: 401 });
  return atenderMcp(request, {
    env,
    ctx,
    usuario: { ...props, planes: props.planes ?? [], scope: c.auth?.scope ?? [] },
    ip: request.headers.get("cf-connecting-ip"),
    perfil: perfilDeRuta(new URL(request.url).pathname) ?? "todo",
  });
}

function desafio(env: EnvV2): Response {
  const cabecera =
    `Bearer error="invalid_token", error_description="This server needs a Gobserva account with an active plan", ` +
    `resource_metadata="${env.MCP_URL}/.well-known/oauth-protected-resource/mcp", scope="${SCOPES.join(" ")}"`;
  return Response.json(
    { error: "invalid_token", error_description: "El MCP de Gobserva viene con los planes de pago: conecta tu cuenta de Gobserva." },
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
  const perfil = perfilDeRuta(url.pathname);
  if (perfil === "todo" && interno && env.MCP_INTERNO_TOKEN && iguales(interno, env.MCP_INTERNO_TOKEN)) {
    return atenderMcp(request, {
      env, ctx, ip: null,
      usuario: { uid: "equipo-vigia", planes: ["interno"], planesAl: Date.now(), scope: [...SCOPES] },
    });
  }
  // /mcp/ y /mcp/empleo/ → sin la barra final (307 conserva el método y el cuerpo).
  if (url.pathname.length > 4 && url.pathname.endsWith("/") && perfilDeRuta(url.pathname.slice(0, -1))) {
    url.pathname = url.pathname.slice(0, -1);
    return new Response(null, { status: 307, headers: { Location: url.toString() } });
  }
  if (url.pathname.startsWith("/mcp/") && !perfil) {
    return Response.json({ error: "no_encontrado", detail: "Las direcciones son /mcp, /mcp/empleo y /mcp/licitaciones." }, { status: 404 });
  }
  if (perfil && !request.headers.has("authorization")) {
    if (request.method === "POST") {
      const cuerpo = await request.clone().json().catch(() => null);
      if (llamaProtegida(cuerpo)) return desafio(env);
    }
    return atenderMcp(request, { env, ctx, usuario: null, ip: request.headers.get("cf-connecting-ip"), perfil });
  }
  return proveedorOAuth(env, conCuenta).fetch(request, env, ctx);
}
