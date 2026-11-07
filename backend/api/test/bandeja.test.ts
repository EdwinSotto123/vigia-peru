import test from "node:test";
import assert from "node:assert/strict";
import { condicionesBandeja, leerBandeja, ordenBandeja } from "../src/lib/bandeja.js";

// La bandeja de la app (GET /licitaciones/bandeja): los filtros de la URL de la app, validados y en SQL.

test("leerBandeja: listas, rango al revés, valores raros a su defecto", () => {
  const q = leerBandeja({ q: " toner ", tipo: "bienes,naves,servicios,bienes", region: "15,LIMA,04", min: "900", max: "100", pub: "90", cons: "x", orden: "azar", pag: "-1", tam: "33" })!;
  assert.deepEqual(q.tipo, ["bienes", "servicios"]);
  assert.deepEqual(q.region, ["15", "04"]);
  assert.deepEqual([q.min, q.max], [100, 900]);
  assert.equal(q.q, "toner");
  assert.equal(q.pub, 30);
  assert.equal(q.cons, null);
  assert.equal(q.orden, "recientes");
  assert.equal(q.pag, 1);
  assert.equal(q.tam, 20);
});

test("condicionesBandeja: cada filtro con su parámetro; la faceta no se filtra a sí misma", () => {
  const q = leerBandeja({ tipo: "bienes,obras", region: "15", proc: "Subasta Inversa Electrónica", cons: "3d", max: "5000" })!;
  const todo = condicionesBandeja(q, ["TONER"]);
  assert.ok(todo.conds.some((c) => c.includes("c.tipo_contratacion = ANY($2::text[])")));
  assert.deepEqual(todo.vals, [30, ["bienes", "obras"], ["15"], "Subasta Inversa Electrónica", 5000, "%TONER%"]);
  assert.ok(todo.conds.some((c) => c.includes("BETWEEN") && c.includes("+ 3")));
  const sinTipo = condicionesBandeja(q, [], "tipo");
  assert.ok(!sinTipo.conds.some((c) => c.includes("tipo_contratacion")));
  assert.ok(sinTipo.conds.some((c) => c.includes("ubigeo_zona")));
});

test("ordenBandeja: cada orden con desempate estable", () => {
  for (const o of ["recientes", "valor_desc", "valor_asc", "vence", "entidad"] as const) assert.match(ordenBandeja(o), /c\.ocid DESC/);
  assert.match(ordenBandeja("valor_asc"), /ASC NULLS LAST/);
});
