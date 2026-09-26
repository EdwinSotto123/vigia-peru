/**
 * ID tokens para invocar los servicios de agentes (Cloud Run IAM-only, roles/run.invoker): lo que en
 * el job hace backend/dispatcher/auth.py con el servidor de metadatos, acá con la cuenta de servicio
 * del secreto GCP_SA_KEY (JWT RS256 firmado con WebCrypto y canjeado con `target_audience` en
 * token_uri; el mismo mecanismo que backend/api/src/workers/google.ts).
 *
 *   · Audiencia = origen del servicio (sin path ni query), que es lo que valida Cloud Run.
 *   · Caché de 50 min por audiencia (el token dura 60), por isolate.
 *   · Sin token (falta GCP_SA_KEY o el canje falla) la llamada va sin Authorization y se avisa: el
 *     servicio responde 401/403 y el dispatcher re-encola sin consumir intento. Falta de GCP_SA_KEY
 *     es definitiva (no se reintenta en cada contrato); un canje fallido se reintenta la próxima vez.
 *   · AGENT_ID_TOKEN (solo desarrollo) manda sobre todo lo anterior, como en auth.py.
 */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const TTL_MS = 50 * 60 * 1000;
const PLAZO_MS = 5000;
const VIDA_JWT_S = 3600;

export type Buscar = typeof fetch;

const cache = new Map<string, { vence: number; token: string }>();
const estado = { sinCredencial: false, avisado: false };
let llave: { pem: string; clave: Promise<CryptoKey> } | null = null;

/** Solo pruebas. */
export function reiniciarCache(): void {
  cache.clear();
  estado.sinCredencial = false;
  estado.avisado = false;
}

export function audienciaDe(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function base64url(datos: Uint8Array | string): string {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function claveDe(pem: string): Promise<CryptoKey> {
  if (llave?.pem === pem) return llave.clave;
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const clave = crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  llave = { pem, clave };
  return clave;
}

class SinCredencial extends Error {}

/** ID token de Google con audiencia `audiencia`, firmado por la cuenta de GCP_SA_KEY. */
export async function idTokenCuenta(llaveJson: string | undefined, audiencia: string, buscar: Buscar = fetch): Promise<string> {
  if (!llaveJson?.trim()) throw new SinCredencial("falta el secreto GCP_SA_KEY");
  let sa: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  try {
    sa = JSON.parse(llaveJson);
  } catch {
    throw new SinCredencial("GCP_SA_KEY no es JSON válido");
  }
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new SinCredencial("GCP_SA_KEY no trae client_email y private_key");
  }
  const tokenUri = typeof sa.token_uri === "string" && sa.token_uri ? sa.token_uri : TOKEN_URI;
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, sub: sa.client_email, aud: tokenUri, iat, exp: iat + VIDA_JWT_S, target_audience: audiencia };
  const base = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  let clave: CryptoKey;
  try {
    clave = await claveDe(sa.private_key);
  } catch (e) {
    llave = null;
    throw new SinCredencial(`GCP_SA_KEY: private_key ilegible (${(e as Error).message})`);
  }
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, new TextEncoder().encode(base));
  const r = await buscar(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${base}.${base64url(new Uint8Array(firma))}` }).toString(),
    signal: AbortSignal.timeout(PLAZO_MS),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`token_uri respondió ${r.status}: ${String(j.error_description ?? j.error ?? "sin detalle")}`);
  if (typeof j.id_token !== "string" || !j.id_token) throw new Error("token_uri no devolvió id_token");
  return j.id_token;
}

export interface FuenteToken {
  GCP_SA_KEY?: string;
  AGENT_ID_TOKEN?: string;
}

/** ID token para invocar `url`, o null si no se pudo obtener. */
export async function idToken(env: FuenteToken, url: string, buscar: Buscar = fetch): Promise<string | null> {
  const manual = (env.AGENT_ID_TOKEN ?? "").trim();
  if (manual) return manual;
  const aud = audienciaDe(url);
  const hit = cache.get(aud);
  if (hit && hit.vence > Date.now()) return hit.token;
  if (estado.sinCredencial) return null;
  try {
    const token = await idTokenCuenta(env.GCP_SA_KEY, aud, buscar);
    cache.set(aud, { vence: Date.now() + TTL_MS, token });
    return token;
  } catch (e) {
    const definitivo = e instanceof SinCredencial;
    if (definitivo) estado.sinCredencial = true;
    if (!estado.avisado || !definitivo) {
      estado.avisado = true;
      console.warn(JSON.stringify({
        severity: "WARNING", logger: "dispatcher",
        message: `sin ID token para ${aud} (${String((e as Error).message).slice(0, 120)}): la llamada va sin Authorization`,
      }));
    }
    return null;
  }
}

/** `{Authorization: "Bearer <ID token>"}` para invocar `url`, o `{}` si no hay token. */
export async function cabeceras(env: FuenteToken, url: string, buscar: Buscar = fetch): Promise<Record<string, string>> {
  const token = await idToken(env, url, buscar);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
