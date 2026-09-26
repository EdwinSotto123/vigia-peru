/**
 * Credenciales de Google desde GCP_SA_KEY (src/workers/google.ts): el JWT se verifica con jose contra
 * la llave pública de la cuenta falsa; el canje en token_uri se simula.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { importSPKI, jwtVerify, decodeProtectedHeader } from "jose";
import { credencial, idTokenCuenta, jwtDeCuenta, SinCredencial, tokenAccesoCuenta } from "../src/workers/google.js";
import { cuentaFalsa, simularFetch } from "./ayuda.js";

const cuenta = cuentaFalsa();

test("sin GCP_SA_KEY: error claro y permanente, sin tocar la red", async () => {
  delete process.env.GCP_SA_KEY;
  const f = simularFetch(() => new Response("{}"));
  try {
    await assert.rejects(tokenAccesoCuenta(), (e: unknown) => e instanceof SinCredencial && (e as SinCredencial).permanente && /falta el secreto GCP_SA_KEY/.test((e as Error).message));
    await assert.rejects(idTokenCuenta("https://agente.run.app"), SinCredencial);
    assert.equal(f.pedidos.length, 0);
  } finally {
    f.restaurar();
  }
});

test("GCP_SA_KEY inválido: SinCredencial", () => {
  assert.throws(() => credencial("no es json"), SinCredencial);
  assert.throws(() => credencial(JSON.stringify({ client_email: "x" })), /client_email y private_key/);
});

test("private_key ilegible: SinCredencial al firmar", async () => {
  const cred = credencial(JSON.stringify({ client_email: "x@y", private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" }));
  await assert.rejects(cred.firmar("hola"), SinCredencial);
});

test("JWT RS256 firmado con WebCrypto verifica con jose", async () => {
  const cred = credencial(cuenta.json);
  const jwt = await jwtDeCuenta(cred, { iss: cuenta.email, aud: "https://oauth2.googleapis.com/token", iat: 1, exp: 4102444800, x: "ñandú" });
  assert.deepEqual(decodeProtectedHeader(jwt), { alg: "RS256", typ: "JWT" });
  const { payload } = await jwtVerify(jwt, await importSPKI(cuenta.pemPublico, "RS256"), { issuer: cuenta.email, audience: "https://oauth2.googleapis.com/token" });
  assert.equal(payload.x, "ñandú");
});

test("access token: canje JWT-bearer con scope cloud-platform y caché hasta 5 min antes de vencer", async () => {
  process.env.GCP_SA_KEY = cuenta.json;
  const f = simularFetch(() => Response.json({ access_token: "ya29.prueba", expires_in: 3599, token_type: "Bearer" }));
  try {
    assert.equal(await tokenAccesoCuenta(), "ya29.prueba");
    assert.equal(await tokenAccesoCuenta(), "ya29.prueba");
    assert.equal(f.pedidos.length, 1, "el segundo sale de la caché");
    const p = f.pedidos[0];
    assert.equal(p.url, "https://oauth2.googleapis.com/token");
    assert.equal(p.init?.method, "POST");
    const cuerpo = new URLSearchParams(String(p.init?.body));
    assert.equal(cuerpo.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const { payload } = await jwtVerify(cuerpo.get("assertion")!, await importSPKI(cuenta.pemPublico, "RS256"), { audience: "https://oauth2.googleapis.com/token" });
    assert.equal(payload.iss, cuenta.email);
    assert.equal(payload.scope, "https://www.googleapis.com/auth/cloud-platform");
    assert.equal((payload.exp as number) - (payload.iat as number), 3600);
  } finally {
    f.restaurar();
  }
});

test("ID token: target_audience = audiencia, sin caché propia", async () => {
  process.env.GCP_SA_KEY = cuenta.json;
  const f = simularFetch(() => Response.json({ id_token: "eyJ.prueba.id" }));
  try {
    assert.equal(await idTokenCuenta("https://agente-obras-xyz.a.run.app"), "eyJ.prueba.id");
    await idTokenCuenta("https://agente-obras-xyz.a.run.app");
    assert.equal(f.pedidos.length, 2);
    const assertion = new URLSearchParams(String(f.pedidos[0].init?.body)).get("assertion")!;
    const { payload } = await jwtVerify(assertion, await importSPKI(cuenta.pemPublico, "RS256"));
    assert.equal(payload.target_audience, "https://agente-obras-xyz.a.run.app");
    assert.equal(payload.sub, cuenta.email);
    assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  } finally {
    f.restaurar();
  }
});

test("token_uri con error: el mensaje de Google llega en el error (reintentable)", async () => {
  process.env.GCP_SA_KEY = cuenta.json;
  const f = simularFetch(() => Response.json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, { status: 400 }));
  try {
    await assert.rejects(idTokenCuenta("https://x.run.app"), (e: unknown) => !(e instanceof SinCredencial) && /400: Invalid JWT Signature/.test((e as Error).message));
  } finally {
    f.restaurar();
  }
});
