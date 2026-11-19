import test from "node:test";
import assert from "node:assert/strict";
import { nivelAgregado } from "../src/routes/contratos.js";

// Migración 406: la vista agregada más chica que responde exacto. Una elección mal hecha no falla: suma de menos (una
// región filtrada con la vista del país) o de más. Por eso cada caso.

test("sin zona: la vista del país; con un departamento: la de regiones; con provincia o distrito: la de distritos", () => {
  assert.equal(nivelAgregado({}, true), "pais");
  assert.equal(nivelAgregado({ tipo: "obras", riesgo: "alto" }, true), "pais");
  assert.equal(nivelAgregado({ ubigeo: "08" }, true), "region");
  assert.equal(nivelAgregado({ ubigeo: "0801" }, true), "distrito");
  assert.equal(nivelAgregado({ ubigeo: "080101", tipo: "bienes" }, true), "distrito");
});

test("el mapa agrupa por departamento con la de regiones; por provincia o distrito, con la de distritos", () => {
  assert.equal(nivelAgregado({}, true, undefined, 2), "region");
  assert.equal(nivelAgregado({ ubigeo: "15" }, true, undefined, 2), "region");
  // Un departamento elegido y el mapa por departamento, pero filtrado a una provincia: la de distritos.
  assert.equal(nivelAgregado({ ubigeo: "1501" }, true, undefined, 2), "distrito");
  assert.equal(nivelAgregado({}, true, undefined, 4), "distrito");
  assert.equal(nivelAgregado({ ubigeo: "15" }, true, undefined, 6), "distrito");
});

test("una zona que la faceta deja fuera no cuenta como filtro", () => {
  assert.equal(nivelAgregado({ ubigeo: "0801" }, true, new Set(["ubigeo"])), "pais");
});

test("sin la migración 406, siempre la de distritos (como antes)", () => {
  assert.equal(nivelAgregado({}, false), "distrito");
  assert.equal(nivelAgregado({ ubigeo: "08" }, false, undefined, 2), "distrito");
});
