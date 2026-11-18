import assert from "node:assert/strict";
import { test } from "node:test";
import { TAPA_NOMBRE, taparNombreSuelto } from "../src/lib/privacidad.js";

// Auditoría del 2026-11-17: el nombre de un visitante puede venir «nombres apellidos»; se tapa el apellido materno en los
// dos órdenes, y nunca quedan los dos apellidos a la vista.
test("apellidos primero: se tapa el segundo apellido", () => {
  assert.equal(taparNombreSuelto("PEREZ QUISPE JUAN CARLOS"), `PEREZ ${TAPA_NOMBRE} JUAN CARLOS`);
});

test("nombres primero: se tapa el último apellido", () => {
  assert.equal(taparNombreSuelto("JUAN CARLOS PEREZ QUISPE"), `JUAN CARLOS PEREZ ${TAPA_NOMBRE}`);
});

test("con coma: los apellidos van antes", () => {
  assert.equal(taparNombreSuelto("PEREZ QUISPE, JUAN"), `PEREZ ${TAPA_NOMBRE}, JUAN`);
});

test("una empresa no se toca", () => {
  assert.equal(taparNombreSuelto("CONSTRUCTORA ANDINA S.A.C."), "CONSTRUCTORA ANDINA S.A.C.");
});

test("en ningún orden quedan los dos apellidos", () => {
  for (const n of ["MAMANI CONDORI ROSA MARIA", "ROSA MARIA MAMANI CONDORI", "HUAMAN FLORES LUIS", "LUIS ALBERTO HUAMAN FLORES"]) {
    const t = taparNombreSuelto(n);
    assert.ok(t.includes(TAPA_NOMBRE), `${n} → ${t}`);
    const visibles = ["MAMANI", "CONDORI", "HUAMAN", "FLORES"].filter((a) => n.includes(a) && t.includes(a));
    assert.equal(visibles.length, 1, `${n} → ${t}`);
  }
});
