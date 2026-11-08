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

/** `ruta`: la dirección pedida (/mcp, /mcp/empleo…): sus metadatos dicen que ella es el recurso. */
function desafio(env: EnvV2, ruta = "/mcp"): Response {
  const cabecera =
    `Bearer error="invalid_token", error_description="This server needs a Gobserva account with an active plan", ` +
    `resource_metadata="${env.MCP_URL}/.well-known/oauth-protected-resource${ruta}", scope="${SCOPES.join(" ")}"`;
  return Response.json(
    { error: "invalid_token", error_description: "El MCP de Gobserva viene con los planes de pago: conecta tu cuenta de Gobserva." },
    { status: 401, headers: { "WWW-Authenticate": cabecera, "Cache-Control": "no-store" } },
  );
}

/**
 * Las direcciones por producto como recursos OAuth (2026-11-08). La librería conoce un solo recurso (/mcp) y acepta su
 * token en las subrutas, pero un cliente que sigue RFC 9728/8707 pide el token para la dirección que le dieron
 * (/mcp/empleo): sus metadatos dicen que ella es el recurso y, al autorizar y al pedir el token, se traduce a /mcp.
 */
const SUBRUTA = /^\/mcp\/(empleo|licitaciones|obras)$/;
const NOMBRE_SUBRUTA: Record<string, string> = { empleo: "Gobserva Empleo", licitaciones: "Gobserva Licitaciones", obras: "Gobserva Licitaciones" };

/** La subruta de un `resource` de este MCP («empleo», «licitaciones», «obras») o null. */
function subrutaDe(env: EnvV2, recurso: string | null): string | null {
  if (!recurso) return null;
  try {
    const u = new URL(recurso);
    return u.origin === new URL(env.MCP_URL).origin ? (SUBRUTA.exec(u.pathname.replace(/\/$/, ""))?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

function metadatosSubruta(env: EnvV2, sub: string): Response {
  return Response.json(
    {
      resource: `${env.MCP_URL}/mcp/${sub}`,
      authorization_servers: [env.MCP_URL],
      scopes_supported: ["datos"],
      bearer_methods_supported: ["header"],
      resource_name: NOMBRE_SUBRUTA[sub],
    },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  );
}

/** /authorize y /oauth/token con `resource=…/mcp/empleo` → `…/mcp` (y en /authorize, la app para marcar la cuenta). */
async function traducirRecurso(request: Request, env: EnvV2): Promise<Request> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize" && request.method === "GET") {
    const sub = subrutaDe(env, url.searchParams.get("resource"));
    if (!sub) return request;
    url.searchParams.set("resource", `${env.MCP_URL}/mcp`);
    url.searchParams.set("gobserva_app", sub === "empleo" ? "empleo" : "licitaciones");
    return new Request(url.toString(), request);
  }
  if (url.pathname === "/oauth/token" && request.method === "POST" && /x-www-form-urlencoded/i.test(request.headers.get("content-type") ?? "")) {
    const cuerpo = new URLSearchParams(await request.clone().text());
    const recursos = cuerpo.getAll("resource");
    if (!recursos.some((r) => subrutaDe(env, r))) return request;
    cuerpo.delete("resource");
    for (const r of new Set(recursos.map((r) => (subrutaDe(env, r) ? `${env.MCP_URL}/mcp` : r)))) cuerpo.append("resource", r);
    const cabeceras = new Headers(request.headers);
    cabeceras.delete("content-length");
    return new Request(request.url, { method: "POST", headers: cabeceras, body: cuerpo.toString() });
  }
  return request;
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
  if (perfil && interno && env.MCP_INTERNO_TOKEN && iguales(interno, env.MCP_INTERNO_TOKEN)) {
    return atenderMcp(request, {
      env, ctx, ip: null, perfil,
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
      if (llamaProtegida(cuerpo)) return desafio(env, url.pathname);
    }
    return atenderMcp(request, { env, ctx, usuario: null, ip: request.headers.get("cf-connecting-ip"), perfil });
  }
  const sub = /^\/\.well-known\/oauth-protected-resource\/mcp\/([a-z]+)$/.exec(url.pathname)?.[1];
  if (sub && SUBRUTA.test(`/mcp/${sub}`)) return metadatosSubruta(env, sub);
  return proveedorOAuth(env, conCuenta).fetch(await traducirRecurso(request, env), env, ctx);
}
