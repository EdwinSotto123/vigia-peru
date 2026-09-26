/**
 * Firebase para Vigía Perú · demo.
 *
 * Estrategia para usar **user-id** en lugar de email:
 *   - Firebase Auth no soporta nativamente "username + password".
 *   - Truco: convertimos `userId` → `userid@vigia.local` antes de hablar con
 *     Firebase. El usuario nunca ve emails. La unicidad la garantiza Firebase
 *     Auth por el unique-email constraint.
 *   - El `displayName` guarda el userId original (con su casing).
 *
 * Carga diferida: NINGÚN componente del layout lo importa de forma estática. Lo piden
 * las páginas que lo usan (entrar, crear cuenta, configuración, panel) y `AuthProvider`
 * con `import()` cuando hay una sesión guardada (lib/sesion.ts). Así la portada y el
 * resto del sitio no bajan Firebase para quien nunca inició sesión.
 *
 * IMPORTANTE: en la consola de Firebase del proyecto hay que **habilitar
 * "Email/Password"** como sign-in method. Sin eso, los createUser fallan
 * con `auth/operation-not-allowed`.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, getAuth, indexedDBLocalPersistence, initializeAuth, type Auth } from "firebase/auth";
import { avisarFirebaseCargado } from "./sesion";

// Config desde variables de entorno NEXT_PUBLIC_* (ver .env.example).
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Singleton — Next puede llamar al módulo varias veces durante HMR
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
// Sin popupRedirectResolver: solo usamos email/contraseña, así Firebase no carga el iframe de
// authDomain ni gapi (~140 KB y ~70 ms de bloqueo en cada página, según Lighthouse móvil).
export const auth: Auth = typeof window === "undefined"
  ? getAuth(app)
  : (() => { try { return initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }); } catch { return getAuth(app); } })();

export { app };

// Este módulo sólo se evalúa cuando alguien lo necesita (entrar, crear cuenta, configuración,
// panel, o una sesión guardada): `AuthProvider` escucha el aviso para seguir el estado de la
// sesión desde ese momento, sin volver a cargar nada (lib/sesion.ts).
avisarFirebaseCargado();
