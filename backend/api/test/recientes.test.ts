import { test } from "node:test";
import assert from "node:assert/strict";
import { leerRecientes } from "../src/lib/recientes.js";

test("recientes: sin parámetros pide 20 desde el inicio, como siempre", () => {
  assert.deepEqual(leerRecientes({}), { limit: 20, offset: 0 });
});

test("recientes: acepta límite y desplazamiento, con tope de 100", () => {
  assert.deepEqual(leerRecientes({ limit: "25", offset: "50" }), { limit: 25, offset: 50 });
  assert.equal(leerRecientes({ limit: "101" }), null);
  assert.equal(leerRecientes({ limit: "0" }), null);
});

test("recientes: rechaza valores que no son números enteros no negativos", () => {
  assert.equal(leerRecientes({ offset: "-1" }), null);
  assert.equal(leerRecientes({ offset: "abc" }), null);
  assert.equal(leerRecientes({ limit: "2.5" }), null);
});

test("recientes: la búsqueda pide 2 a 80 caracteres y se recorta", () => {
  assert.deepEqual(leerRecientes({ q: "  Cusco " }), { limit: 20, offset: 0, q: "Cusco" });
  assert.equal(leerRecientes({ q: "a" }), null);
  assert.equal(leerRecientes({ q: "x".repeat(81) }), null);
});
