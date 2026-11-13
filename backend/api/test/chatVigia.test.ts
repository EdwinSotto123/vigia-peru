import test from "node:test";
import assert from "node:assert/strict";
import {
  TOPE_CUENTA_DIA, TOPE_IP_DIA, TOPE_SIN_VERIFICAR_DIA, TOPE_TOTAL_DIA, enListaFija, eventoPublico, huellaIp, pedidoVigia, sistemaVigia, topeDiaCuenta,
} from "../src/lib/chatVigia.js";

// El asistente de Vigía para quien tiene cuenta (2026-11-12): con qué pregunta, qué no puede decir y qué sale al navegador.

test("pregunta con todas las herramientas del MCP, pocas vueltas y respuesta corta", () => {
  const p = pedidoVigia();
  assert.equal(p.ruta, "");
  assert.ok(p.vueltas <= 12);
  assert.ok(p.max <= 8000);
});

test("las instrucciones prohíben acusar, pedir DNI y completar apellidos", () => {
  const s = sistemaVigia();
  assert.match(s, /no una acusación/);
  assert.match(s, /Nunca pidas ni muestres un DNI/);
  assert.match(s, /apellido tapado/);
  assert.match(s, /No es una probabilidad/);
  assert.match(s, /Lo que no pude verificar/);
});

test("al navegador no salen el modelo interno, los tokens ni el costo", () => {
  assert.deepEqual(eventoPublico({ tipo: "inicio", modelo: "interno-x", informe: "abc" }), { tipo: "inicio" });
  assert.deepEqual(eventoPublico({ tipo: "fin", ms: 1200, herramientas: 3, tokens: { entrada: 1 }, costo_usd: 0.01 }), { tipo: "fin", ms: 1200, herramientas: 3 });
  assert.deepEqual(eventoPublico({ tipo: "respuesta", texto: "Ficha: A · Dictamen: B" }), { tipo: "respuesta", texto: "Ficha: A, Dictamen: B" });
  const paso = { tipo: "paso", id: "1", titulo: "Buscar" };
  assert.equal(eventoPublico(paso), paso);
});

test("los topes del día acotan el gasto", () => {
  assert.ok(TOPE_CUENTA_DIA <= 20);
  assert.ok(TOPE_TOTAL_DIA <= 1000);
});

// Abuso (2026-11-13): lista fija, huella de la IP y tope de la cuenta sin verificar.

test("la lista fija bloquea por IP, por /64, por huella y por cuenta, y nada más", () => {
  const lista = ["203.0.113.7, 2001:db8:1:2::/64", " uidMalo ; h:abcdef0123456789abcd"].join(String.fromCharCode(10));
  assert.equal(enListaFija(lista, "203.0.113.7", null, "otro"), true);
  assert.equal(enListaFija(lista, "2001:db8:1:2::/64", null, "otro"), true);
  assert.equal(enListaFija(lista, null, null, "UIDMALO"), true);
  assert.equal(enListaFija(lista, "198.51.100.1", "abcdef0123456789abcd", "otro"), true);
  assert.equal(enListaFija(lista, "198.51.100.1", "ffff", "otro"), false);
  assert.equal(enListaFija(undefined, "203.0.113.7", null, "uidMalo"), false);
  assert.equal(enListaFija("", "203.0.113.7", null, "uidMalo"), false);
});

test("la huella de la IP es fija, corta y no contiene la IP", () => {
  const h = huellaIp("203.0.113.7");
  assert.equal(h, huellaIp("203.0.113.7"));
  assert.notEqual(h, huellaIp("203.0.113.8"));
  assert.match(h, /^[0-9a-f]{20}$/);
  assert.ok(!h.includes("203"));
});

test("la cuenta sin correo verificado pregunta menos; la IP suma varias cuentas", () => {
  assert.equal(topeDiaCuenta(true), TOPE_CUENTA_DIA);
  assert.equal(topeDiaCuenta(false), TOPE_SIN_VERIFICAR_DIA);
  assert.equal(topeDiaCuenta(false, "maria@vigia.local"), TOPE_CUENTA_DIA);
  assert.equal(topeDiaCuenta(false, "maria@correo.pe"), TOPE_SIN_VERIFICAR_DIA);
  assert.ok(TOPE_SIN_VERIFICAR_DIA < TOPE_CUENTA_DIA);
  assert.ok(TOPE_IP_DIA > TOPE_CUENTA_DIA && TOPE_IP_DIA < TOPE_TOTAL_DIA);
});
