/**
 * Credenciales de Google en un Worker: token OAuth2 a partir de la llave JSON de una cuenta de
 * servicio (JWT RS256 firmado con WebCrypto, grant jwt-bearer). Se guarda en memoria del isolate
 * hasta 5 min antes de vencer.
 */

type LlaveSA = { client_email: string; private_key: string; token_uri?: string };

let cache: { token: string; vence: number; email: string } | null = null;

const b64url = (b: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importarLlave(pem: string): Promise<CryptoKey> {
  const cuerpo = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cuerpo), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function tokenGoogle(llaveJson: string | undefined, scope = "https://www.googleapis.com/auth/devstorage.read_write"): Promise<string> {
  if (!llaveJson) throw new Error("falta el secreto GCP_SA_KEY");
  const sa = JSON.parse(llaveJson) as LlaveSA;
  const ahora = Math.floor(Date.now() / 1000);
  if (cache && cache.email === sa.client_email && cache.vence - 300 > ahora) return cache.token;
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const carga = b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat: ahora, exp: ahora + 3600 }));
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importarLlave(sa.private_key),
    new TextEncoder().encode(`${cabecera}.${carga}`));
  const r = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cabecera}.${carga}.${b64url(firma)}` }),
  });
  if (!r.ok) throw new Error(`token de Google: HTTP ${r.status}`);
  const d = (await r.json()) as { access_token: string; expires_in: number };
  cache = { token: d.access_token, vence: ahora + (d.expires_in || 3600), email: sa.client_email };
  return d.access_token;
}

/** Sube `datos` a gs://bucket/ruta con cache-control y metadatos, como el relay de Lima. */
export async function subirGcs(token: string, bucket: string, ruta: string, datos: ArrayBuffer, tipo: string,
                               metadatos: Record<string, string>): Promise<void> {
  const limite = `vigia-${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: ruta, contentType: tipo, cacheControl: "public, max-age=86400", metadata: metadatos });
  const antes = new TextEncoder().encode(
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`);
  const despues = new TextEncoder().encode(`\r\n--${limite}--\r\n`);
  const cuerpo = new Uint8Array(antes.length + datos.byteLength + despues.length);
  cuerpo.set(antes, 0);
  cuerpo.set(new Uint8Array(datos), antes.length);
  cuerpo.set(despues, antes.length + datos.byteLength);
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
  if (!r.ok) throw new Error(`gcs_upload_failed: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}
