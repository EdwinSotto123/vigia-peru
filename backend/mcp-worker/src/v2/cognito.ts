// Las cuentas de las apps de Gobserva (AWS Cognito, un grupo por app: Empleo y Licitaciones, que trae Obras) en el MCP
// (2026-11-08: el MCP es de los planes de pago, y los planes se compran con esas cuentas, no con la de Vigía).
//  · leerCognito: los grupos de COGNITO_GOBSERVA, con el mismo formato que la API (backend/api/src/lib/cuentasApps.ts).
//  · verificarIdTokenCognito: firma (JWKS del grupo), emisor, audiencia (el cliente de la app) y token_use = id.
//  · renovarCognito: con el token de refresco del inicio de sesión, un ID token nuevo (para releer el plan y escribir en
//    la API como esa persona). Si Cognito dice que ya no sirve (cuenta borrada, sesión cerrada), ErrorSesion.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ErrorSesion } from "./firebase";

export type AppCuenta = "empleo" | "licitaciones";

export interface GrupoCognito {
  app: AppCuenta;
  pool: string;
  cliente: string;
  region: string;
  /** https://cognito-idp.<región>.amazonaws.com/<pool>: el `iss` de sus tokens. */
  emisor: string;
}

export const NOMBRE_APP: Record<AppCuenta, string> = { empleo: "Gobserva Empleo", licitaciones: "Gobserva Licitaciones" };

/** «empleo|us-east-2_X|cliente,licitaciones|us-east-2_Y|cliente». Lo que no se entiende se ignora. */
export function leerCognito(texto: string | undefined): GrupoCognito[] {
  const r: GrupoCognito[] = [];
  for (const parte of (texto ?? "").split(",")) {
    const [app, pool, cliente] = parte.split("|").map((x) => x.trim());
    const region = /^([a-z]{2}-[a-z]+-\d)_[A-Za-z0-9]+$/.exec(pool ?? "")?.[1];
    if ((app === "empleo" || app === "licitaciones") && region && /^[a-z0-9]{20,40}$/.test(cliente ?? "")) {
      r.push({ app, pool, cliente, region, emisor: `https://cognito-idp.${region}.amazonaws.com/${pool}` });
    }
  }
  return r;
}

const llaves = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface CuentaCognito {
  uid: string;
  correo?: string;
}

export async function verificarIdTokenCognito(token: string, g: GrupoCognito): Promise<CuentaCognito> {
  let jwks = llaves.get(g.emisor);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${g.emisor}/.well-known/jwks.json`));
    llaves.set(g.emisor, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"], issuer: g.emisor, audience: g.cliente });
  if (payload.token_use !== "id") throw new Error("no es un ID token");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw new Error('"sub" no válido');
  return { uid: payload.sub, correo: typeof payload.email === "string" ? payload.email : undefined };
}

/** Los errores de Cognito que no se arreglan reintentando: la autorización del MCP se cae y hay que volver a conectar. */
const PERMANENTES = new Set(["NotAuthorizedException", "UserNotFoundException", "UserNotConfirmedException", "PasswordResetRequiredException"]);

export async function renovarCognito(g: GrupoCognito, refresco: string): Promise<string> {
  const r = await fetch(`https://cognito-idp.${g.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({ AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: g.cliente, AuthParameters: { REFRESH_TOKEN: refresco } }),
  });
  const d = (await r.json().catch(() => null)) as { AuthenticationResult?: { IdToken?: string }; __type?: string } | null;
  if (r.ok && d?.AuthenticationResult?.IdToken) return d.AuthenticationResult.IdToken;
  const tipo = String(d?.__type ?? "").split("#").pop() ?? "";
  if (r.status === 400 && PERMANENTES.has(tipo)) throw new ErrorSesion(tipo);
  throw new Error(`cognito: HTTP ${r.status} ${tipo}`);
}
