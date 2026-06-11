/**
 * Helpers de auth con user-id (no email).
 */

import {
  createUserWithEmailAndPassword,
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

/** Reglas de validación de user-id para la demo. */
export function validateUserId(userId: string): string | null {
  const v = userId.trim();
  if (v.length === 0) return "Ingresa un user-id";
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

/** Mapeo de Firebase Auth errors a mensajes en español. */
function humanizeAuthError(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "Ese user-id ya está tomado";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "User-id o contraseña incorrectos";
    case "auth/weak-password":
      return "La contraseña es muy débil";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera unos minutos.";
    case "auth/network-request-failed":
      return "Sin conexión. Revisa tu red.";
    case "auth/operation-not-allowed":
      return "Email/Password no está habilitado en Firebase Console";
    default:
      return `Error de auth (${code})`;
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
