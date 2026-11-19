import test from "node:test";
import assert from "node:assert/strict";
import { lecturaOE } from "../src/lib/validacion.js";

// Cómo se lee observados / esperados con su intervalo: sólo «más» o «menos» si el intervalo deja fuera al 1.
test("la lectura de O/E", () => {
  assert.equal(lecturaOE(906, 1.175, 5.45), "mas_de_lo_esperado");      // recién fundada contra la Contraloría
  assert.equal(lecturaOE(3262, 0.12, 0.894), "menos_de_lo_esperado");   // único postor
  assert.equal(lecturaOE(919, 0.874, 2.341), "como_lo_esperado");       // denuncia de bases dirigidas contra el Tribunal
  assert.equal(lecturaOE(21, 0, 9.9), "pocos_casos");                   // el comité: todavía muy pocos
  assert.equal(lecturaOE(500, null, null), "como_lo_esperado");
});
