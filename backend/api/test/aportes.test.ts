import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { contribucionesRouter } from "../src/routes/contribuciones.js";
import { financiamientoRouter } from "../src/routes/financiamiento.js";

const app = new Hono().route("/contribuciones", contribucionesRouter).route("/financiamiento", financiamientoRouter);

test("la compra de lecturas por contrato está cerrada: 410 y la salida al fondo común, sin tocar la base", async () => {
  const r = await app.request("/contribuciones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entidadRuc: "20131370998", contratos: 3, financiador: { tipo: "persona", email: "a@b.pe" } }),
  });
  assert.equal(r.status, 410);
  const cuerpo = (await r.json()) as { error: string; detail: string };
  assert.equal(cuerpo.error, "lecturas_cerradas");
  assert.match(cuerpo.detail, /\/app\/apoyar/);
});

test("destino sugerido: sólo un RUC o un ubigeo, y nunca una persona (RUC 10), antes de tocar la base", async () => {
  assert.equal((await app.request("/financiamiento/motivo/Texto%20inventado")).status, 400);
  assert.equal((await app.request("/financiamiento/motivo/123")).status, 400);
  assert.equal((await app.request("/financiamiento/motivo/10123456789")).status, 404);
});
