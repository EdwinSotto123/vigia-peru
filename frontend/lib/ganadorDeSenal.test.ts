import test from "node:test";
import assert from "node:assert/strict";
import { ganadorDeLaSenal, itemsGanados, nucleoDelNombre } from "./ganadorDeSenal.ts";

// Caso real 2026-2543-197 (EsSalud, 8 ganadores en 11 ítems).
const G = [
  { ruc: "20347268683", nombre: "LABORATORIOS AC FARMA S.A.", items: [4, 10, 13] },
  { ruc: "20613527134", nombre: "HAMUQ FARMA E.I.R.L.", items: [3] },
  { ruc: "20600413571", nombre: "FARMA MIAVIDA SOCIEDAD ANONIMA CERRADA", items: [8] },
  { ruc: "20519131243", nombre: "YARGO INTERNACIONAL E.I.R.L. - Y.I. E.I.R.L.", items: [12] },
];

test("nucleoDelNombre: sin la forma societaria ni palabras genéricas", () => {
  assert.equal(nucleoDelNombre("HAMUQ FARMA E.I.R.L."), "HAMUQ FARMA");
  assert.equal(nucleoDelNombre("LABORATORIOS AC FARMA S.A."), "AC FARMA");
  assert.equal(nucleoDelNombre("YARGO INTERNACIONAL E.I.R.L. - Y.I. E.I.R.L."), "YARGO INTERNACIONAL");
  assert.equal(nucleoDelNombre("S.A."), null);
});

test("ganadorDeLaSenal: por RUC, por nombre y, si no se puede decir, null", () => {
  assert.equal(ganadorDeLaSenal("HAMUQ FARMA E.I.R.L. (RUC 20613527134) inició actividades el 6 dic. 2024", G)?.ruc, "20613527134");
  assert.equal(ganadorDeLaSenal("Según el padrón SUNAT, Hamuq Farma E.I.R.L. inició actividades…", G)?.ruc, "20613527134");
  // Dos ganadores nombrados, ninguno, o un solo ganador en el proceso: no se adivina.
  assert.equal(ganadorDeLaSenal("Hamuq Farma y Farma Miavida comparten domicilio", G), null);
  assert.equal(ganadorDeLaSenal("EsSalud entrega documentación a la Fiscalía", G), null);
  assert.equal(ganadorDeLaSenal("RUC 20613527134", [G[1]]), null);
});

test("itemsGanados", () => {
  assert.equal(itemsGanados([3]), "ganó el ítem 3");
  assert.equal(itemsGanados([13, 4, 10]), "ganó los ítems 4, 10 y 13");
  assert.equal(itemsGanados([]), "");
});
