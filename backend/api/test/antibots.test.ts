/**
 * Protección contra bots (src/lib/antibots.ts): ventana por IP, Turnstile con un siteverify simulado
 * y las respuestas 403/429 de los middlewares, sin red.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  claveIp, exigirCaptcha, LIMITE_BUSQUEDAS, LIMITE_LECTURAS, limitarEnMemoria, limiteEscritura, limiteLectura, verificarTurnstile,
} from "../src/lib/antibots.js";

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

test("claveIp: IPv4 entera, IPv6 por su /64", () => {
  assert.equal(claveIp("203.0.113.9"), "203.0.113.9");
  assert.equal(claveIp("2800:200:e840:1a2b:4c5d:6e7f:8a9b:1c2d"), "2800:200:e840:1a2b::/64");
  assert.equal(claveIp("2800:200:e840:1a2b::1"), "2800:200:e840:1a2b::/64");
  assert.equal(claveIp("2800:0200::1"), "2800:200:0:0::/64");
  assert.equal(claveIp("::ffff:198.51.100.7"), "198.51.100.7");
});

test("limiteLectura: 120 lecturas y 30 búsquedas por IP; lo de nuestros Workers no cuenta", async () => {
  const app = new Hono();
  app.use("*", limiteLectura);
  app.get("*", (c) => c.json({ ok: true }));
  const pedir = (ruta: string, headers: Record<string, string>) => app.request(ruta, { headers });

  // Dos direcciones del mismo /64 comparten la cuenta.
  for (let i = 0; i < LIMITE_LECTURAS; i++) {
    const r = await pedir(`/empresas/${i}`, { "x-forwarded-for": i % 2 ? "2001:db8:1:2::a" : "2001:db8:1:2::b" });
    assert.equal(r.status, 200);
  }
  const tope = await pedir("/empresas/x", { "x-forwarded-for": "2001:db8:1:2::c" });
  assert.equal(tope.status, 429);
  assert.equal(tope.headers.get("Retry-After"), "60");
  assert.equal((await pedir("/empresas/x", { "x-forwarded-for": "2001:db8:1:3::a" })).status, 200);   // otro /64

  // La web pide desde su servidor con la IP de salida de Cloudflare: su CF-Worker la deja pasar siempre.
  const web = { "cf-connecting-ip": "2a06:98c0:3600::103", "cf-worker": "gobserva.cloud" };
  for (let i = 0; i < LIMITE_LECTURAS + 5; i++) assert.equal((await pedir("/empresas/y", web)).status, 200);
  // Otro Worker cualquiera (otra zona) no.
  const ajeno = { "cf-connecting-ip": "2a06:98c0:3600::103", "cf-worker": "otra-cuenta.workers.dev" };
  let ajenoTope = 0;
  for (let i = 0; i < LIMITE_LECTURAS + 1; i++) if ((await pedir("/empresas/z", ajeno)).status === 429) ajenoTope++;
  assert.equal(ajenoTope, 1);

  // Las búsquedas de texto tienen su propia cuenta, más corta.
  let busquedas = 0;
  for (let i = 0; i < LIMITE_BUSQUEDAS + 1; i++) {
    if ((await pedir(`/empresas?q=constructora${i}`, { "x-forwarded-for": "198.51.100.20" })).status === 200) busquedas++;
  }
  assert.equal(busquedas, LIMITE_BUSQUEDAS);
  assert.equal((await pedir("/empresas/1", { "x-forwarded-for": "198.51.100.20" })).status, 200);   // leer sigue
});
