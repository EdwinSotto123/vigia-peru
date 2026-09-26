/**
 * Credenciales de Google en Workers, desde la llave JSON de una cuenta de servicio (secreto
 * GCP_SA_KEY). En Cloud Run lo mismo sale del servidor de metadatos (node/plataforma.ts).
 *
 *   · Access token OAuth2 (cloud-platform) para GCS y la API de Cloud Run: JWT-bearer (RFC 7523)
 *     firmado RS256 con WebCrypto y canjeado en `token_uri`. Se guarda hasta 5 min antes de vencer.
 *   · ID token con `target_audience` para invocar servicios Cloud Run IAM-only. La caché de ~50 min
 *     por audiencia es la de lib/cloudrun-auth.ts.
 *   · Firma RSA-SHA256 para las URLs firmadas v4 de GCS (workers/gcs.ts).
 *
 * Sólo WebCrypto + fetch: corre igual en Node (así lo prueban test/google.test.ts y test/gcs.test.ts).
 * En las cachés de módulo sólo quedan textos y la CryptoKey, nunca objetos de E/S de un pedido.
 */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
export const ALCANCE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const MARGEN_MS = 5 * 60 * 1000;
const VIDA_JWT_S = 3600;

/** Falta GCP_SA_KEY o no sirve: reintentar no lo arregla (lib/cloudrun-auth.ts no insiste). */
export class SinCredencial extends Error {
  readonly permanente = true;
}

export interface Credencial {
  email: string;
  tokenUri: string;
  /** Firma RSASSA-PKCS1-v1_5 SHA-256 de `texto` (UTF-8) con la llave privada de la cuenta. */
  firmar(texto: string): Promise<Uint8Array>;
}

let vigente: { json: string; credencial: Credencial } | null = null;

// ─── base64 ──────────────────────────────────────────────────────────────────
export function base64url(datos: Uint8Array | string): string {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkcs8DePem(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

// ─── Cuenta de servicio ──────────────────────────────────────────────────────
/** Credencial de GCP_SA_KEY (se vuelve a leer si el texto cambia). Tira `SinCredencial`. */
export function credencial(json: string | undefined = process.env.GCP_SA_KEY): Credencial {
  if (!json?.trim()) throw new SinCredencial("falta el secreto GCP_SA_KEY (llave JSON de una cuenta de servicio)");
  if (vigente?.json === json) return vigente.credencial;
  let c: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  try {
    c = JSON.parse(json);
  } catch {
    throw new SinCredencial("GCP_SA_KEY no es JSON válido");
  }
  if (typeof c.client_email !== "string" || typeof c.private_key !== "string") {
    throw new SinCredencial("GCP_SA_KEY no trae client_email y private_key");
  }
  const pem = c.private_key;
  let llave: CryptoKey | null = null;
  const cred: Credencial = {
    email: c.client_email,
    tokenUri: typeof c.token_uri === "string" && c.token_uri ? c.token_uri : TOKEN_URI,
    async firmar(texto) {
      if (!llave) {
        try {
          llave = await crypto.subtle.importKey("pkcs8", pkcs8DePem(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        } catch (e) {
          throw new SinCredencial(`GCP_SA_KEY: private_key ilegible (${(e as Error).message})`);
        }
      }
      return new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(texto)));
    },
  };
  vigente = { json, credencial: cred };
  return cred;
}

/** JWT RS256 firmado por la cuenta de servicio. */
export async function jwtDeCuenta(cred: Credencial, claims: Record<string, unknown>): Promise<string> {
  const base = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  return `${base}.${base64url(await cred.firmar(base))}`;
}

/** Canje JWT-bearer en `token_uri`; devuelve la respuesta JSON (access_token o id_token). */
async function canjear(cred: Credencial, claims: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const iat = Math.floor(Date.now() / 1000);
  const assertion = await jwtDeCuenta(cred, { iss: cred.email, aud: cred.tokenUri, iat, exp: iat + VIDA_JWT_S, ...claims });
  const r = await fetch(cred.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`token_uri respondió ${r.status}: ${String(j.error_description ?? j.error ?? "sin detalle")}`);
  return j;
}

const accesos = new Map<string, { token: string; vence: number }>();

/** Access token OAuth2 de la cuenta de servicio (cacheado hasta 5 min antes de vencer). */
export async function tokenAccesoCuenta(alcance = ALCANCE_CLOUD_PLATFORM): Promise<string> {
  const cred = credencial();
  const clave = `${cred.email} ${alcance}`;
  const hit = accesos.get(clave);
  if (hit && hit.vence > Date.now()) return hit.token;
  const j = await canjear(cred, { scope: alcance });
  if (typeof j.access_token !== "string" || !j.access_token) throw new Error("token_uri no devolvió access_token");
  const vida = typeof j.expires_in === "number" ? j.expires_in * 1000 : VIDA_JWT_S * 1000;
  accesos.set(clave, { token: j.access_token, vence: Date.now() + vida - MARGEN_MS });
  return j.access_token;
}

/** ID token de Google con audiencia `audiencia` (sin caché: la lleva lib/cloudrun-auth.ts). */
export async function idTokenCuenta(audiencia: string, signal?: AbortSignal): Promise<string> {
  const cred = credencial();
  const j = await canjear(cred, { sub: cred.email, target_audience: audiencia }, signal);
  if (typeof j.id_token !== "string" || !j.id_token) throw new Error("token_uri no devolvió id_token");
  return j.id_token;
}
