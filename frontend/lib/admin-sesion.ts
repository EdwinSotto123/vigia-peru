/**
 * Sesión del panel de administración. Sólo servidor.
 *
 * Se entra con una cuenta de Firebase (Google, o correo y contraseña con el
 * correo verificado). El servidor verifica el ID token contra las llaves
 * públicas de Google, averigua el PERFIL del correo (`rolDe`: los de
 * `ADMIN_EMAILS` son administradores principales; el resto del equipo está en
 * la tabla `equipo`, que se gestiona desde /admin/equipo) y recién ahí deja
 * una cookie httpOnly FIRMADA con ese correo. Qué puede cada perfil:
 * lib/permisos.ts. El token del API
 * (`ADMIN_TOKEN`) ya no viaja al navegador: lo agrega el servidor en cada
 * llamada, y el correo verificado va como autor a la bitácora.
 *
 * Antes la cookie guardaba el token del API tal cual y el autor era un nombre
 * escrito a mano; y dos rutas (subida de QR y "¿soy admin?") aceptaban
 * cualquier cookie con ese nombre, sin mirar su valor.
 *
 * Todo falla cerrado: sin `ADMIN_EMAILS`, sin llave de firma o sin
 * `ADMIN_TOKEN`, nadie entra.
 *
 * La llave que firma la cookie es SÓLO `ADMIN_SESSION_SECRET` (secreto
 * `admin-session-secret`, ≥ 32 caracteres). Antes caía en `ADMIN_TOKEN`, el
 * token que el login viejo le pedía a la gente: quien lo hubiera tenido podía
 * fabricarse una sesión de principal.
 */
import "server-only";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { API_BASE } from "./api-client";
import { esRol, type Rol } from "./permisos";

/**
 * `__session` es la ÚNICA cookie que Firebase Hosting deja pasar a Cloud Run: con el sitio detrás de
 * Hosting (CDN), cualquier otro nombre llega vacío y el panel no reconocería la sesión.
 */
export const COOKIE_ADMIN = "__session";
/** Nombre anterior: se sigue aceptando al leer para no cerrar las sesiones abiertas antes del cambio. */
export const COOKIE_ADMIN_LEGADO = "vigia_admin";

/** Valor de la cookie de sesión del panel, con el nombre nuevo o el anterior. */
export function cookieAdmin(req: { cookies: { get(nombre: string): { value: string } | undefined } }): string | undefined {
  return req.cookies.get(COOKIE_ADMIN)?.value || req.cookies.get(COOKIE_ADMIN_LEGADO)?.value;
}
const DURACION_S = 12 * 60 * 60;
const AUDIENCIA_SESION = "vigia-admin";

/** Llaves públicas con las que Firebase firma sus ID tokens (se cachean solas). */
const LLAVES_FIREBASE = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

function llaveSesion(): Uint8Array | null {
  const s = process.env.ADMIN_SESSION_SECRET;
  return s && s.length >= 32 ? new TextEncoder().encode(s) : null;
}

/** El token de servicio con el que el servidor habla con el API. Nunca sale del servidor. */
export const tokenApi = (): string | null => process.env.ADMIN_TOKEN || null;

/** Administradores principales (secreto `admin-emails`), separados por coma. No se pueden quitar desde el panel. */
export function correosAdmin(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export const esAdmin = (correo: string) => correosAdmin().includes(correo.trim().toLowerCase());

/** El acceso con cuenta está listo para usarse en este servidor. */
export const accesoConfigurado = () => correosAdmin().length > 0 && !!tokenApi() && !!llaveSesion();

export type Cuenta =
  | { ok: true; correo: string }
  | { ok: false; motivo: "token_invalido" | "sin_correo" | "correo_no_verificado" };

/**
 * Verifica un ID token de Firebase: firma de Google, emisor y audiencia del
 * proyecto, vigencia, y que el correo esté VERIFICADO. Sin esto último,
 * cualquiera podría registrar el correo del admin con una contraseña.
 */
export async function verificarCuentaFirebase(idToken: string): Promise<Cuenta> {
  const proyecto = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!proyecto) return { ok: false, motivo: "token_invalido" };
  try {
    const { payload } = await jwtVerify(idToken, LLAVES_FIREBASE, {
      issuer: `https://securetoken.google.com/${proyecto}`,
      audience: proyecto,
      algorithms: ["RS256"],
    });
    if (!payload.sub) return { ok: false, motivo: "token_invalido" };
    const correo = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!correo) return { ok: false, motivo: "sin_correo" };
    if (payload.email_verified !== true) return { ok: false, motivo: "correo_no_verificado" };
    return { ok: true, correo };
  } catch {
    return { ok: false, motivo: "token_invalido" };
  }
}

/**
 * El perfil de un correo: su rol, `null` si el equipo CONFIRMA que no es miembro, o
 * `"sin_verificar"` si no se pudo preguntar (API lenta o caída). Los principales son admin sin
 * preguntar; el resto se consulta a la tabla `equipo` (vía API) y se recuerda 60 s por instancia:
 * quitar a alguien le corta el acceso en menos de un minuto sin pagar un pedido por request.
 *
 * "No se pudo preguntar" no es "no es del equipo": antes una API fría (más de 4 s) sacaba del
 * panel a todos los revisores y les borraba la cookie. Con un error se usa el último perfil
 * conocido sólo si tiene menos de 5 min; después, ni entra ni se le borra la sesión.
 */
export type Perfil = Rol | null | "sin_verificar";

const perfiles = new Map<string, { rol: Rol | null; at: number }>();
const consultas = new Map<string, Promise<Perfil>>();
const VIGENCIA_PERFIL_MS = 60_000;
const TOLERANCIA_ERROR_MS = 5 * 60_000;

async function consultarPerfil(correo: string, token: string): Promise<Perfil> {
  try {
    const r = await fetch(`${API_BASE}/admin/equipo/rol/${encodeURIComponent(correo)}`, {
      headers: { "x-admin-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return "sin_verificar";
    const j = (await r.json().catch(() => null)) as { rol?: unknown } | null;
    if (!j) return "sin_verificar";
    const rol = esRol(j.rol) ? j.rol : null;
    perfiles.set(correo, { rol, at: Date.now() });
    return rol;
  } catch {
    return "sin_verificar";
  }
}

export async function perfilDe(correo: string, { fresco = false } = {}): Promise<Perfil> {
  const c = correo.trim().toLowerCase();
  if (esAdmin(c)) return "admin";
  const guardado = perfiles.get(c);
  if (!fresco && guardado && Date.now() - guardado.at < VIGENCIA_PERFIL_MS) return guardado.rol;
  const token = tokenApi();
  if (!token) return null;
  // Un solo pedido por correo a la vez: el resumen dispara tres en paralelo al abrir.
  let consulta = consultas.get(c);
  if (!consulta) {
    consulta = consultarPerfil(c, token).finally(() => consultas.delete(c));
    consultas.set(c, consulta);
  }
  const perfil = await consulta;
  if (perfil !== "sin_verificar") return perfil;
  return guardado && Date.now() - guardado.at < TOLERANCIA_ERROR_MS ? guardado.rol : "sin_verificar";
}

/** Tras cambiar a alguien en /admin/equipo: esta instancia lo vuelve a consultar ya. */
export const olvidarPerfil = (correo: string) => perfiles.delete(correo.trim().toLowerCase());

export async function firmarSesion(correo: string, rol: Rol): Promise<string | null> {
  const llave = llaveSesion();
  if (!llave) return null;
  return new SignJWT({ correo, rol })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(correo)
    .setAudience(AUDIENCIA_SESION)
    .setIssuedAt()
    .setExpirationTime(`${DURACION_S}s`)
    .sign(llave);
}

export interface Sesion { correo: string; rol: Rol; principal: boolean }

export type LecturaSesion =
  | { estado: "ok"; sesion: Sesion }
  /** Sin cookie, firma inválida, vencida o el equipo confirma que ya no es miembro: se borra la cookie. */
  | { estado: "invalida" }
  /** Firma válida pero no se pudo confirmar el perfil ahora: no entra, y la cookie se conserva. */
  | { estado: "sin_verificar" };

/**
 * La sesión de la cookie. El perfil NO sale de la cookie sino del equipo actual (`perfilDe`): si
 * un principal sale de `ADMIN_EMAILS` deja de entrar de inmediato, y un cambio de perfil o una
 * baja en /admin/equipo rige en menos de un minuto.
 */
export async function leerSesionDetalle(valor: string | null | undefined): Promise<LecturaSesion> {
  const llave = llaveSesion();
  if (!llave || !valor) return { estado: "invalida" };
  let correo: string | null = null;
  try {
    const { payload } = await jwtVerify(valor, llave, { algorithms: ["HS256"], audience: AUDIENCIA_SESION });
    correo = typeof payload.correo === "string" ? payload.correo : null;
  } catch {
    return { estado: "invalida" };
  }
  if (!correo) return { estado: "invalida" };
  const perfil = await perfilDe(correo);
  if (perfil === "sin_verificar") return { estado: "sin_verificar" };
  return perfil ? { estado: "ok", sesion: { correo, rol: perfil, principal: esAdmin(correo) } } : { estado: "invalida" };
}

/** La sesión si está confirmada; si no (inválida o sin verificar), null. Falla cerrado. */
export async function leerSesion(valor: string | null | undefined): Promise<Sesion | null> {
  const l = await leerSesionDetalle(valor);
  return l.estado === "ok" ? l.sesion : null;
}

export const opcionesCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: DURACION_S,
};
