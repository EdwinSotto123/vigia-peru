/**
 * Entrar a una app de Gobserva (2026-11-07: cuentas separadas por app, en AWS Cognito; lib/cognito.ts). Cada app tiene
 * su propia cuenta: la de Empleo no entra a Licitaciones. El correo se confirma con un código de 6 dígitos y la
 * contraseña olvidada se cambia con otro código; los correos salen en castellano con el nombre de la app.
 *
 * Sólo lo usan las páginas de las apps (entrar, la cuenta y su menú): se carga con import() donde hace falta.
 */
import {
  ErrorCognito, borrarUsuario as borrarDeCognito, cambiarContrasena, confirmar, crear, entrar, nuevaContrasena, olvide, reenviarCodigo as reenviar,
  salir as salirDeCognito, tokenActual, usuarioActual, type UsuarioApp,
} from "./cognito";
import { COOKIE_SESION } from "./gobserva";

/** Quita ya la marca de sesión que lee el middleware: si no, la portada todavía mandaría a la cuenta al salir. */
function sinMarca() {
  try {
    document.cookie = `${COOKIE_SESION}=; Path=/; Max-Age=0; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // Sin cookies: no hay marca que quitar.
  }
}

export const entrarConCorreo = (email: string, clave: string): Promise<UsuarioApp> => entrar(email, clave);

/** Crea la cuenta: llega un código al correo, que se escribe en confirmarCuenta(). */
export const crearCuentaConCorreo = (email: string, clave: string, nombre: string): Promise<void> => crear(email, clave, nombre);

export const confirmarCuenta = (email: string, codigo: string, clave: string): Promise<UsuarioApp> => confirmar(email, codigo, clave);

export const reenviarCodigo = (email: string) => reenviar(email);

/** Olvidé mi contraseña: llega un código al correo, que se escribe en elegirClave() con la nueva. */
export const recuperarClave = (email: string) => olvide(email);

export const elegirClave = (email: string, codigo: string, nueva: string): Promise<UsuarioApp> => nuevaContrasena(email, codigo, nueva);

export const cambiarClave = (actual: string, nueva: string) => cambiarContrasena(actual, nueva);

export async function salir(): Promise<void> {
  sinMarca();
  await salirDeCognito();
}

export async function borrarUsuario(): Promise<void> {
  await borrarDeCognito();
  sinMarca();
}

/** En Cognito el correo ya se confirmó al crear la cuenta: no hay nada que reenviar. */
export async function reenviarVerificacion(_volver?: string): Promise<void> {}

/** Pide un token nuevo (con lo último de la cuenta) y devuelve quién entró. */
export async function refrescarUsuario(): Promise<UsuarioApp | null> {
  await tokenActual(true);
  return usuarioActual();
}

/** El error dicho para quien entra. */
export function mensajeAuth(e: unknown): string {
  return e instanceof ErrorCognito ? e.message : "No pudimos completar eso. Vuelve a intentarlo.";
}

/** El tipo de error de Cognito (para decidir qué mostrar: confirmar el correo, cambiar la contraseña…). */
export const tipoError = (e: unknown): string => (e instanceof ErrorCognito ? e.tipo : "");
