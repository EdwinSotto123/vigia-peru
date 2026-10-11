import test from "node:test";
import assert from "node:assert/strict";
import { enmascararDni, limpiarPersonales, limpiarTexto } from "../src/lib/privacidad.js";

test("enmascara claves de documento en cualquier profundidad sin mutar la entrada", () => {
  const entrada = { ganador: { dni_persona_natural: "43960880" }, datos: { "JUAN PEREZ": { visitas: [{ dni: "71114275", motivo: "reunión" }], onpe: [{ numero_documento: 12345678 }] } } };
  const r = limpiarPersonales(entrada);
  assert.equal(r.ganador.dni_persona_natural, "43****80");
  assert.equal(r.datos["JUAN PEREZ"].visitas[0].dni, "71****75");
  assert.equal(r.datos["JUAN PEREZ"].onpe[0].numero_documento, "12****78");
  assert.equal(entrada.ganador.dni_persona_natural, "43960880");
  assert.equal(r.datos["JUAN PEREZ"].visitas[0].motivo, "reunión");
});

test("texto libre: DNI con etiqueta y correos", () => {
  assert.equal(limpiarTexto("El firmante (DNI 43960880) y el CE: 12345678"), "El firmante (DNI 43****80) y el CE: 12****78");
  assert.equal(limpiarTexto("escribir a maria.lopez@ejemplo.pe"), "escribir a m***@ejemplo.pe");
});

test("no toca RUC ni montos de 8 dígitos sin etiqueta", () => {
  assert.equal(limpiarTexto("RUC 20607558184 por S/ 12345678"), "RUC 20607558184 por S/ 12345678");
  assert.equal(enmascararDni("abc"), "****");
});
