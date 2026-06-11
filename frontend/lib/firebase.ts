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
 * IMPORTANTE: en la consola de Firebase del proyecto hay que **habilitar
 * "Email/Password"** como sign-in method. Sin eso, los createUser fallan
 * con `auth/operation-not-allowed`.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

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
export const auth: Auth = getAuth(app);

export { app };
