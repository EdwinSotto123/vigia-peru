/**
 * Verificación de ID tokens de Firebase en Workers (firebase-admin no corre acá), con jose y los
 * mismos chequeos que `verifyIdToken` de firebase-admin 13 (sin `checkRevoked`, igual que en Node):
 *
 *   · cabecera con `kid` y `alg` RS256;
 *   · `aud` = proyecto, `iss` = https://securetoken.google.com/<proyecto>, `sub` texto de 1 a 128;
 *   · firma con una llave pública de securetoken@system.gserviceaccount.com (el mismo juego que el
 *     SDK baja en X.509, acá en JWK), `exp` y `nbf` sin tolerancia.
 *
 * Devuelve el payload con `uid` = `sub`, como el SDK. Las llaves se guardan en el isolate lo que dice
 * su Cache-Control (una hora si no lo dice); un `kid` desconocido no fuerza otra descarga (tampoco
 * en el SDK). Cualquier fallo tira: lib/auth.ts responde 401 igual que en Node.
 */

import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import type { TokenVerificado } from "../lib/plataforma.js";

export const LLAVES_SECURETOKEN = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const EMISOR = "https://securetoken.google.com/";

let llaves: { conjunto: ReturnType<typeof createLocalJWKSet>; kids: Set<string>; vence: number } | null = null;

async function llavesVigentes(): Promise<NonNullable<typeof llaves>> {
  if (llaves && llaves.vence > Date.now()) return llaves;
  const r = await fetch(LLAVES_SECURETOKEN);
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

/** Vacía las llaves guardadas (pruebas). */
export function olvidarLlaves(): void {
  llaves = null;
}

export async function verificarIdTokenFirebase(token: string, proyecto: string): Promise<TokenVerificado> {
  const cabecera = decodeProtectedHeader(token); // tira si no es un JWT
  const claims = decodeJwt(token);
  if (typeof cabecera.kid === "undefined") throw new Error('el ID token no trae "kid"');
  if (cabecera.alg !== "RS256") throw new Error(`algoritmo incorrecto: se esperaba RS256 y vino ${String(cabecera.alg)}`);
  if (claims.aud !== proyecto) throw new Error(`"aud" incorrecto: se esperaba ${proyecto}`);
  if (claims.iss !== EMISOR + proyecto) throw new Error(`"iss" incorrecto: se esperaba ${EMISOR}${proyecto}`);
  if (typeof claims.sub !== "string" || claims.sub === "" || claims.sub.length > 128) throw new Error('"sub" ausente, vacío o de más de 128 caracteres');

  const { conjunto, kids } = await llavesVigentes();
  if (!kids.has(cabecera.kid)) throw new Error('el "kid" no corresponde a ninguna llave pública vigente');
  // Firma, `exp` y `nbf` (jose, sin tolerancia de reloj, como jsonwebtoken en el SDK).
  const { payload } = await jwtVerify(token, conjunto, { algorithms: ["RS256"] });
  return { ...payload, uid: payload.sub as string } as TokenVerificado;
}
