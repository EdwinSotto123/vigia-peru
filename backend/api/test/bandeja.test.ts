import test from "node:test";
import assert from "node:assert/strict";
import { condicionesBandeja, leerBandeja, ordenBandeja, sqlCalce } from "../src/lib/bandeja.js";

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

test("filtrosBandejaAlerta: con `bandeja`, listas y plazo; sin la marca, null", async () => {
  const { filtrosBandejaAlerta } = await import("../src/routes/licitaciones.js");
  const f = filtrosBandejaAlerta({ bandeja: 1, q: "toner", tipo: "bienes,servicios", region: "15,04", cons: "7d", max: 100000 })!;
  assert.equal(f.bandeja, true);
  assert.deepEqual(f.tipo, ["bienes", "servicios"]);
  assert.deepEqual(f.region, ["15", "04"]);
  assert.equal(f.cons, "7d");
  assert.equal(f.max, 100000);
  assert.equal(filtrosBandejaAlerta({ q: "toner" }), null);
});

test("sqlCalce: los filtros del perfil una vez, cada palabra sobre el texto leído y «alguna» con OR", () => {
  const q = leerBandeja({ tipo: "bienes", region: "15", max: "100000" })!;
  const s = sqlCalce(q, [["TONER"], ["PAPEL", "BOND"], []]);
  assert.ok(s.base.includes("AS t FROM convocatorias c"));
  assert.ok(!s.base.includes("LIKE"));
  assert.deepEqual(s.porFrase, ["b.t LIKE $5", "b.t LIKE $6 AND b.t LIKE $7", "false"]);
  assert.equal(s.alguna, "(b.t LIKE $5) OR (b.t LIKE $6 AND b.t LIKE $7) OR (false)");
  assert.deepEqual(s.vals, [30, ["bienes"], ["15"], 100000, "%TONER%", "%PAPEL%", "%BOND%"]);
  assert.equal(sqlCalce(q, []).alguna, "false");
  // Las sugeridas (después de las del perfil) se cuentan pero no entran en «alguna».
  assert.equal(sqlCalce(q, [["TONER"], ["CARTUCHOS"]], 1).alguna, "(b.t LIKE $5)");
});
