/**
 * Verificación de ID tokens de Firebase en Workers (src/workers/firebase.ts): mismos chequeos que
 * firebase-admin. Las llaves de securetoken se simulan con una llave RSA generada acá.
 */

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { exportJWK, SignJWT } from "jose";
import { generateKeyPairSync } from "node:crypto";
import { LLAVES_SECURETOKEN, olvidarLlaves, verificarIdTokenFirebase } from "../src/workers/firebase.js";
import { simularFetch } from "./ayuda.js";

const PROYECTO = "simplia-project";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otra = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const f = simularFetch(({ url }) => {
  if (url !== LLAVES_SECURETOKEN) return new Response("no", { status: 404 });
  return Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=19000, must-revalidate, no-transform" } });
});
after(() => f.restaurar());
beforeEach(() => olvidarLlaves());

const ahora = () => Math.floor(Date.now() / 1000);
function firmar(claims: Record<string, unknown>, cab: Record<string, unknown> = { alg: "RS256", kid: "k1" }, llave = privateKey) {
  return new SignJWT({ iss: `https://securetoken.google.com/${PROYECTO}`, aud: PROYECTO, sub: "uid-123", iat: ahora() - 10, exp: ahora() + 3600, ...claims })
    .setProtectedHeader(cab as { alg: string })
    .sign(llave);
}

test("token válido: uid = sub, name y email como el SDK", async () => {
  const t = await firmar({ name: "user-42", email: "a@b.pe", auth_time: ahora() - 20, firebase: { sign_in_provider: "password" } });
  const d = await verificarIdTokenFirebase(t, PROYECTO);
  assert.equal(d.uid, "uid-123");
  assert.equal(d.name, "user-42");
  assert.equal(d.email, "a@b.pe");
  assert.equal(d.sub, "uid-123");
});

test("las llaves se guardan lo que dice Cache-Control", async () => {
  const antes = f.pedidos.length;
  await verificarIdTokenFirebase(await firmar({}), PROYECTO);
  await verificarIdTokenFirebase(await firmar({}), PROYECTO);
  assert.equal(f.pedidos.length - antes, 1);
});

const rechazos: [string, () => Promise<string>][] = [
  ["otro proyecto (aud)", () => firmar({ aud: "otro-proyecto" })],
  ["aud en lista", () => firmar({ aud: [PROYECTO] })],
  ["otro emisor (iss)", () => firmar({ iss: "https://securetoken.google.com/otro" })],
  ["vencido", () => firmar({ iat: ahora() - 7200, exp: ahora() - 1 })],
  ["todavía no vale (nbf)", () => firmar({ nbf: ahora() + 600 })],
  ["sin sub", () => firmar({ sub: undefined })],
  ["sub vacío", () => firmar({ sub: "" })],
  ["sub de 129", () => firmar({ sub: "x".repeat(129) })],
  ["sin kid", () => firmar({}, { alg: "RS256" })],
  ["kid desconocido", () => firmar({}, { alg: "RS256", kid: "k9" })],
  ["firmado con otra llave", () => firmar({}, { alg: "RS256", kid: "k1" }, otra.privateKey)],
  ["HS256", () => new SignJWT({ iss: `https://securetoken.google.com/${PROYECTO}`, aud: PROYECTO, sub: "u", exp: ahora() + 60 }).setProtectedHeader({ alg: "HS256", kid: "k1" }).sign(new TextEncoder().encode("s".repeat(32)))],
  ["no es un JWT", async () => "abc.def"],
];

for (const [nombre, hacer] of rechazos) {
  test(`rechaza: ${nombre}`, async () => {
    await assert.rejects(verificarIdTokenFirebase(await hacer(), PROYECTO));
  });
}

test("llaves inalcanzables: rechaza (lib/auth.ts responde 401)", async () => {
  const g = simularFetch(() => new Response("caído", { status: 503 }));
  try {
    await assert.rejects(verificarIdTokenFirebase(await firmar({}), PROYECTO), /HTTP 503/);
  } finally {
    g.restaurar();
  }
});
