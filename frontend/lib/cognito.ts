/**
 * La cuenta de una app de Gobserva en el navegador (AWS Cognito, 2026-11-07; lib/apps-gobserva.ts). Habla directo con
 * Cognito (su API JSON, sin SDK: unos pocos KB): crear la cuenta, confirmarla con el código del correo, entrar,
 * renovar el token, olvidé mi contraseña, cambiarla, salir y borrar la cuenta. La sesión de cada app se guarda aparte
 * en el navegador (localStorage, por sitio): la de Empleo no sirve en Licitaciones.
 *
 * El token de identidad (1 hora) se renueva solo con el de refresco (30 días) cinco minutos antes de vencer. Si el de
 * refresco ya no sirve (venció, se salió en otro lado), la sesión se cierra.
 */
import { COGNITO, appDelSitio, leerToken, mensajeCognito, type AppCuenta } from "./apps-gobserva";

export class ErrorCognito extends Error {
  constructor(public tipo: string, mensaje?: string) {
    super(mensaje ?? mensajeCognito(tipo));
  }
}

interface Sesion {
  id: string;
  acceso: string;
  refresco: string;
}

/** Lo que la interfaz usa de quien entró (los mismos nombres que el usuario de Firebase de Vigía). */
export interface UsuarioApp {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  getIdToken: (forzar?: boolean) => Promise<string>;
}

/** La app del sitio en el que estás (null fuera de Empleo, Licitaciones u Obras). */
export function appActual(): AppCuenta | null {
  if (typeof window === "undefined") return null;
  return appDelSitio(window.location.hostname, window.location.pathname);
}

function app(): AppCuenta {
  const a = appActual();
  if (!a) throw new ErrorCognito("SinApp", "Esta página no es de una app de Gobserva.");
  return a;
}

const clave = (a: AppCuenta) => `gobserva:cuenta:${a}`;

async function cognito<T>(accion: string, cuerpo: Record<string, unknown>): Promise<T> {
  const { region } = COGNITO[app()];
  let r: Response;
  try {
    r = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${accion}` },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorCognito("red");
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorCognito(String(j.__type ?? "Error").split("#").pop() ?? "Error");
  return j as T;
}

// ─── La sesión guardada y quién escucha ─────────────────────────────────────────────────────────────────────────────

const oyentes = new Set<(u: UsuarioApp | null) => void>();

function leerSesion(): Sesion | null {
  try {
    const s = JSON.parse(window.localStorage.getItem(clave(app())) ?? "null") as Sesion | null;
    return s?.id && s.refresco ? s : null;
  } catch {
    return null;
  }
}

function guardarSesion(s: Sesion | null) {
  try {
    if (s) window.localStorage.setItem(clave(app()), JSON.stringify(s));
    else window.localStorage.removeItem(clave(app()));
  } catch {
    // Sin almacenamiento (modo privado estricto): la sesión dura lo que la pestaña.
  }
  memoria = s;
  avisar();
}

let memoria: Sesion | null | undefined;
const sesion = () => (memoria === undefined ? (memoria = leerSesion()) : memoria);

function usuarioDe(s: Sesion | null): UsuarioApp | null {
  const r = s ? leerToken(s.id) : null;
  if (!s || !r) return null;
  return { uid: r.sub, email: r.email, displayName: r.nombre, emailVerified: r.emailVerificado, getIdToken: (forzar) => tokenActual(forzar).then((t) => t ?? "") };
}

function avisar() {
  const u = usuarioDe(sesion());
  oyentes.forEach((o) => o(u));
}

/** Quien entró en esta app (null sin sesión). */
export const usuarioActual = (): UsuarioApp | null => usuarioDe(sesion());

/** Escucha los cambios de sesión (también los de otra pestaña). Devuelve cómo dejar de escuchar. */
export function escuchar(fn: (u: UsuarioApp | null) => void): () => void {
  oyentes.add(fn);
  fn(usuarioActual());
  const otraPestana = (e: StorageEvent) => {
    if (e.key === clave(app())) {
      memoria = leerSesion();
      fn(usuarioActual());
    }
  };
  window.addEventListener("storage", otraPestana);
  return () => {
    oyentes.delete(fn);
    window.removeEventListener("storage", otraPestana);
  };
}

interface Resultado {
  AuthenticationResult?: { IdToken: string; AccessToken: string; RefreshToken?: string };
  ChallengeName?: string;
}

let renovando: Promise<string | null> | null = null;

/** El token de identidad vigente (renovado si vence en menos de 5 minutos o si se pide). null sin sesión. */
export async function tokenActual(forzar = false): Promise<string | null> {
  const s = sesion();
  if (!s) return null;
  const vence = leerToken(s.id)?.vence ?? 0;
  if (!forzar && vence - Date.now() > 5 * 60_000) return s.id;
  renovando ??= (async () => {
    try {
      const r = await cognito<Resultado>("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO[app()].cliente,
        AuthParameters: { REFRESH_TOKEN: s.refresco },
      });
      const a = r.AuthenticationResult;
      if (!a) throw new ErrorCognito("NotAuthorizedException");
      guardarSesion({ id: a.IdToken, acceso: a.AccessToken, refresco: a.RefreshToken ?? s.refresco });
      return a.IdToken;
    } catch (e) {
      // El refresco ya no sirve: se cierra la sesión. Sin red, se sigue con el token de antes mientras dure.
      if (e instanceof ErrorCognito && e.tipo !== "red") guardarSesion(null);
      return e instanceof ErrorCognito && e.tipo === "red" && vence > Date.now() ? s.id : null;
    } finally {
      renovando = null;
    }
  })();
  return renovando;
}

// ─── Lo que hace la persona ─────────────────────────────────────────────────────────────────────────────────────────

const correo = (e: string) => e.trim().toLowerCase();

export async function entrar(email: string, contrasena: string): Promise<UsuarioApp> {
  const r = await cognito<Resultado>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO[app()].cliente,
    AuthParameters: { USERNAME: correo(email), PASSWORD: contrasena },
  });
  // Una cuenta creada por el equipo (pasada de antes) pide elegir contraseña: se hace con «¿La olvidaste?».
  if (!r.AuthenticationResult) throw new ErrorCognito(r.ChallengeName === "NEW_PASSWORD_REQUIRED" ? "PasswordResetRequiredException" : "NotAuthorizedException");
  const a = r.AuthenticationResult;
  guardarSesion({ id: a.IdToken, acceso: a.AccessToken, refresco: a.RefreshToken ?? "" });
  return usuarioActual()!;
}

/** Crea la cuenta: Cognito manda un código de 6 dígitos al correo, que se escribe en confirmar(). */
export async function crear(email: string, contrasena: string, nombre: string): Promise<void> {
  const atributos = [{ Name: "email", Value: correo(email) }];
  if (nombre.trim()) atributos.push({ Name: "name", Value: nombre.trim().slice(0, 80) });
  await cognito("SignUp", { ClientId: COGNITO[app()].cliente, Username: correo(email), Password: contrasena, UserAttributes: atributos });
}

/** Confirma el correo con el código y entra (con la contraseña que acaba de elegir). */
export async function confirmar(email: string, codigo: string, contrasena: string): Promise<UsuarioApp> {
  await cognito("ConfirmSignUp", { ClientId: COGNITO[app()].cliente, Username: correo(email), ConfirmationCode: codigo.trim() });
  return entrar(email, contrasena);
}

export const reenviarCodigo = (email: string) => cognito("ResendConfirmationCode", { ClientId: COGNITO[app()].cliente, Username: correo(email) });

/** Olvidé mi contraseña: manda un código al correo (si la cuenta existe; Cognito no lo dice). */
export const olvide = (email: string) => cognito("ForgotPassword", { ClientId: COGNITO[app()].cliente, Username: correo(email) });

/** La contraseña nueva con el código del correo, y entra con ella. */
export async function nuevaContrasena(email: string, codigo: string, contrasena: string): Promise<UsuarioApp> {
  await cognito("ConfirmForgotPassword", { ClientId: COGNITO[app()].cliente, Username: correo(email), ConfirmationCode: codigo.trim(), Password: contrasena });
  return entrar(email, contrasena);
}

/** Cambia la contraseña con la sesión abierta (pide la de ahora). */
export async function cambiarContrasena(actual: string, nueva: string): Promise<void> {
  await tokenActual();
  const s = sesion();
  if (!s) throw new ErrorCognito("NotAuthorizedException", "Tu sesión terminó. Vuelve a entrar.");
  await cognito("ChangePassword", { AccessToken: s.acceso, PreviousPassword: actual, ProposedPassword: nueva });
}

/** Sale de esta app (y anula el token de refresco). */
export async function salir(): Promise<void> {
  const s = sesion();
  guardarSesion(null);
  if (s?.refresco) await cognito("RevokeToken", { Token: s.refresco, ClientId: COGNITO[app()].cliente }).catch(() => undefined);
}

/** Borra la cuenta de esta app en Cognito (los datos de la cuenta se borran antes, en la API). */
export async function borrarUsuario(): Promise<void> {
  await tokenActual();
  const s = sesion();
  if (s) await cognito("DeleteUser", { AccessToken: s.acceso }).catch(() => undefined);
  guardarSesion(null);
}
