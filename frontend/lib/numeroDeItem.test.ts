import test from "node:test";
import assert from "node:assert/strict";
import { posicionPorDescripcion } from "./numeroDeItem.ts";

// Los ítems del registro de 2026-2543-197 (EsSalud), con su número oficial.
const ITEMS = [
  { posicion: 5, descripcion: "CAFEINA CITRATO 20 mg/mL AMP 1 mL" },
  { posicion: 13, descripcion: "VALSARTAN 80 mg TAB" },
  { posicion: 3, descripcion: "ATORVASTATINA 20 mg TAB" },
  { posicion: 12, descripcion: "SILDENAFILO 100 mg TAB" },
  { posicion: 8, descripcion: "ENOXAPARINA SODICA 60 mg INY 0,6 mL" },
  { posicion: 2, descripcion: "AMLODIPINO 5 mg TAB" },
  { posicion: 7, descripcion: "ENALAPRIL 10 mg TAB" },
  { posicion: 10, descripcion: "IRBESARTAN 150 mg TAB" },
  { posicion: 4, descripcion: "ATORVASTATINA 10 mg TAB" },
  { posicion: 1, descripcion: "ACIDO FOLICO 500 mcg (0.5 mg) TAB" },
  { posicion: 6, descripcion: "CLOPIDOGREL 75 mg TAB" },
  { posicion: 11, descripcion: "MONONITRATO DE ISOSORBIDA 20 mg TAB" },
  { posicion: 9, descripcion: "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL" },
];

test("posicionPorDescripcion: el número oficial por nombre y concentración", () => {
  assert.equal(posicionPorDescripcion("ATORVASTATINA, 10 mg, TABLETA", ITEMS), 4);
  assert.equal(posicionPorDescripcion("ATORVASTATINA 20 mg TAB", ITEMS), 3);
  assert.equal(posicionPorDescripcion("ÍTEM N° 7: ENALAPRIL, 10 mg, TABLETA", ITEMS), 7);
  assert.equal(posicionPorDescripcion("ENOXAPARINA DE SODIO, 60 MG/0,6 ML, INYECTABLE, 0,6 ML", ITEMS), 8);
  assert.equal(posicionPorDescripcion("HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", ITEMS), 9);
  assert.equal(posicionPorDescripcion("VALSARTÁN, 80 mg, TABLETA", ITEMS), 13);
});

test("posicionPorDescripcion: sin coincidencia clara, null", () => {
  // Sólo «atorvastatina», sin concentración: empata entre el 3 y el 4.
  assert.equal(posicionPorDescripcion("ATORVASTATINA TABLETA", ITEMS), null);
  assert.equal(posicionPorDescripcion("PARACETAMOL 500 mg TAB", ITEMS), null);
  assert.equal(posicionPorDescripcion("", ITEMS), null);
});
