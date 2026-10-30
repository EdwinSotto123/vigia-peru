import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { pagosRouter } from "../src/routes/pagos.js";

const SECRETO = "secreto-webhook-de-prueba";
const app = new Hono().route("/", pagosRouter);

/** Un aviso de Mercado Pago firmado como lo firma su panel (`idFirmado` null = sin id en el manifiesto). */
function aviso(query: string, cuerpo: unknown, idFirmado: string | null) {
  const ts = "1730300000";
  const rid = "pedido-1";
  const v1 = createHmac("sha256", SECRETO).update(`${idFirmado ? `id:${idFirmado};` : ""}request-id:${rid};ts:${ts};`).digest("hex");
  return app.request(`/mercadopago/webhook${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid },
    body: JSON.stringify(cuerpo),
  });
}

test("webhook: sin firma 401; un id que no viene firmado en la URL o que no coincide con el del cuerpo, 400", async () => {
  const antes = process.env.MP_WEBHOOK_SECRET;
  process.env.MP_WEBHOOK_SECRET = SECRETO;
  try {
    const sinFirma = await app.request("/mercadopago/webhook?data.id=1&type=payment", { method: "POST", body: "{}" });
    assert.equal(sinFirma.status, 401);
    assert.equal((await aviso("?type=payment", { type: "payment", data: { id: "123" } }, null)).status, 400);
    assert.equal((await aviso("?data.id=123&type=payment", { type: "payment", data: { id: "999" } }, "123")).status, 400);
    const sinTipo = await aviso("?data.id=123", { data: { id: "123" } }, "123");
    assert.equal(sinTipo.status, 200);
    assert.deepEqual(await sinTipo.json(), { ok: true, ignorado: true });
  } finally {
    if (antes === undefined) delete process.env.MP_WEBHOOK_SECRET;
    else process.env.MP_WEBHOOK_SECRET = antes;
  }
});

test("cancelar el aporte mensual: un código válido y el correo o la sesión, antes de tocar la base", async () => {
  const pedir = (codigo: string, cuerpo: unknown) =>
    app.request(`/suscripcion/${codigo}/cancelar`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.40" },
      body: JSON.stringify(cuerpo),
    });
  assert.equal((await pedir("NO-ES-UN-CODIGO", { email: "a@b.pe" })).status, 400);
  const sinPrueba = await pedir("VIG-2026-00001", {});
  assert.equal(sinPrueba.status, 403);
  assert.equal(((await sinPrueba.json()) as { error: string }).error, "titularidad_requerida");
});

test("tarjeta: 3 intentos cada 10 minutos por IP; el cuarto, 429 con un mensaje que no dice nada de la tarjeta", async () => {
  const antes = { token: process.env.MP_ACCESS_TOKEN, clave: process.env.MP_PUBLIC_KEY };
  delete process.env.MP_ACCESS_TOKEN;   // sin Mercado Pago configurado, cada intento que pasa los topes da 503
  delete process.env.MP_PUBLIC_KEY;
  try {
    const pedir = () =>
      app.request("/aporte", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" }, body: "{}" });
    for (let i = 0; i < 3; i++) assert.equal((await pedir()).status, 503);
    const cuarto = await pedir();
    assert.equal(cuarto.status, 429);
    assert.equal(cuarto.headers.get("Retry-After"), "600");
    assert.equal(((await cuarto.json()) as { error: string }).error, "demasiados_intentos");
  } finally {
    if (antes.token !== undefined) process.env.MP_ACCESS_TOKEN = antes.token;
    if (antes.clave !== undefined) process.env.MP_PUBLIC_KEY = antes.clave;
  }
});
