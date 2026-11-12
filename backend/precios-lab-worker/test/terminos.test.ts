import { test } from "node:test";
import assert from "node:assert/strict";
import { terminosTienda } from "../src/modelo.ts";

test("terminosTienda: lo preciso, lo general y la categoría, sin unidades de compra (2026-988-2)", () => {
  assert.deepEqual(
    terminosTienda({ busquedas: ["lentejas kilo", "lenteja calidad superior", "lentejas secas", "lentejas bolsa"], categoria: "lentejas" }, 3),
    ["lentejas", "lenteja calidad superior", "lentejas secas"],
  );
  assert.deepEqual(
    terminosTienda({ busquedas: ["arroz pilado corriente kg", "arroz corriente", "arroz pilado"], categoria: "arroz" }, 3),
    ["arroz pilado corriente", "arroz corriente", "arroz"],
  );
  assert.deepEqual(terminosTienda({ busquedas: ["cemento portland tipo I 42.5 kg", "cemento portland"], categoria: "cemento" }, 2), [
    "cemento portland tipo i 42.5",
    "cemento portland",
  ]);
  // Sin búsquedas útiles queda la categoría.
  assert.deepEqual(terminosTienda({ busquedas: ["x kg"], categoria: "papel bond" }, 3), ["papel bond"]);
});
