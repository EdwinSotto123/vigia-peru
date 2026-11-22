import test from "node:test";
import assert from "node:assert/strict";
import { Guardado, refNormal } from "../src/routes/saludCuenta.js";

test("salud, lo guardado: el código de cada cosa como se guarda", () => {
  assert.equal(refNormal("establecimiento", "6207"), "00006207");
  assert.equal(refNormal("medico", "012345"), "12345");
  assert.equal(refNormal("medicamento", "53764"), "53764");
  assert.equal(Guardado.safeParse({ tipo: "medico", ref: "12345" }).success, true);
  assert.equal(Guardado.safeParse({ tipo: "persona", ref: "12345" }).success, false);
  assert.equal(Guardado.safeParse({ tipo: "medico", ref: "12a45" }).success, false);
});
