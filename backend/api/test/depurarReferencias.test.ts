import { test } from "node:test";
import assert from "node:assert/strict";
import { depurarReferencias } from "../src/lib/laboratorioPrecios.js";

test("fuera la referencia 10 veces más cara que otra bien respaldada en la misma unidad", () => {
  const refs = [
    { fuente: "procesos", unidad: "unidad", n: 389, mediana: 4.2 },
    { fuente: "compras_menores", unidad: "unidad", n: 3, mediana: 622.69 },
    { fuente: "perucompras", unidad: null, n: 12, mediana: 4.9 },
  ];
  assert.deepEqual(depurarReferencias(refs).map((r) => r.fuente), ["procesos", "perucompras"]);
});

test("en otra unidad, o con poco respaldo, se queda", () => {
  const refs = [
    { fuente: "procesos", unidad: "galon", n: 9, mediana: 45 },
    { fuente: "compras_menores", unidad: "unidad", n: 3, mediana: 483 },
  ];
  assert.equal(depurarReferencias(refs).length, 2);
});
