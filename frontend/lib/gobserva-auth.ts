/**
 * Entrar a Gobserva (2026-11-01): con el correo de verdad (contraseña) o con Google, en el mismo Firebase que Vigía. A
 * diferencia de Vigía (usuario y un correo sintético @vigia.local), aquí el correo es real: ahí llegan las alertas y los
 * recibos. Los correos de Firebase (verificar el correo, cambiar la contraseña) salen en castellano.
 *
 * Importa Firebase de forma estática: sólo lo usan la página de entrar y la de la cuenta (lib/firebase.ts avisa a
 * AuthProvider, que desde ahí sigue la sesión).
 */
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

const enCastellano = () => {
  auth.languageCode = "es";
};

/** A dónde vuelve el enlace del correo de Firebase (verificar o cambiar la contraseña). */
const volverA = (url: string) => ({ url, handleCodeInApp: false });

export async function entrarConCorreo(email: string, clave: string): Promise<User> {
  const r = await signInWithEmailAndPassword(auth, email.trim(), clave);
  return r.user;
}

/** Crea la cuenta, le pone el nombre y manda el correo para verificarla. */
export async function crearCuentaConCorreo(email: string, clave: string, nombre: string, volver: string): Promise<User> {
  const r = await createUserWithEmailAndPassword(auth, email.trim(), clave);
  if (nombre.trim()) await updateProfile(r.user, { displayName: nombre.trim().slice(0, 80) });
  enCastellano();
  await sendEmailVerification(r.user, volverA(volver)).catch(() => {});
  return r.user;
}

export async function entrarConGoogle(): Promise<User> {
  enCastellano();
  const proveedor = new GoogleAuthProvider();
  proveedor.setCustomParameters({ prompt: "select_account" });
  const r = await signInWithPopup(auth, proveedor);
  return r.user;
}

export async function recuperarClave(email: string, volver: string): Promise<void> {
  enCastellano();
  await sendPasswordResetEmail(auth, email.trim(), volverA(volver));
}

export async function reenviarVerificacion(volver: string): Promise<void> {
  if (!auth.currentUser) return;
  enCastellano();
  await sendEmailVerification(auth.currentUser, volverA(volver));
}

/** Vuelve a leer el usuario (tras verificar el correo en otra pestaña) y pide un token nuevo con ese dato. */
export async function refrescarUsuario(): Promise<User | null> {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

export const salir = () => signOut(auth);

/** El error de Firebase dicho para quien entra. */
export function mensajeAuth(e: unknown): string {
  const codigo = (e as { code?: string })?.code ?? "";
  const MENSAJES: Record<string, string> = {
    "auth/invalid-email": "Ese correo no es válido.",
    "auth/missing-email": "Escribe tu correo.",
    "auth/invalid-credential": "El correo o la contraseña no coinciden.",
    "auth/wrong-password": "El correo o la contraseña no coinciden.",
    "auth/user-not-found": "El correo o la contraseña no coinciden.",
    "auth/email-already-in-use": "Ya hay una cuenta con ese correo. Entra con tu contraseña o recupérala.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/too-many-requests": "Hubo muchos intentos. Espera unos minutos y vuelve a intentarlo.",
    "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
    "auth/cancelled-popup-request": "Cerraste la ventana de Google antes de terminar.",
    "auth/popup-blocked": "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes y vuelve a intentarlo.",
    "auth/account-exists-with-different-credential": "Ese correo ya entra de otra forma. Usa tu contraseña.",
    "auth/network-request-failed": "No hay conexión. Revisa tu internet y vuelve a intentarlo.",
    "auth/unauthorized-domain": "Este sitio todavía no está habilitado para entrar. Avísanos a hello@gobserva.cloud.",
  };
  return MENSAJES[codigo] ?? "No pudimos completar eso. Vuelve a intentarlo.";
}
