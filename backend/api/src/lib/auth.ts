/**
 * Verificación de Firebase ID tokens.
 *
 * El frontend manda en cada request:
 *   Authorization: Bearer <id-token>
 *
 * Acá lo validamos contra Firebase Admin SDK. Si pasa, exponemos `c.var.user`
 * con `{ uid, userId }` (userId es el displayName del que armaste en lib/auth.ts
 * del frontend).
 */

import type { Context, MiddlewareHandler } from "hono";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  initializeApp({
    credential: credsJson ? cert(JSON.parse(credsJson)) : applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? "simplia-project",
  });
}

export interface AuthedUser {
  uid: string;
  userId: string | null;   // displayName del Firebase user (en Vigía = user-id)
  email: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

/** Middleware: requiere token válido. 401 si falta o falla. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const m = auth.match(/^Bearer (.+)$/i);
  if (!m) return c.json({ error: "missing_token" }, 401);

  try {
    const decoded = await getAuth().verifyIdToken(m[1]);
    c.set("user", {
      uid: decoded.uid,
      userId: (decoded as any).name ?? null,
      email: decoded.email ?? null,
    });
    await next();
  } catch (e) {
    return c.json({ error: "invalid_token", detail: (e as Error).message }, 401);
  }
};

/** Middleware: si hay token válido lo decodea, si no sigue como anónimo. */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const m = auth.match(/^Bearer (.+)$/i);
  if (m) {
    try {
      const decoded = await getAuth().verifyIdToken(m[1]);
      c.set("user", {
        uid: decoded.uid,
        userId: (decoded as any).name ?? null,
        email: decoded.email ?? null,
      });
    } catch {
      // sigue como anónimo
    }
  }
  await next();
};
