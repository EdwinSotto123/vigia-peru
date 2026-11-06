// La cuenta de Gobserva (Firebase Auth, proyecto simplia-project) en el MCP:
//  · verificarIdToken: los mismos chequeos que la API (backend/api/src/workers/firebase.ts, y firebase-admin).
//  · renovarIdToken: con el token de refresco que dio el inicio de sesión, un ID token nuevo (para escribir en la API
//    como esa persona y para releer su plan). Si Firebase dice que la sesión ya no sirve (cuenta borrada o
//    deshabilitada, clave cambiada), la autorización del MCP se revoca: ErrorSesion.
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import type { EnvV2 } from "./entorno";

const LLAVES = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const EMISOR = "https://securetoken.google.com/";

let llaves: { conjunto: ReturnType<typeof createLocalJWKSet>; kids: Set<string>; vence: number } | null = null;

async function llavesVigentes() {
  if (llaves && llaves.vence > Date.now()) return llaves;
  const r = await fetch(LLAVES);
  if (!r.ok) throw new Error(`llaves de securetoken: HTTP ${r.status}`);
  const jwks = (await r.json()) as JSONWebKeySet;
  const maxAge = /max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1];
  llaves = {
    conjunto: createLocalJWKSet(jwks),
    kids: new Set(jwks.keys.map((k) => k.kid).filter((k): k is string => typeof k === "string")),
    vence: Date.now() + (maxAge ? Number(maxAge) * 1000 : 3_600_000),
  };
  return llaves;
}

export interface CuentaFirebase {
  uid: string;
  nombre?: string;
  correoVerificado: boolean;
}

export async function verificarIdToken(token: string, proyecto: string): Promise<CuentaFirebase> {
  const cabecera = decodeProtectedHeader(token);
  const claims = decodeJwt(token);
  if (typeof cabecera.kid !== "string") throw new Error('el ID token no trae "kid"');
  if (cabecera.alg !== "RS256") throw new Error("algoritmo incorrecto");
  if (claims.aud !== proyecto) throw new Error('"aud" incorrecto');
  if (claims.iss !== EMISOR + proyecto) throw new Error('"iss" incorrecto');
  if (typeof claims.sub !== "string" || claims.sub === "" || claims.sub.length > 128) throw new Error('"sub" no válido');
  const { conjunto, kids } = await llavesVigentes();
  if (!kids.has(cabecera.kid)) throw new Error('"kid" desconocido');
  const { payload } = await jwtVerify(token, conjunto, { algorithms: ["RS256"] });
  return {
    uid: payload.sub as string,
    nombre: typeof payload.name === "string" ? payload.name.slice(0, 80) : undefined,
    correoVerificado: payload.email_verified === true,
  };
}

/** La sesión de Firebase ya no sirve: no se reintenta, la autorización del MCP se cae y Claude pide entrar de nuevo. */
export class ErrorSesion extends Error {}

const PERMANENTES = new Set(["TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN", "INVALID_GRANT_TYPE", "MISSING_REFRESH_TOKEN"]);

export async function renovarIdToken(env: EnvV2, frt: string): Promise<{ idToken: string; frt: string }> {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: frt }).toString(),
  });
  const d = (await r.json().catch(() => null)) as { id_token?: string; refresh_token?: string; error?: { message?: string } } | null;
  if (r.ok && d?.id_token) return { idToken: d.id_token, frt: d.refresh_token ?? frt };
  const codigo = (d?.error?.message ?? "").split(/[\s:]/)[0];
  if (r.status === 400 && PERMANENTES.has(codigo)) throw new ErrorSesion(codigo);
  throw new Error(`securetoken: HTTP ${r.status} ${codigo}`);
}
