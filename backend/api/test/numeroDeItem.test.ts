import test from "node:test";
import assert from "node:assert/strict";
import { posicionPorDescripcion } from "../src/lib/numeroDeItem.js";

// Los ítems del registro de 2026-2543-197 (EsSalud): el agente numeraba por el orden de la lista del OCDS.
const ITEMS = [
  { posicion: 5, descripcion: "CAFEINA CITRATO 20 mg/mL AMP 1 mL" },
  { posicion: 3, descripcion: "ATORVASTATINA 20 mg TAB" },
  { posicion: 4, descripcion: "ATORVASTATINA 10 mg TAB" },
  { posicion: 7, descripcion: "ENALAPRIL 10 mg TAB" },
  { posicion: 9, descripcion: "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL" },
];

test("posicionPorDescripcion (API): el número oficial del ítem por nombre y concentración", () => {
  assert.equal(posicionPorDescripcion("ATORVASTATINA, 10 mg, TABLETA", ITEMS), 4);
  assert.equal(posicionPorDescripcion("ÍTEM N° 7: ENALAPRIL, 10 mg, TABLETA", ITEMS), 7);
  assert.equal(posicionPorDescripcion("ATORVASTATINA TABLETA", ITEMS), null);
});
