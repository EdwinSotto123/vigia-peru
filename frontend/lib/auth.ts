/**
 * Helpers de auth con user-id (no email).
 */

import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
  type UserCredential,
} from "firebase/auth";
import { auth } from "./firebase";

/** Dominio sintético — el usuario nunca lo ve, sirve para que Firebase imponga unicidad. */
const SYNTHETIC_DOMAIN = "vigia.local";

export function userIdToEmail(userId: string): string {
  return `${userId.trim().toLowerCase()}@${SYNTHETIC_DOMAIN}`;
}

export function emailToUserId(email: string | null | undefined): string | null {
  if (!email) return null;
  const idx = email.indexOf("@");
  if (idx < 0) return email;
  return email.slice(0, idx);
}

/**
 * A dónde volver después de entrar o crear la cuenta. `next` viene de la URL, así
 * que cualquiera puede armar un enlace /login?next=https://sitio-falso: sólo se
 * aceptan rutas internas. "//x" y "/\x" los navegadores los leen como otro
 * dominio, y un tab o salto de línea se descarta al parsear ("/<tab>/x" → "//x").
 */
export function destinoSeguro(next: string | null | undefined, porDefecto = "/app/mapa"): string {
  if (!next) return porDefecto;
  if (!next.startsWith("/") || next.startsWith("//")) return porDefecto;
  if (/[\\\u0000-\u001F\u007F]/.test(next)) return porDefecto;
  return next;
}

/** Reglas del nombre de usuario. */
export function validateUserId(userId: string): string | null {
  const v = userId.trim();
  if (v.length === 0) return "Ingresa tu nombre de usuario";
  if (v.length < 3) return "Mínimo 3 caracteres";
  if (v.length > 30) return "Máximo 30 caracteres";
  if (!/^[a-zA-Z0-9_]+$/.test(v)) return "Solo letras, números y _";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 6) return "Mínimo 6 caracteres";
  if (password.length > 128) return "Máximo 128 caracteres";
  return null;
}

/**
 * Errores de Firebase Auth → mensajes para personas. Ningún código interno ni
 * nombre de consola llega a la pantalla: esos van a la consola del navegador.
 */
function humanizeAuthError(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "Ese nombre de usuario ya existe. Prueba con otro.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "El nombre de usuario o la contraseña no coinciden.";
    case "auth/missing-password":
      return "Escribe tu contraseña.";
    case "auth/weak-password":
      return "Esa contraseña es muy fácil de adivinar. Usa una más larga.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
    case "auth/network-request-failed":
      return "Sin conexión. Revisa tu red.";
    case "auth/requires-recent-login":
      return "Por seguridad, vuelve a escribir tu contraseña.";
    case "auth/operation-not-allowed":
      return "Crear cuentas no está disponible en este momento. Inténtalo más tarde.";
    default:
      if (typeof console !== "undefined") console.warn("[vigia] error de auth:", code || "(sin código)");
      return "No pudimos completar la operación. Inténtalo de nuevo en unos minutos.";
  }
}

export async function signUpWithUserId(
  userId: string,
  password: string,
): Promise<User> {
  const idError = validateUserId(userId);
  if (idError) throw new Error(idError);
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);

  try {
    const cred: UserCredential = await createUserWithEmailAndPassword(
      auth,
      userIdToEmail(userId),
      password,
    );
    // Guardamos el userId original (con casing) en displayName
    await updateProfile(cred.user, { displayName: userId.trim() });
    return cred.user;
  } catch (e: any) {
    throw new Error(humanizeAuthError(e?.code ?? ""));
  }
}

export async function signInWithUserId(
  userId: string,
  password: string,
): Promise<User> {
  const idError = validateUserId(userId);
  if (idError) throw new Error(idError);

  try {
    const cred: UserCredential = await signInWithEmailAndPassword(
      auth,
      userIdToEmail(userId),
      password,
    );
    return cred.user;
  } catch (e: any) {
    throw new Error(humanizeAuthError(e?.code ?? ""));
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

/**
 * Pide la contraseña otra vez antes de una acción sensible (borrar la cuenta).
 * Firebase exige un inicio de sesión reciente para `deleteUser`: sin esto, una
 * sesión vieja borraba el perfil en el backend y después fallaba al borrar el
 * acceso, dejando un login vivo sin cuenta detrás. La única forma de entrar es
 * usuario y contraseña, así que la credencial es siempre de ese tipo.
 */
export async function reautenticar(password: string): Promise<void> {
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error("Tu sesión expiró. Vuelve a entrar.");
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  } catch (e: any) {
    const code: string = e?.code ?? "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/invalid-login-credentials") {
      throw new Error("La contraseña no coincide.");
    }
    throw new Error(humanizeAuthError(code));
  }
}
