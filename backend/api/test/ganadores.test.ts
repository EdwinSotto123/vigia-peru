import test from "node:test";
import assert from "node:assert/strict";
import { armarGanadores, esCodigoConsorcio } from "../src/lib/ganadores.js";
import { publicar } from "../src/lib/privacidad.js";

// El panel de un contrato de la lista (auditoría de UX del 2026-10-27): un consorcio sin RUC (código 1830304 del SEACE)
// mostraba ese código como «RUC del proveedor», sin sus integrantes, y no decía de quién era la «Multa del Tribunal».

test("ganadores: un consorcio sin RUC se abre en sus integrantes, cada uno con sus antecedentes", () => {
  const filas = [{ ocid: "1243112", proveedor: "CONSORCIO VIRGEN DE CHAPI", proveedorRuc: "1830304" }];
  const casos = [{ ocid: "1243112", ruc: "20571135885", nombre: "YAEV E.I.R.L.", consorcio: "CONSORCIO VIRGEN DE CHAPI", cruces: [{ n: 1, tipo: "sancion_multa", severidad: "baja" }] }];
  const miembros = [
    { codigo: "1830304", ruc: "20603287739", nombre: "CEIAQ E.I.R.L." },
    { codigo: "1830304", ruc: "20571135885", nombre: "YAEV E.I.R.L." },
  ];
  const g = armarGanadores(filas, casos, miembros).get("1243112");
  assert.deepEqual(g, [
    { ruc: "20603287739", nombre: "CEIAQ E.I.R.L.", consorcio: "CONSORCIO VIRGEN DE CHAPI", cruces: [] },
    { ruc: "20571135885", nombre: "YAEV E.I.R.L.", consorcio: "CONSORCIO VIRGEN DE CHAPI", cruces: [{ tipo: "sancion_multa", severidad: "baja" }] },
  ]);
});

test("ganadores: sin consorcio, sólo los ganadores con antecedentes (los graves primero); sin nada, no hay entrada", () => {
  const filas = [
    { ocid: "a", proveedor: "EMPRESA A S.A.C.", proveedorRuc: "20111111111" },
    { ocid: "b", proveedor: "EMPRESA B S.A.C.", proveedorRuc: "20222222222" },
  ];
  const casos = [{ ocid: "a", ruc: "20111111111", nombre: "EMPRESA A S.A.C.", consorcio: null, cruces: [{ tipo: "visita_previa", severidad: "media" }, { tipo: "sancion_vigente", severidad: "alta" }] }];
  const g = armarGanadores(filas, casos, []);
  assert.deepEqual(g.get("a")?.[0].cruces.map((c) => c.tipo), ["sancion_vigente", "visita_previa"]);
  assert.equal(g.has("b"), false);
});

test("ganadores: un código de consorcio es de 4 a 10 dígitos; un RUC (o uno tapado) no", () => {
  assert.equal(esCodigoConsorcio("1830304"), true);
  assert.equal(esCodigoConsorcio("20571135885"), false);
  assert.equal(esCodigoConsorcio("10·ref·7K2Q9A"), false);
  assert.equal(esCodigoConsorcio(null), false);
});

test("ganadores: el integrante que es persona natural sale tapado (RUC como ref, un apellido)", () => {
  const filas = [{ ocid: "c", proveedor: "CONSORCIO X", proveedorRuc: "1900001" }];
  const g = armarGanadores(filas, [], [{ codigo: "1900001", ruc: "10456789012", nombre: "PEREZ QUISPE JUAN" }]);
  const salida = JSON.stringify(publicar({ data: [{ ...filas[0], ganadores: g.get("c") }] }));
  assert.doesNotMatch(salida, /10456789012|45678901/);
  assert.doesNotMatch(salida, /PEREZ QUISPE JUAN/);
  assert.match(salida, /10·ref·[0-9A-Z]{6}/);
});
