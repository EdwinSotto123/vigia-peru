// OAuth 2.1 del MCP v2 con @cloudflare/workers-oauth-provider: el mismo Worker es el servidor de autorización y el
// recurso (/mcp). Lo que pide Claude (claude.com/docs/connectors/building/authentication):
//   · metadatos del recurso (RFC 9728) y del servidor (RFC 8414), que la librería sirve en /.well-known/…;
//   · Client ID Metadata Document (Claude lo usa si se anuncia `client_id_metadata_document_supported` y `none`) y, de
//     respaldo, registro dinámico en /oauth/register; PKCE S256; refresh token que rota; `invalid_grant` al revocar.
// La identidad es la cuenta de Gobserva donde está el plan (2026-11-08: el MCP es de los planes de pago): la de Empleo o
// la de Licitaciones (AWS Cognito, cognito.ts) y, para las de antes, la de Vigía (Firebase). /authorize muestra a quién
// se le da acceso, la persona entra en esta misma página y, si su cuenta tiene un plan vigente, al permitir se guarda
// (cifrado) su uid, su app, su token de refresco y sus planes. Cada refresh del token del MCP relee el plan; si la
// sesión ya no vale, se revoca.
import OAuthProvider, { AuthorizationError, CimdFetchError, OAuthError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { idTokenDe, planesDe } from "./acceso";
import { leerCognito, NOMBRE_APP, verificarIdTokenCognito, type AppCuenta } from "./cognito";
import type { EnvV2, PropsCuenta } from "./entorno";
import { ErrorSesion, renovarIdToken, verificarIdToken } from "./firebase";

export const SCOPES = ["datos", "seguimiento"];

const QUE_PERMITE: Record<string, string> = {
  datos: "Usar las herramientas del MCP (plazas, licitaciones, obras, contratos, empresas y entidades) con el cupo de tu plan.",
  seguimiento: "Seguir y dejar de seguir entidades, empresas, partidos y regiones, y ver lo nuevo de lo que sigues.",
};

const PLANES: Record<AppCuenta, string> = {
  empleo: "https://empleo.gobserva.cloud/planes",
  licitaciones: "https://licitaciones.gobserva.cloud/planes",
};

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
.apps{display:grid;gap:.5rem;margin:.75rem 0}.apps label{display:flex;gap:.6rem;align-items:center;margin:0;padding:.6rem .75rem;border:1px solid var(--borde);border-radius:.5rem;cursor:pointer;font-size:1rem}
.apps label:has(input:checked){border-color:var(--acento);outline:1px solid var(--acento)}details{margin-top:1rem}summary{cursor:pointer;color:var(--suave);font-size:.9rem}
</style></head><body><main><div class="marca">gobserva_</div>${cuerpo}</main>${extra}</body></html>`;
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
  const grupos = Object.fromEntries(leerCognito(env.COGNITO_GOBSERVA).map((g) => [g.app, { region: g.region, cliente: g.cliente }]));
  const config = JSON.stringify({
    firebase: { apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, appId: env.FIREBASE_APP_ID },
    cognito: grupos,
  }).replace(/</g, "\\u003c");
  const cuerpo = `
<h1>Conecta tu IA con Gobserva</h1>
<p>${quien} pide acceso a Gobserva con tu cuenta. El acceso irá a <strong>${escapar(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="alerta"><strong>El acceso va a una aplicación de tu computadora.</strong> Sigue solo si acabas de pedir conectar desde ahí (por ejemplo Claude Code).</p>' : ""}
<div class="caja" id="entrar">
  <p style="margin-top:0"><strong>1. Entra con la cuenta donde tienes tu plan</strong></p>
  <p class="suave" style="margin:.25rem 0 0">El MCP viene con los planes de pago de Gobserva.</p>
  <div class="apps" role="radiogroup" aria-label="Tu cuenta">
    <label><input type="radio" name="app" value="licitaciones" checked> Gobserva Licitaciones (y Obras)</label>
    <label><input type="radio" name="app" value="empleo"> Gobserva Empleo</label>
  </div>
  <form id="correo">
    <label for="email">Correo</label><input id="email" type="email" autocomplete="email" required>
    <label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" required minlength="6">
    <button type="submit" id="botonCorreo" class="principal">Entrar</button>
  </form>
  <p class="suave">¿Todavía no tienes plan? Adquiérelo en <a href="${PLANES.licitaciones}" target="_blank" rel="noopener">Licitaciones</a> o en <a href="${PLANES.empleo}" target="_blank" rel="noopener">Empleo</a> y vuelve a conectar.</p>
  <details><summary>Entrar con una cuenta de Vigía</summary>
    <p class="suave">Solo sirve si esa cuenta tiene un plan.</p>
    <button type="button" id="google">Entrar con Google</button>
    <form id="correoVigia">
      <label for="emailV">Correo</label><input id="emailV" type="email" autocomplete="email" required>
      <label for="claveV">Contraseña</label><input id="claveV" type="password" autocomplete="current-password" required minlength="6">
      <button type="submit" id="botonVigia">Entrar con la cuenta de Vigía</button>
    </form>
  </details>
  <p class="alerta" id="error" role="alert" hidden></p>
</div>
<form method="post" class="caja" id="permitir" hidden>
  <p style="margin-top:0"><strong>2. Permite el acceso</strong></p>
  <p>Entraste como <strong id="quien"></strong>. Tu IA podrá:</p>
  <ul>${permisos}</ul>
  <p class="suave">Solo lee datos públicos y lo que sigues. No ve tus conversaciones. Puedes quitar el acceso desconectando el conector.</p>
  <input type="hidden" name="handle" value="${escapar(handle)}">
  <input type="hidden" name="app" id="appElegida"><input type="hidden" name="id_token" id="idToken"><input type="hidden" name="refresh_token" id="refreshToken">
  <div class="fila"><button type="submit" name="decision" value="deny">Cancelar</button><button type="submit" name="decision" value="approve" class="principal">Permitir</button></div>
</form>
<p class="suave">Gobserva: datos públicos del Estado peruano para quien busca trabajo, le vende al Estado o lo vigila. <a href="https://gobserva.cloud" target="_blank" rel="noopener">gobserva.cloud</a></p>`;
  const script = `<script type="module">
const CONFIG = ${config};
const $ = (id) => document.getElementById(id);
const MENSAJES = { NotAuthorizedException: "El correo o la contraseña no coinciden.", UserNotFoundException: "El correo o la contraseña no coinciden.",
  UserNotConfirmedException: "Primero confirma tu correo: entra una vez en la web de Gobserva.",
  PasswordResetRequiredException: "Elige tu contraseña en la web de Gobserva («¿La olvidaste?») y vuelve.",
  TooManyRequestsException: "Demasiados intentos. Espera un momento.", LimitExceededException: "Demasiados intentos. Espera un momento.",
  "auth/invalid-credential": "El correo o la contraseña no coinciden.", "auth/wrong-password": "El correo o la contraseña no coinciden.",
  "auth/user-not-found": "El correo o la contraseña no coinciden.", "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.", "auth/unauthorized-domain": "Este dominio todavía no está habilitado para entrar con Google." };
function error(codigo) { const el = $("error"); el.textContent = MENSAJES[codigo] || "No se pudo entrar. Intenta de nuevo."; el.hidden = false; }
function listo(app, idToken, refresco, quien) {
  $("appElegida").value = app; $("idToken").value = idToken; $("refreshToken").value = refresco; $("quien").textContent = quien;
  $("entrar").hidden = true; $("permitir").hidden = false;
}
$("correo").addEventListener("submit", async (ev) => {
  ev.preventDefault(); $("error").hidden = true; $("botonCorreo").disabled = true;
  try {
    const app = document.querySelector('input[name="app"]:checked').value, g = CONFIG.cognito[app];
    const email = $("email").value.trim().toLowerCase();
    const r = await fetch("https://cognito-idp." + g.region + ".amazonaws.com/", { method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
      body: JSON.stringify({ AuthFlow: "USER_PASSWORD_AUTH", ClientId: g.cliente, AuthParameters: { USERNAME: email, PASSWORD: $("clave").value } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return error(String(j.__type || "").split("#").pop());
    if (!j.AuthenticationResult) return error(j.ChallengeName === "NEW_PASSWORD_REQUIRED" ? "PasswordResetRequiredException" : "NotAuthorizedException");
    listo(app, j.AuthenticationResult.IdToken, j.AuthenticationResult.RefreshToken, email + " (" + (app === "empleo" ? "Gobserva Empleo" : "Gobserva Licitaciones") + ")");
  } catch (e) { error(""); } finally { $("botonCorreo").disabled = false; }
});
let fb = null;
async function firebase() {
  if (fb) return fb;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js");
  const m = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js");
  fb = { m, a: m.getAuth(initializeApp(CONFIG.firebase)) };
  fb.a.languageCode = "es";
  return fb;
}
async function listoVigia(user) { listo("", await user.getIdToken(true), user.refreshToken, (user.email || "tu cuenta") + " (Vigía)"); }
$("google").addEventListener("click", async () => {
  try {
    const { m, a } = await firebase(); const p = new m.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    await listoVigia((await m.signInWithPopup(a, p)).user);
  } catch (e) { error(e?.code); }
});
$("correoVigia").addEventListener("submit", async (ev) => {
  ev.preventDefault(); $("error").hidden = true; $("botonVigia").disabled = true;
  try { const { m, a } = await firebase(); await listoVigia((await m.signInWithEmailAndPassword(a, $("emailV").value.trim(), $("claveV").value)).user); }
  catch (e) { error(e?.code); } finally { $("botonVigia").disabled = false; }
});
</script>`;
  return pagina("Conectar Gobserva", cuerpo, script);
}

/** La cuenta no tiene plan: no se conecta (el MCP es de los planes de pago) y se dice dónde se adquiere. */
function paginaSinPlan(app: AppCuenta | null): Response {
  const donde = app
    ? `<p>Tu cuenta de ${escapar(NOMBRE_APP[app])} no tiene un plan vigente. <a href="${PLANES[app]}">Adquiere uno aquí</a> y vuelve a conectar desde tu asistente.</p>`
    : `<p>Esa cuenta de Vigía no tiene un plan. Adquiere uno en <a href="${PLANES.licitaciones}">Gobserva Licitaciones</a> o en <a href="${PLANES.empleo}">Gobserva Empleo</a> y conecta con esa cuenta.</p>`;
  return new Response(
    pagina("Falta un plan", `<h1>El MCP viene con los planes de pago</h1>${donde}<p class="suave">Si ya lo adquiriste, espera a que se active y vuelve a intentar.</p>`),
    { status: 402, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
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
    const refresco = String(form.get("refresh_token") ?? "");
    const pedida = String(form.get("app") ?? "");
    const grupo = leerCognito(env.COGNITO_GOBSERVA).find((g) => g.app === pedida) ?? null;
    if (pedida && !grupo) return paginaError("Esa cuenta no es de una app de Gobserva.");
    let uid: string;
    let nombre: string | undefined;
    try {
      if (grupo) uid = (await verificarIdTokenCognito(idToken, grupo)).uid;
      else ({ uid, nombre } = await verificarIdToken(idToken, env.FIREBASE_PROJECT_ID));
    } catch {
      return paginaError("No pudimos verificar tu sesión de Gobserva.");
    }
    const { planes, mcp } = await planesDe(env, idToken);
    if (!planes.length) return paginaSinPlan(grupo?.app ?? null);
    const elegidos = form.getAll("scope").map(String).filter((s) => SCOPES.includes(s));
    const aprobado = await oauth.approveConsent(request, handle, { scope: elegidos.length ? elegidos : ["datos"] });
    const props: PropsCuenta = grupo
      ? { uid, app: grupo.app, crt: refresco || undefined, planes, mcp: mcp ?? undefined, planesAl: Date.now() }
      : { uid, nombre, frt: refresco || undefined, planes, mcp: mcp ?? undefined, planesAl: Date.now() };
    const { redirectTo } = await oauth.completeAuthorization({
      request: aprobado.request,
      userId: uid,
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
  const cuerpo = `<h1>El MCP de Gobserva</h1>
<p>Conecta Claude, ChatGPT o Cursor con los datos públicos del Estado peruano: plazas CAS, licitaciones, obras, contratos, empresas, entidades y presupuesto.</p>
<div class="caja"><p style="margin-top:0"><strong>Viene con los planes de pago</strong></p>
<p>Adquiere un plan en <a href="${PLANES.empleo}">Gobserva Empleo</a> o en <a href="${PLANES.licitaciones}">Gobserva Licitaciones</a> y conecta tu IA con esa cuenta.</p></div>
<div class="caja"><p style="margin-top:0"><strong>En claude.ai</strong></p><ol>
<li>Abre <strong>Customize &gt; Connectors</strong> y elige <strong>Add custom connector</strong>.</li>
<li>Pega <code>${escapar(url)}</code> y pulsa <strong>Connect</strong>: entras con tu cuenta de Gobserva.</li>
<li>En un chat, abre <strong>+ &gt; Connectors</strong> y enciende Gobserva.</li></ol></div>
<div class="caja"><p style="margin-top:0"><strong>En Claude Code</strong></p><p><code>claude mcp add --transport http gobserva ${escapar(url)}</code></p></div>
<p class="suave">Una señal no es una acusación. Sin DNI, personas naturales con un apellido tapado. <a href="https://gobserva.cloud">gobserva.cloud</a></p>`;
  return new Response(pagina("El MCP de Gobserva", cuerpo), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
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
    resourceMetadata: { resource: `${env.MCP_URL}/mcp`, authorization_servers: [env.MCP_URL], resource_name: "Gobserva" },
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 90 * 86_400,
    refreshTokenIdleTTL: 30 * 86_400,
    async tokenExchangeCallback({ grantType, props, env: e }) {
      const actual = props as PropsCuenta | undefined;
      if (grantType !== "refresh_token" || !actual || (!actual.frt && !actual.crt)) return;
      try {
        let nuevas: PropsCuenta;
        if (actual.app) {
          // Cognito no rota el token de refresco: queda el mismo.
          const c = await planesDe(e as EnvV2, await idTokenDe(e as EnvV2, actual));
          nuevas = { ...actual, planes: c.planes, mcp: c.mcp ?? undefined, planesAl: Date.now() };
        } else {
          const { idToken, frt } = await renovarIdToken(e as EnvV2, actual.frt!);
          const c = await planesDe(e as EnvV2, idToken);
          nuevas = { ...actual, frt, planes: c.planes, mcp: c.mcp ?? undefined, planesAl: Date.now() };
        }
        return { newProps: nuevas, accessTokenProps: nuevas };
      } catch (err) {
        if (err instanceof ErrorSesion) throw new OAuthError("invalid_grant", { description: "La sesión de Gobserva ya no es válida: vuelve a conectar." });
        return; // un fallo pasajero no corta el acceso: sigue con el plan que tenía
      }
    },
    onError({ code, description, status }) {
      console.warn(JSON.stringify({ mcp: "oauth", code, status, description: String(description).slice(0, 200) }));
    },
  });
  proveedores.set(env.MCP_URL, p);
  return p;
}
