/**
 * Lo que la interfaz necesita saber de la sesión SIN cargar Firebase (auditoría A14).
 *
 * Firebase Auth pesa ~25 KB gz y antes se inicializaba en cada página, para cada
 * visitante, desde el layout raíz. La mayoría nunca inicia sesión. Ahora `AuthProvider`
 * sólo lo baja cuando hay motivo:
 *
 *  - la pista de este módulo dice que hay una sesión guardada (`PISTA = "1"`), o
 *  - la pista no existe todavía (visitante de antes de este cambio) y el navegador tiene
 *    la base de IndexedDB donde Firebase guarda la sesión, o
 *  - una página que sí usa Firebase (entrar, crear cuenta, configuración, panel) ya lo
 *    cargó: `lib/firebase.ts` avisa con `EVENTO_FIREBASE`.
 *
 * La pista la escribe `AuthProvider` cada vez que Firebase informa el estado real
 * ("1" con usuario, "0" sin usuario). Es sólo una pista: la verdad la tiene siempre
 * Firebase, y con la pista vieja lo peor que pasa es que se lo baje de más una vez.
 *
 * Este módulo no importa nada de Firebase, a propósito.
 */

const PISTA = "vigia:sesion";

/** Evento de `window` que dispara `lib/firebase.ts` al inicializarse en el navegador. */
export const EVENTO_FIREBASE = "vigia:firebase";

/** Base de IndexedDB donde Firebase Auth persiste la sesión (indexedDBLocalPersistence). */
const BASE_FIREBASE = "firebaseLocalStorageDb";

export type PistaSesion = "1" | "0" | null;

export function leerPista(): PistaSesion {
  try {
    const v = window.localStorage.getItem(PISTA);
    return v === "1" || v === "0" ? v : null;
  } catch {
    return null;
  }
}

export function guardarPista(conSesion: boolean): void {
  try {
    window.localStorage.setItem(PISTA, conSesion ? "1" : "0");
  } catch {
    /* modo privado o almacenamiento bloqueado: se vuelve a decidir en la próxima visita */
  }
}

/** ¿`lib/firebase.ts` ya se evaluó en esta pestaña? (lo marca al inicializarse). */
export function firebaseYaCargado(): boolean {
  return typeof window !== "undefined" && (window as Window & { __vigiaFirebase?: boolean }).__vigiaFirebase === true;
}

/** Lo llama `lib/firebase.ts` al inicializarse en el navegador. */
export function avisarFirebaseCargado(): void {
  if (typeof window === "undefined") return;
  (window as Window & { __vigiaFirebase?: boolean }).__vigiaFirebase = true;
  window.dispatchEvent(new Event(EVENTO_FIREBASE));
}

/**
 * Sin pista (visitante de antes de este cambio): ¿quedó una sesión de Firebase guardada?
 * `true` si existe la base de IndexedDB de Firebase; `false` si seguro no existe; `null`
 * si el navegador no deja saberlo (`indexedDB.databases` no existe en navegadores viejos).
 */
export async function haySesionGuardada(): Promise<boolean | null> {
  try {
    const idb: { databases?: () => Promise<{ name?: string }[]> } | undefined = window.indexedDB;
    if (!idb || typeof idb.databases !== "function") return null;
    const bases = await idb.databases();
    return bases.some((b) => b.name === BASE_FIREBASE);
  } catch {
    return null;
  }
}

/**
 * user-id a partir del email sintético (`userid@vigia.local` → `userid`). Vive acá, y no
 * en `lib/auth.ts`, porque aquel importa Firebase y `AuthProvider` lo necesita sin él.
 */
export function emailToUserId(email: string | null | undefined): string | null {
  if (!email) return null;
  const idx = email.indexOf("@");
  if (idx < 0) return email;
  return email.slice(0, idx);
}
