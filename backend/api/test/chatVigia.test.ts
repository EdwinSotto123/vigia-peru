import test from "node:test";
import assert from "node:assert/strict";
import { TOPE_CUENTA_DIA, TOPE_TOTAL_DIA, eventoPublico, pedidoVigia, sistemaVigia } from "../src/lib/chatVigia.js";

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
