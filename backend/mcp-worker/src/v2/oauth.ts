// OAuth 2.1 del MCP v2 con @cloudflare/workers-oauth-provider: el mismo Worker es el servidor de autorización y el
// recurso (/mcp). Lo que pide Claude (claude.com/docs/connectors/building/authentication):
//   · metadatos del recurso (RFC 9728) y del servidor (RFC 8414), que la librería sirve en /.well-known/…;
//   · Client ID Metadata Document (Claude lo usa si se anuncia `client_id_metadata_document_supported` y `none`) y, de
//     respaldo, registro dinámico en /oauth/register; PKCE S256; refresh token que rota; `invalid_grant` al revocar.
// La identidad es la cuenta de Gobserva (Firebase): /authorize muestra a quién se le da acceso, la persona entra con su
// correo o con Google en esta misma página, y al permitir se guarda (cifrado) su uid, su token de refresco de Firebase y
// sus planes. Cada refresh del token del MCP relee el plan; si Firebase dice que la sesión ya no vale, se revoca.
import OAuthProvider, { AuthorizationError, CimdFetchError, OAuthError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { api } from "./api";
import type { EnvV2, PropsCuenta } from "./entorno";
import { ErrorSesion, renovarIdToken, verificarIdToken } from "./firebase";

export const SCOPES = ["datos", "seguimiento"];

const QUE_PERMITE: Record<string, string> = {
  datos: "Usar las herramientas que piden cuenta (red de una empresa, línea de tiempo, cifras, personas con cargo público) con tu cupo.",
  seguimiento: "Seguir y dejar de seguir entidades, empresas, partidos y regiones, y ver lo nuevo de lo que sigues.",
};

/** Los planes activos de la cuenta («licitaciones:pro»); si la ruta no está o falla, gratis. */
export async function planesDe(env: EnvV2, idToken: string): Promise<string[]> {
  try {
    const r = await api<{ planes?: { producto?: string; plan?: string }[] }>(env, "/gobserva/cuenta/planes", {}, { token: idToken });
    return (r.planes ?? []).filter((p) => p.plan && p.plan !== "gratis").map((p) => `${p.producto}:${p.plan}`);
  } catch {
    return [];
  }
}

const escapar = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pagina(titulo: string, cuerpo: string, extra = ""): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapar(titulo)}</title>
<style>
:root{--fondo:#f6f7f4;--papel:#fff;--tinta:#16191d;--suave:#5b6470;--borde:#d9ddd4;--acento:#2f6b2f;--alerta:#8a4b00}
@media (prefers-color-scheme:dark){:root{--fondo:#0f1210;--papel:#171b18;--tinta:#e8ece6;--suave:#a3ada0;--borde:#2c332d;--acento:#9bd28a;--alerta:#f0b45a}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--tinta);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:0 auto;padding:2rem 1rem}h1{font-size:1.35rem;line-height:1.25;margin:0 0 .75rem}
.marca{font-family:ui-monospace,"JetBrains Mono",monospace;color:var(--acento);font-weight:600;margin-bottom:1.25rem}
.caja{background:var(--papel);border:1px solid var(--borde);border-radius:.75rem;padding:1rem;margin:1rem 0}
.suave{color:var(--suave);font-size:.9rem}.alerta{color:var(--alerta)}ul{padding-left:1.1rem;margin:.5rem 0}li{margin:.25rem 0}
label{display:block;font-size:.9rem;margin:.6rem 0 .2rem}input[type=email],input[type=password],input[type=text]{width:100%;padding:.6rem;border:1px solid var(--borde);border-radius:.5rem;background:var(--fondo);color:var(--tinta);font:inherit}
button{font:inherit;border-radius:.5rem;padding:.6rem 1rem;border:1px solid var(--borde);background:var(--papel);color:var(--tinta);cursor:pointer;width:100%;margin-top:.6rem}
button.principal{background:var(--acento);border-color:var(--acento);color:var(--papel);font-weight:600}button:disabled{opacity:.5;cursor:default}
.fila{display:flex;gap:.5rem}.fila button{margin-top:.75rem}a{color:var(--acento)}[hidden]{display:none!important}
</style></head><body><main><div class="marca">vigía_ by gobserva</div>${cuerpo}</main>${extra}</body></html>`;
}

function paginaError(mensaje: string, estado = 400): Response {
  return new Response(pagina("No se pudo conectar", `<h1>No se pudo conectar</h1><p>${escapar(mensaje)}</p><p class="suave">Vuelve a Claude e intenta conectar otra vez.</p>`), {
    status: estado,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function paginaConsentimiento(env: EnvV2, d: ConsentDescription, handle: string): string {
  const quien = d.clientDomain
    ? `<strong>${escapar(d.clientName)}</strong> <span class="suave">(publicado por ${escapar(d.clientDomain)})</span>`
    : `<strong>${escapar(d.clientName)}</strong> <span class="suave">(se registró solo: su nombre no está verificado)</span>`;
  const permisos = SCOPES.map((s) => `<li><input type="hidden" name="scope" value="${escapar(s)}">${escapar(QUE_PERMITE[s] ?? s)}</li>`)
    .join("");
  const config = JSON.stringify({
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    appId: env.FIREBASE_APP_ID,
  }).replace(/</g, "\\u003c");
  const cuerpo = `
<h1>Conectar Vigía con tu cuenta de Gobserva</h1>
<p>${quien} pide acceso a Vigía con tu cuenta. El acceso irá a <strong>${escapar(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="alerta"><strong>El acceso va a una aplicación de tu computadora.</strong> Sigue solo si acabas de pedir conectar desde ahí (por ejemplo Claude Code).</p>' : ""}
<div class="caja" id="entrar">
  <p style="margin-top:0"><strong>1. Entra con tu cuenta</strong></p>
  <button type="button" id="google">Entrar con Google</button>
  <form id="correo">
    <label for="email">Correo</label><input id="email" type="email" autocomplete="email" required>
    <label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" required minlength="6">
    <div id="campoNombre" hidden><label for="nombre">Tu nombre</label><input id="nombre" type="text" autocomplete="name" maxlength="80"></div>
    <button type="submit" id="botonCorreo">Entrar con correo</button>
  </form>
  <p class="suave">¿No tienes cuenta? <a href="#" id="crear">Créala aquí</a>. Es gratis.</p>
  <p class="alerta" id="error" role="alert" hidden></p>
</div>
<form method="post" class="caja" id="permitir" hidden>
  <p style="margin-top:0"><strong>2. Permite el acceso</strong></p>
  <p>Entraste como <strong id="quien"></strong>. Vigía podrá:</p>
  <ul>${permisos}</ul>
  <p class="suave">Solo lee datos públicos y lo que sigues. No ve tus conversaciones con Claude. Puedes quitar el acceso desconectando el conector.</p>
  <input type="hidden" name="handle" value="${escapar(handle)}">
  <input type="hidden" name="id_token" id="idToken"><input type="hidden" name="refresh_token" id="refreshToken">
  <div class="fila"><button type="submit" name="decision" value="deny">Cancelar</button><button type="submit" name="decision" value="approve" class="principal">Permitir</button></div>
</form>
<p class="suave">Vigía by Gobserva: datos públicos de la contratación del Estado peruano. <a href="${escapar(env.VIGIA_URL)}" target="_blank" rel="noopener">vigia.gobserva.cloud</a></p>`;
  const script = `<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
const auth = getAuth(initializeApp(${config}));
auth.languageCode = "es";
const $ = (id) => document.getElementById(id);
let creando = false;
const MENSAJES = { "auth/invalid-credential": "El correo o la contraseña no coinciden.", "auth/wrong-password": "El correo o la contraseña no coinciden.",
  "auth/user-not-found": "El correo o la contraseña no coinciden.", "auth/email-already-in-use": "Ese correo ya tiene cuenta: entra con él.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.", "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.", "auth/unauthorized-domain": "Este dominio todavía no está habilitado para entrar con Google." };
function error(e) { const el = $("error"); el.textContent = MENSAJES[e?.code] || "No se pudo entrar. Intenta de nuevo."; el.hidden = false; }
async function listo(user) {
  $("idToken").value = await user.getIdToken(true);
  $("refreshToken").value = user.refreshToken;
  $("quien").textContent = user.email || user.displayName || "tu cuenta";
  $("entrar").hidden = true; $("permitir").hidden = false;
}
$("google").addEventListener("click", async () => {
  try { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" }); await listo((await signInWithPopup(auth, p)).user); } catch (e) { error(e); }
});
$("crear").addEventListener("click", (ev) => { ev.preventDefault(); creando = !creando; $("campoNombre").hidden = !creando;
  $("botonCorreo").textContent = creando ? "Crear cuenta" : "Entrar con correo"; $("crear").textContent = creando ? "Ya tengo cuenta" : "Créala aquí"; });
$("correo").addEventListener("submit", async (ev) => {
  ev.preventDefault(); $("error").hidden = true; $("botonCorreo").disabled = true;
  try {
    const email = $("email").value.trim(), clave = $("clave").value;
    let user;
    if (creando) {
      user = (await createUserWithEmailAndPassword(auth, email, clave)).user;
      const nombre = $("nombre").value.trim(); if (nombre) await updateProfile(user, { displayName: nombre.slice(0, 80) });
      await sendEmailVerification(user).catch(() => {});
    } else user = (await signInWithEmailAndPassword(auth, email, clave)).user;
    await listo(user);
  } catch (e) { error(e); } finally { $("botonCorreo").disabled = false; }
});
</script>`;
  return pagina("Conectar Vigía", cuerpo, script);
}

async function autorizar(request: Request, env: EnvV2): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const solicitud = await oauth.parseAuthRequest(request);
      const detalle = await oauth.describeConsent(solicitud);
      const consentimiento = await oauth.beginConsent(solicitud);
      consentimiento.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(paginaConsentimiento(env, detalle, consentimiento.handle), { headers: consentimiento.headers });
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const negado = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: negado.headers });
    }
    const idToken = String(form.get("id_token") ?? "");
    const frt = String(form.get("refresh_token") ?? "");
    let cuenta;
    try {
      cuenta = await verificarIdToken(idToken, env.FIREBASE_PROJECT_ID);
    } catch {
      return paginaError("No pudimos verificar tu sesión de Gobserva.");
    }
    const planes = await planesDe(env, idToken);
    const elegidos = form.getAll("scope").map(String).filter((s) => SCOPES.includes(s));
    const aprobado = await oauth.approveConsent(request, handle, { scope: elegidos.length ? elegidos : ["datos"] });
    const props: PropsCuenta = { uid: cuenta.uid, nombre: cuenta.nombre, frt: frt || undefined, planes, planesAl: Date.now() };
    const { redirectTo } = await oauth.completeAuthorization({
      request: aprobado.request,
      userId: cuenta.uid,
      metadata: {},
      scope: aprobado.request.scope,
      props,
    });
    aprobado.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: aprobado.headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return paginaError(e.description);
    if (e instanceof CimdFetchError) return paginaError("No pudimos verificar la aplicación que pide acceso.");
    throw e;
  }
}

function inicio(env: EnvV2): Response {
  const url = `${env.MCP_URL}/mcp`;
  const cuerpo = `<h1>El MCP de Vigía</h1>
<p>Conecta Claude con los datos públicos de la contratación del Estado peruano: contratos, empresas, entidades, presupuesto, señales y dictámenes.</p>
<div class="caja"><p style="margin-top:0"><strong>En claude.ai</strong></p><ol>
<li>Abre <strong>Customize &gt; Connectors</strong> y elige <strong>Add custom connector</strong>.</li>
<li>Pega <code>${escapar(url)}</code>.</li>
<li>En un chat, abre <strong>+ &gt; Connectors</strong> y enciende Vigía.</li></ol>
<p class="suave">Muchas herramientas funcionan sin cuenta. Las que la piden muestran «Conectar» la primera vez: entras con tu cuenta gratis de Gobserva.</p></div>
<div class="caja"><p style="margin-top:0"><strong>En Claude Code</strong></p><p><code>claude mcp add --transport http vigia ${escapar(url)}</code></p></div>
<p class="suave">Una señal no es una acusación. Sin DNI, personas naturales con un apellido tapado. <a href="${escapar(env.VIGIA_URL)}">vigia.gobserva.cloud</a></p>`;
  return new Response(pagina("El MCP de Vigía", cuerpo), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

/** Lo que no es /mcp ni lo que sirve la librería (/.well-known, /oauth/token, /oauth/register). */
export async function porDefecto(request: Request, env: EnvV2): Promise<Response> {
  const ruta = new URL(request.url).pathname;
  if (ruta === "/authorize") return autorizar(request, env);
  if (ruta === "/" && request.method === "GET") return inicio(env);
  if (ruta === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  return new Response("No encontrado", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

type Manejador = (request: Request, env: EnvV2, ctx: ExecutionContext) => Promise<Response>;

const proveedores = new Map<string, OAuthProvider<EnvV2>>();

/** Uno por origen (PROD mcp.gobserva.cloud, DEV vigia-mcp-dev…): el recurso tiene que ser la URL exacta. */
export function proveedorOAuth(env: EnvV2, conCuenta: Manejador): OAuthProvider<EnvV2> {
  let p = proveedores.get(env.MCP_URL);
  if (p) return p;
  p = new OAuthProvider<EnvV2>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (req, e, ctx) => conCuenta(req, e as EnvV2, ctx) } as ExportedHandler<EnvV2> & { fetch: NonNullable<ExportedHandler<EnvV2>["fetch"]> },
    defaultHandler: { fetch: (req, e) => porDefecto(req as unknown as Request, e as EnvV2) } as ExportedHandler<EnvV2>,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [...SCOPES, "offline_access"],
    requiredScopes: ["datos"],
    resourceMetadata: { resource: `${env.MCP_URL}/mcp`, authorization_servers: [env.MCP_URL], resource_name: "Vigía by Gobserva" },
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 90 * 86_400,
    refreshTokenIdleTTL: 30 * 86_400,
    async tokenExchangeCallback({ grantType, props, env: e }) {
      const actual = props as PropsCuenta | undefined;
      if (grantType !== "refresh_token" || !actual?.frt) return;
      try {
        const { idToken, frt } = await renovarIdToken(e as EnvV2, actual.frt);
        const nuevas: PropsCuenta = { ...actual, frt, planes: await planesDe(e as EnvV2, idToken), planesAl: Date.now() };
        return { newProps: nuevas, accessTokenProps: nuevas };
      } catch (err) {
        if (err instanceof ErrorSesion) throw new OAuthError("invalid_grant", { description: "La sesión de Gobserva ya no es válida: vuelve a conectar." });
        return; // un fallo pasajero de Firebase no corta el acceso: sigue con el plan que tenía
      }
    },
    onError({ code, description, status }) {
      console.warn(JSON.stringify({ mcp: "oauth", code, status, description: String(description).slice(0, 200) }));
    },
  });
  proveedores.set(env.MCP_URL, p);
  return p;
}
