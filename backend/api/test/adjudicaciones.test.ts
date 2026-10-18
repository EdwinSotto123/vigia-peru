import test from "node:test";
import assert from "node:assert/strict";
import { adjudicacionesVigentes } from "../src/routes/contratos_detalle.js";

// Caso real 1228396: el OCDS trae la buena pro de UNILENE (1.º del acta) y la de MULTIMEDICAL (2.º) sobre los mismos
// dos ítems; CONOSCE registra a MULTIMEDICAL como contratado.
const unilene = { proveedorRuc: "20197705249", montoPen: 1539181.8, items: ["21316537", "21316536"] };
const multimedical = { proveedorRuc: "20471476898", montoPen: 2277032.4, items: ["21316536", "21316537"] };
const fila = (item: number, ruc: string) => ({ item, ruc, proveedor: null, cantidad: 1, montoPen: 1, estado: "Contratado" });

test("adjudicaciones que se pisan: queda vigente la que registra CONOSCE", () => {
  const r = adjudicacionesVigentes([unilene, multimedical], [fila(1, "20471476898"), fila(2, "20471476898")]);
  assert.deepEqual(r.map((a) => a.vigente), [false, true]);
  assert.ok(r.every((a) => !a.sinConfirmar));
});

test("sin CONOSCE: la primera queda vigente y el grupo va sin confirmar", () => {
  const r = adjudicacionesVigentes([unilene, multimedical], []);
  assert.deepEqual(r.map((a) => a.vigente), [true, false]);
  assert.ok(r.every((a) => a.sinConfirmar));
});

test("adjudicaciones de ítems distintos: todas vigentes", () => {
  const a = { proveedorRuc: "20000000001", montoPen: 10, items: ["1"] };
  const b = { proveedorRuc: "20000000002", montoPen: 20, items: ["2"] };
  const r = adjudicacionesVigentes([a, b], [fila(1, "20000000001")]);
  assert.deepEqual(r.map((x) => x.vigente), [true, true]);
  assert.ok(r.every((x) => !x.sinConfirmar));
});
