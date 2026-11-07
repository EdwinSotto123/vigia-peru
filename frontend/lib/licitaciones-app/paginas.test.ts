import test from "node:test";
import assert from "node:assert/strict";
import { numeros } from "./paginas.ts";

test("numeros: pocas páginas, todas; muchas, con «…» a los lados", () => {
  assert.deepEqual(numeros(1, 1), [1]);
  assert.deepEqual(numeros(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(numeros(1, 16), [1, 2, 3, null, 16]);
  assert.deepEqual(numeros(8, 16), [1, null, 6, 7, 8, 9, 10, null, 16]);
  assert.deepEqual(numeros(16, 16), [1, null, 14, 15, 16]);
});
