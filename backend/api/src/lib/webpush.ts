/**
 * Notificaciones del navegador (Web Push) sin dependencias, con WebCrypto: corre en el Worker (2026-11-01).
 *
 * Una suscripción (la da el navegador al aceptar las notificaciones) trae el `endpoint` de su servicio de push (Google,
 * Mozilla, Apple o Microsoft) y dos llaves. El mensaje va cifrado para ese navegador (aes128gcm, RFC 8291) y firmado por
 * nosotros (VAPID, RFC 8292): el servicio sólo lo entrega, no lo puede leer.
 *
 * Variables del Worker: VAPID_PUBLIC_KEY (la misma que usa el navegador para suscribirse; es pública) y el secreto
 * VAPID_PRIVATE_KEY (el número privado de la llave P-256, en base64url). Sin ellas no se manda nada.
 */
const enc = new TextEncoder();

export const pushConfigurado = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/** Los servicios de push de los navegadores: sólo a ellos se manda (una suscripción no puede apuntar a otro lado). */
export const ENDPOINT_PUSH =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com)\//;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deB64url(s: string): Uint8Array {
  const base = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function unir(...partes: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal as BufferSource, info: info as BufferSource }, k, largo * 8));
}

/**
 * Cifra un mensaje para una suscripción (aes128gcm, RFC 8291): cabecera (sal, tamaño de registro, llave pública del
 * servidor) + un solo registro. `prueba` fija la sal y las llaves del servidor (para los vectores de la RFC).
 */
export async function cifrar(mensaje: Uint8Array, p256dh: string, auth: string, prueba?: { sal: Uint8Array; servidor: CryptoKeyPair }): Promise<Uint8Array> {
  const uaPublica = deB64url(p256dh);
  const secretoAuth = deB64url(auth);
  if (uaPublica.length !== 65 || secretoAuth.length !== 16) throw new Error("llaves de la suscripción inválidas");
  const servidor = prueba?.servidor ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublica = new Uint8Array((await crypto.subtle.exportKey("raw", servidor.publicKey)) as ArrayBuffer);
  const uaLlave = await crypto.subtle.importKey("raw", uaPublica as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaLlave }, servidor.privateKey, 256));
  const ikm = await hkdf(secretoAuth, ecdh, unir(enc.encode("WebPush: info\0"), uaPublica, asPublica), 32);
  const sal = prueba?.sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const llave = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // El 0x02 marca el último (y único) registro.
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, llave, unir(mensaje, new Uint8Array([2])) as BufferSource));
  const cabecera = new Uint8Array(21 + asPublica.length);
  cabecera.set(sal, 0);
  new DataView(cabecera.buffer).setUint32(16, 4096);
  cabecera[20] = asPublica.length;
  cabecera.set(asPublica, 21);
  return unir(cabecera, cifrado);
}

let llaveVapid: Promise<CryptoKey> | null = null;
function privadaVapid(): Promise<CryptoKey> {
  const pub = deB64url(process.env.VAPID_PUBLIC_KEY as string);
  const jwk = { kty: "EC", crv: "P-256", d: process.env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** El JWT de VAPID para el servicio de push del endpoint (vale 12 horas). */
export async function jwtVapid(endpoint: string): Promise<string> {
  const cabeza = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cuerpo = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:hello@gobserva.cloud" })));
  llaveVapid ??= privadaVapid();
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await llaveVapid, enc.encode(`${cabeza}.${cuerpo}`)));
  return `${cabeza}.${cuerpo}.${b64url(firma)}`;
}

/** Lo que muestra la notificación (lo lee el service worker de la web: public/gobserva-sw.js). */
export interface Notificacion {
  titulo: string;
  cuerpo: string;
  url: string;
  tag?: string;
}

export interface Suscripcion {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Manda una notificación. `vencida`: el navegador la dio de baja (404/410) y hay que borrarla. */
export async function enviarPush(s: Suscripcion, n: Notificacion, ttl = 86_400): Promise<{ resultado: "ok" | "vencida" | "error"; status: number }> {
  if (!ENDPOINT_PUSH.test(s.endpoint)) return { resultado: "vencida", status: 0 };
  const cuerpo = await cifrar(enc.encode(JSON.stringify(n)), s.p256dh, s.auth);
  const r = await fetch(s.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${await jwtVapid(s.endpoint)}, k=${process.env.VAPID_PUBLIC_KEY}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "normal",
    },
    body: cuerpo as BodyInit,
  });
  if (r.status === 404 || r.status === 410) return { resultado: "vencida", status: r.status };
  return { resultado: r.ok ? "ok" : "error", status: r.status };
}
