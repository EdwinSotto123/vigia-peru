/**
 * Credenciales de Google fuera de Google Cloud (réplica en Cloudflare Workers). Sólo servidor.
 *
 * En Cloud Run la identidad del frontend sale del servidor de metadatos (ID tokens para los
 * servicios de agentes) y de las credenciales por defecto (`@google-cloud/storage`). En Workers
 * no hay ninguno de los dos: se usa la llave JSON de la MISMA cuenta de servicio
 * (`vigia-frontend@…`), guardada como secreto `GCP_SA_KEY`, y se cambia un JWT firmado con
 * RS256 (WebCrypto) por un token en el endpoint OAuth de Google:
 *
 *  - `target_audience` → ID token para invocar un servicio Cloud Run IAM-only.
 *  - `scope` → access token para la API JSON de Cloud Storage.
 *
 * Los tokens duran 60 min; se guardan 50 por isolate, y un pedido en vuelo se comparte.
 */
import "server-only";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const TTL_MS = 50 * 60 * 1000;

interface LlaveCuenta {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let llave: { cuenta: LlaveCuenta; clave: Promise<CryptoKey> } | null = null;
const tokens = new Map<string, { token: string; expira: number }>();
const enVuelo = new Map<string, Promise<string>>();

function b64url(datos: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : new Uint8Array(datos);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** La llave de `GCP_SA_KEY` (JSON de la cuenta de servicio), importada una vez por isolate. */
function llaveCuenta(): { cuenta: LlaveCuenta; clave: Promise<CryptoKey> } {
  if (llave) return llave;
  const crudo = process.env.GCP_SA_KEY;
  if (!crudo) throw new Error("falta el secreto GCP_SA_KEY");
  const cuenta = JSON.parse(crudo) as LlaveCuenta;
  if (!cuenta.client_email || !cuenta.private_key) throw new Error("GCP_SA_KEY no es la llave JSON de una cuenta de servicio");
  const der = Uint8Array.from(
    atob(cuenta.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const clave = crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  llave = { cuenta, clave };
  return llave;
}

async function pedir(reclamo: { target_audience: string } | { scope: string }): Promise<string> {
  const { cuenta, clave } = llaveCuenta();
  const aud = cuenta.token_uri || TOKEN_URI;
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(
    JSON.stringify({ iss: cuenta.client_email, sub: cuenta.client_email, aud, iat: ahora, exp: ahora + 3600, ...reclamo }),
  );
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await clave, new TextEncoder().encode(`${cabecera}.${cuerpo}`));
  const r = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${cabecera}.${cuerpo}.${b64url(firma)}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => null)) as { id_token?: string; access_token?: string; error?: string } | null;
  const token = "target_audience" in reclamo ? j?.id_token : j?.access_token;
  if (!r.ok || !token) throw new Error(`OAuth de Google respondió ${r.status}${j?.error ? ` (${j.error})` : ""}`);
  return token;
}

async function token(clave: string, reclamo: { target_audience: string } | { scope: string }): Promise<string> {
  const hit = tokens.get(clave);
  if (hit && hit.expira > Date.now()) return hit.token;
  let p = enVuelo.get(clave);
  if (!p) {
    p = pedir(reclamo)
      .then((t) => {
        tokens.set(clave, { token: t, expira: Date.now() + TTL_MS });
        return t;
      })
      .finally(() => enVuelo.delete(clave));
    enVuelo.set(clave, p);
  }
  return p;
}

/** ID token de la cuenta de servicio con esa audiencia (el origen del servicio Cloud Run). */
export const idTokenDeCuenta = (audiencia: string) => token(`id:${audiencia}`, { target_audience: audiencia });

/** Access token de la cuenta de servicio para un scope OAuth. */
export const accessTokenDeCuenta = (scope: string) => token(`at:${scope}`, { scope });
