/**
 * Protección contra bots (src/lib/antibots.ts): ventana por IP, Turnstile con un siteverify simulado
 * y las respuestas 403/429 de los middlewares, sin red.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { exigirCaptcha, limitarEnMemoria, limiteEscritura, verificarTurnstile } from "../src/lib/antibots.js";

const siteverify = (success: boolean, codigos: string[] = []) =>
  (async () => new Response(JSON.stringify({ success, "error-codes": codigos }))) as unknown as typeof fetch;

test("limitarEnMemoria: 10 por ventana y por clave; la ventana se desliza", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i++) assert.equal(limitarEnMemoria("ip-a|POST|/x", 10, 60_000, t0 + i), true);
  assert.equal(limitarEnMemoria("ip-a|POST|/x", 10, 60_000, t0 + 11), false);
  assert.equal(limitarEnMemoria("ip-b|POST|/x", 10, 60_000, t0 + 12), true);   // otra IP, otra cuenta
  assert.equal(limitarEnMemoria("ip-a|POST|/x", 10, 60_000, t0 + 60_010), true); // pasó la ventana
});

test("verificarTurnstile: sin secreto no exige; con secreto exige un token que siteverify acepte", async () => {
  assert.equal(await verificarTurnstile(undefined, "1.2.3.4", ""), "sin_secreto");
  assert.equal(await verificarTurnstile(undefined, "1.2.3.4", "s"), "captcha_requerido");
  assert.equal(await verificarTurnstile("tok", "1.2.3.4", "s", siteverify(true)), "ok");
  assert.equal(await verificarTurnstile("tok", "1.2.3.4", "s", siteverify(false, ["timeout-or-duplicate"])), "captcha_invalido");
  const caido = (async () => { throw new Error("sin red"); }) as unknown as typeof fetch;
  assert.equal(await verificarTurnstile("tok", "1.2.3.4", "s", caido), "captcha_invalido");
});

test("middlewares: 403 sin captcha y 429 al pasar el límite, con Retry-After", async () => {
  const antes = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "secreto-de-prueba";
  try {
    const app = new Hono();
    app.post("/reportes", limiteEscritura, exigirCaptcha, (c) => c.json({ ok: true }));
    const pedir = () => app.request("/reportes", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
    const r = await pedir();
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "captcha_requerido" });
    for (let i = 0; i < 9; i++) await pedir();                 // 10 en total dentro de la ventana
    const tope = await pedir();
    assert.equal(tope.status, 429);
    assert.equal(tope.headers.get("Retry-After"), "60");
    assert.equal(((await tope.json()) as { error: string }).error, "demasiados_pedidos");
  } finally {
    if (antes === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = antes;
  }
});
