/**
 * Verificación de Firebase ID tokens.
 *
 * El frontend manda en cada request:
 *   Authorization: Bearer <id-token>
 *
 * Acá lo validamos (lib/plataforma.ts): en Node con Firebase Admin SDK (node/plataforma.ts); en
 * Workers con jose contra las llaves públicas de securetoken y los mismos chequeos que el SDK
 * (workers/firebase.ts). Si pasa, exponemos `c.var.user` con `{ uid, userId }` (userId es el
 * displayName del que armaste en lib/auth.ts del frontend).
 */

import type { MiddlewareHandler } from "hono";
import { plataforma, type TokenVerificado } from "./plataforma.js";
import type { AppCuenta } from "./cuentasApps.js";

export interface AuthedUser {
  uid: string;
  userId: string | null;   // displayName del Firebase user (en Vigía = user-id)
  email: string | null;
  /** Firebase verificó que el correo es de quien inició sesión (claim email_verified). */
  emailVerificado: boolean;
  /** De dónde es la cuenta («cognito:empleo» o el proyecto de Firebase de Vigía) y su app de Gobserva (null: Vigía). */
  proyecto: string | null;
  app: AppCuenta | null;
}

function usuario(decoded: TokenVerificado): AuthedUser {
  const proyecto = typeof decoded.proyecto === "string" ? decoded.proyecto : null;
  return {
    uid: decoded.uid,
    userId: (decoded as { name?: string }).name ?? null,
    email: decoded.email ?? null,
    emailVerificado: (decoded as { email_verified?: unknown }).email_verified === true,
    proyecto,
    app: proyecto === "cognito:empleo" ? "empleo" : proyecto === "cognito:licitaciones" ? "licitaciones" : null,
  };
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
    const decoded = await plataforma().verificarIdToken(m[1]);
    c.set("user", usuario(decoded));
    await next();
  } catch {
    // Sin el mensaje de Firebase en la respuesta (auditoría M2): vencido, mal firmado o de otro proyecto dan lo mismo.
    return c.json({ error: "invalid_token" }, 401);
  }
};

/** Middleware: si hay token válido lo decodea, si no sigue como anónimo. */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const m = auth.match(/^Bearer (.+)$/i);
  if (m) {
    try {
      const decoded = await plataforma().verificarIdToken(m[1]);
      c.set("user", usuario(decoded));
    } catch {
      // sigue como anónimo
    }
  }
  await next();
};
