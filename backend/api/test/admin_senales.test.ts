import assert from "node:assert/strict";
import { test } from "node:test";
import { MINIMO_REVISADOS, wilsonInferior } from "../src/routes/admin_senales.ts";

test("wilsonInferior: sin casos no hay precisión", () => {
  assert.equal(wilsonInferior(0, 0), null);
});

test("wilsonInferior: con 40 casos y 36 aciertos, el mínimo creíble queda bajo el 90 % medido", () => {
  const p = wilsonInferior(36, 40)!;
  assert.ok(p > 0.75 && p < 0.9, `fue ${p}`);
});

test("wilsonInferior: con pocos casos, aunque todos acierten, el mínimo es bajo", () => {
  assert.ok(wilsonInferior(5, 5)! < 0.6);
  assert.ok(wilsonInferior(40, 40)! > 0.9);
});

test("la regla de la migración 329: 40 casos decididos para graduar", () => {
  assert.equal(MINIMO_REVISADOS, 40);
});
