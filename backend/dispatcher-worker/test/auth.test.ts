// Port de backend/dispatcher/tests/test_auth.py: ID token para los servicios de agentes IAM-only
// (acá desde GCP_SA_KEY en vez del servidor de metadatos) y qué pasa cuando Cloud Run rechaza la
// invocación. Más la llave de los endpoints manuales (DISPATCHER_TOKEN). Sin red: fetch es falso.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { audienciaDe, cabeceras, reiniciarCache } from "../src/google.ts";
import { abrir } from "../src/stream.ts";
import type { Contexto } from "../src/stream.ts";
import { ABORT } from "../src/sql.ts";
import { autorizado } from "../src/auth.ts";

beforeEach(() => reiniciarCache());

function b64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function cuentaDePrueba(): Promise<{ llave: string; publica: CryptoKey }> {
  const par = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", par.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { llave: JSON.stringify({ client_email: "disp@proyecto.iam.gserviceaccount.com", private_key: pem }), publica: par.publicKey };
}

test("audiencia es el origen del servicio", () => {
  assert.equal(audienciaDe("https://agente-obras-x-uc.a.run.app/?stream=1"), "https://agente-obras-x-uc.a.run.app");
});

test("token de la cuenta de servicio con caché por audiencia", async () => {
  const { llave, publica } = await cuentaDePrueba();
  const pedidos: { url: string; claims: Record<string, unknown>; firmaOk: boolean; grant: string | null }[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    const [h, c, f] = form.get("assertion")!.split(".");
    const firmaOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publica, b64url(f), new TextEncoder().encode(`${h}.${c}`));
    pedidos.push({ url, claims: JSON.parse(new TextDecoder().decode(b64url(c))), firmaOk, grant: form.get("grant_type") });
    return Response.json({ id_token: "tok-1" });
  }) as typeof fetch;
  const h = await cabeceras({ GCP_SA_KEY: llave }, "https://bienes.run.app/?stream=1", buscar);
  assert.deepEqual(h, { Authorization: "Bearer tok-1" });
  assert.equal(pedidos[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(pedidos[0].grant, "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(pedidos[0].claims.target_audience, "https://bienes.run.app");
  assert.equal(pedidos[0].claims.iss, "disp@proyecto.iam.gserviceaccount.com");
  assert.equal(pedidos[0].claims.aud, "https://oauth2.googleapis.com/token");
  assert.ok(pedidos[0].firmaOk, "la firma RS256 verifica con la llave pública");
  await cabeceras({ GCP_SA_KEY: llave }, "https://bienes.run.app", buscar); // misma audiencia → caché
  assert.equal(pedidos.length, 1);
  await cabeceras({ GCP_SA_KEY: llave }, "https://obras.run.app", buscar); // otra audiencia → otro canje
  assert.equal(pedidos.length, 2);
});

test("sin GCP_SA_KEY no manda cabecera y no reintenta", async () => {
  let n = 0;
  const buscar = (async () => { n++; return Response.json({}); }) as typeof fetch;
  assert.deepEqual(await cabeceras({}, "https://bienes.run.app", buscar), {});
  assert.deepEqual(await cabeceras({}, "https://obras.run.app", buscar), {});
  assert.equal(n, 0);
});

test("un canje fallido se reintenta en el próximo contrato", async () => {
  const { llave } = await cuentaDePrueba();
  let n = 0;
  const buscar = (async () => { n++; return Response.json({ error: "invalid_grant" }, { status: 400 }); }) as typeof fetch;
  assert.deepEqual(await cabeceras({ GCP_SA_KEY: llave }, "https://bienes.run.app", buscar), {});
  assert.deepEqual(await cabeceras({ GCP_SA_KEY: llave }, "https://bienes.run.app", buscar), {});
  assert.equal(n, 2);
});

test("AGENT_ID_TOKEN manual", async () => {
  const buscar = (async () => assert.fail("no debe pedir token")) as typeof fetch;
  assert.deepEqual(await cabeceras({ AGENT_ID_TOKEN: " manual " }, "https://bienes.run.app", buscar), { Authorization: "Bearer manual" });
});

for (const status of [401, 403]) {
  test(`invocación rechazada (${status}) re-encola sin consumir intento`, async () => {
    const enviado: { url?: string; headers?: Record<string, string> } = {};
    const buscar = (async (url: string, init?: RequestInit) => {
      enviado.url = url;
      enviado.headers = init?.headers as Record<string, string>;
      return new Response("denegado", { status, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const ctx: Contexto = {
      db: { query: async () => [] }, ocid: "1225030", worker: "cloudflare-prueba", clave: "i/c1", dueno: {},
      cfg: { streamTimeoutS: 1200, maxEventos: 400, prefetchOcds: false, oeceBase: "https://x", tramoS: 60 },
      env: { AGENT_ID_TOKEN: "t" }, buscar,
    };
    const cp = await abrir(ctx, { url: "https://bienes.run.app", perfil: "bienes", tipo: null, clas: null, docs: { "a.pdf": "gs://b/a.pdf" } });
    assert.equal(enviado.url, "https://bienes.run.app?stream=1");
    assert.equal(enviado.headers!.Authorization, "Bearer t");
    assert.equal(cp.etapa, "cerrar");
    assert.equal(cp.resultado, ABORT);
    assert.ok(cp.err!.includes(`HTTP ${status}`));
  });
}

test("endpoints manuales: Bearer DISPATCHER_TOKEN en tiempo constante", async () => {
  const pedido = (auth?: string) => new Request("https://d/ejecutar", { method: "POST", headers: auth ? { Authorization: auth } : {} });
  assert.equal(await autorizado(pedido("Bearer secreto"), "secreto"), true);
  assert.equal(await autorizado(pedido("bearer secreto"), "secreto"), true);
  assert.equal(await autorizado(pedido("Bearer otro"), "secreto"), false);
  assert.equal(await autorizado(pedido("Bearer secretoX"), "secreto"), false);
  assert.equal(await autorizado(pedido(), "secreto"), false);
  // sin secreto configurado no se atiende a nadie
  assert.equal(await autorizado(pedido("Bearer "), ""), false);
  assert.equal(await autorizado(pedido("Bearer x"), undefined), false);
});
