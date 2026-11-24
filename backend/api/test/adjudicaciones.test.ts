import test from "node:test";
import assert from "node:assert/strict";
import { adjudicacionesVigentes, ganadorPrincipal, ganadoresSoloConosce } from "../src/routes/contratos_detalle.js";

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

test("reparto de un mismo ítem entre ganadores (CONOSCE registra a los dos): ambas vigentes", () => {
  const a = { proveedorRuc: "20000000001", montoPen: 60, items: ["1"] };
  const b = { proveedorRuc: "20000000002", montoPen: 40, items: ["1"] };
  const r = adjudicacionesVigentes([a, b], [fila(1, "20000000001"), fila(1, "20000000002")]);
  assert.deepEqual(r.map((x) => x.vigente), [true, true]);
});

test("sin CONOSCE: si juntas no pasan el referencial es un reparto (todas vigentes); si lo pasan, alternativas", () => {
  const ref = new Map([["1", 1_549_400]]);
  const reparto = adjudicacionesVigentes([
    { proveedorRuc: "20000000001", montoPen: 148_350, items: ["1"] },
    { proveedorRuc: "20000000002", montoPen: 1_277_340, items: ["1"] },
  ], [], ref);
  assert.deepEqual(reparto.map((x) => x.vigente), [true, true]);
  assert.ok(reparto.every((x) => !x.sinConfirmar));
  const alternativas = adjudicacionesVigentes([
    { proveedorRuc: "20000000001", montoPen: 97_000, items: ["1"] },
    { proveedorRuc: "20000000002", montoPen: 97_400, items: ["1"] },
  ], [], new Map([["1", 97_500]]));
  assert.deepEqual(alternativas.map((x) => x.vigente), [true, false]);
  assert.ok(alternativas.every((x) => x.sinConfirmar));
});

test("ganadores que sólo registra CONOSCE: uno por código, con su monto sumado y su última buena pro", () => {
  const k = (item: number, ruc: string | null, montoPen: number | null, fechaBuenaPro: string | null) =>
    ({ item, ruc, proveedor: "X", cantidad: 1, montoPen, estado: "Adjudicado", fechaBuenaPro });
  const r = ganadoresSoloConosce([{ proveedorRuc: "20000000001" }], [
    k(1, "20000000001", 10, "2026-01-02"),   // ya está en el OCDS
    k(2, "1843000", 30, "2026-01-05"),        // consorcio con código del SEACE
    k(3, "1843000", 20, "2026-01-09"),
    k(4, null, null, null),                   // ítem desierto
  ]);
  assert.deepEqual(r, [{ proveedorRuc: "1843000", proveedor: "X", fecha: "2026-01-09", montoPen: 50 }]);
});

// Caso real 2026-2543-197 (EsSalud, 8 ganadores en 11 ítems): el registro nombra primero a Medifarma (S/ 1.06 M) y el de
// mayor monto es AC Farma (tres ítems, S/ 8.34 M). La cabecera y el dictamen tienen que nombrar al mismo.
test("ganadorPrincipal: con varios ganadores, el de mayor monto sumado por CONOSCE; con uno solo, null", () => {
  const k = (item: number, ruc: string, proveedor: string, montoPen: number) => ({ item, ruc, proveedor, cantidad: 1, montoPen, estado: "Contratado" });
  const conosce = [k(1, "20100018625", "MEDIFARMA S A", 1064634.7), k(4, "20347268683", "LABORATORIOS AC FARMA S.A.", 1528000),
    k(8, "20600413571", "FARMA MIAVIDA", 3272119.05), k(10, "20347268683", "LABORATORIOS AC FARMA S.A.", 5024000),
    k(13, "20347268683", "LABORATORIOS AC FARMA S.A.", 1790000)];
  assert.deepEqual(ganadorPrincipal(conosce, []), { ruc: "20347268683", nombre: "LABORATORIOS AC FARMA S.A." });
  assert.equal(ganadorPrincipal([k(1, "20100018625", "MEDIFARMA S A", 10), k(2, "20100018625", "MEDIFARMA S A", 5)], []), null);
  // Sin CONOSCE, las adjudicaciones del OCDS.
  assert.equal(ganadorPrincipal([], [{ proveedorRuc: "20000000001", proveedor: "A", montoPen: 5 }, { proveedorRuc: "20000000002", proveedor: "B", montoPen: 9 }])?.ruc, "20000000002");
});

// Caso real 1220581: el OCDS nombra primero a Jemar (buena pro reemplazada) y CONOSCE registra contratado al consorcio.
test("ganadorPrincipal: un solo ganador en CONOSCE distinto del registro, ése", () => {
  const k = { item: 1, ruc: "1807502", proveedor: "CONSORCIO TECNISAN - METROPOLITAN", cantidad: 1, montoPen: 1487000, estado: "Contratado" };
  assert.deepEqual(ganadorPrincipal([k], [], "20601052084"), { ruc: "1807502", nombre: "CONSORCIO TECNISAN - METROPOLITAN" });
  assert.equal(ganadorPrincipal([k], [], "1807502"), null);
});
