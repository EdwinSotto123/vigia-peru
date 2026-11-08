/**
 * El ID token de una cuenta de una app de Gobserva (AWS Cognito, 2026-11-07; infrastructure/aws/cognito_gobserva.py):
 * la firma con las llaves del grupo de usuarios (JWKS, guardadas una hora), el emisor del grupo, la audiencia del
 * cliente web, que sea un token de identidad (`token_use: id`) y que no haya vencido. El uid es su `sub`.
 */
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import type { TokenVerificado } from "./plataforma.js";
import type { GrupoCognito } from "./cuentasApps.js";

const llaves = new Map<string, { conjunto: ReturnType<typeof createLocalJWKSet>; kids: Set<string>; vence: number }>();

async function llavesDe(emisor: string, forzar = false) {
  const g = llaves.get(emisor);
  if (g && g.vence > Date.now() && !forzar) return g;
  const r = await fetch(`${emisor}/.well-known/jwks.json`);
  if (!r.ok) throw new Error(`llaves de Cognito: HTTP ${r.status}`);
  const jwks = (await r.json()) as JSONWebKeySet;
  const nuevo = {
    conjunto: createLocalJWKSet(jwks),
    kids: new Set(jwks.keys.map((k) => k.kid).filter((k): k is string => typeof k === "string")),
    vence: Date.now() + 3_600_000,
  };
  llaves.set(emisor, nuevo);
  return nuevo;
}

export async function verificarIdTokenCognito(token: string, g: GrupoCognito): Promise<TokenVerificado> {
  const cabecera = decodeProtectedHeader(token);
  const claims = decodeJwt(token);
  if (cabecera.alg !== "RS256" || typeof cabecera.kid !== "string") throw new Error("cabecera de Cognito inválida");
  if (claims.iss !== g.emisor) throw new Error('"iss" de otro grupo de usuarios');
  if (claims.aud !== g.cliente) throw new Error('"aud" de otro cliente');
  if (claims.token_use !== "id") throw new Error("no es un token de identidad");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new Error('"sub" inválido');
  let ll = await llavesDe(g.emisor);
  // Cognito rota llaves: un kid nuevo se busca una vez más antes de rechazar.
  if (!ll.kids.has(cabecera.kid)) ll = await llavesDe(g.emisor, true);
  if (!ll.kids.has(cabecera.kid)) throw new Error('el "kid" no es de este grupo de usuarios');
  const { payload } = await jwtVerify(token, ll.conjunto, { algorithms: ["RS256"], issuer: g.emisor, audience: g.cliente });
  return {
    ...payload,
    uid: payload.sub as string,
    email: typeof payload.email === "string" ? payload.email : undefined,
    // Cognito manda email_verified como booleano (o como texto en cuentas viejas).
    email_verified: payload.email_verified === true || payload.email_verified === "true",
    proyecto: `cognito:${g.app}`,
  } as TokenVerificado;
}
