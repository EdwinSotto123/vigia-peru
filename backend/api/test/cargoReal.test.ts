import assert from "node:assert/strict";
import { test } from "node:test";
import { cargoRealDe, esCargoGenerico, juntarEmpleos, type EmpleoDeclarado } from "../src/lib/cargoReal.js";

// Reporte del usuario (2026-11-17): un ex rector salía como «Colaborador». Sus declaraciones escriben el mismo puesto de
// tres formas; es UN empleo y su nombre es la forma más repetida.
const UNIVERSIDAD = "20000000001";
const EMPRESA = "20000000002";
const empleo = (x: Partial<EmpleoDeclarado>): EmpleoDeclarado => ({
  ruc: UNIVERSIDAD, entidad: "UNIVERSIDAD DE PRUEBA", publica: true, cargo: "RECTOR", declaraciones: 1, inicio: "2021-11-11", cese: null, sinCese: true, ...x,
});

test("las categorías del formulario no son un puesto", () => {
  for (const c of ["COLABORADOR", "Otro cargo función o labor", "OTRO CARGO FUNCION O LABOR", " colaborador "]) assert.equal(esCargoGenerico(c), true, c);
  for (const c of ["RECTOR", "GERENTE MUNICIPAL", "COLABORADOR EFICAZ", null, undefined, ""]) assert.equal(esCargoGenerico(c), false, String(c));
});

test("un mismo empleo escrito de varias formas es una sola fila", () => {
  const r = juntarEmpleos([
    empleo({ cargo: "RECTOR", declaraciones: 2, inicio: "2021-11-11" }),
    empleo({ cargo: "RECTOR UNI", declaraciones: 4, inicio: "2021-11-12" }),
    empleo({ cargo: "RECTOR DE LA UNI", declaraciones: 5, inicio: "2021-11-12", cese: "2025-05-07", sinCese: false }),
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual({ cargo: r[0]!.cargo, declaraciones: r[0]!.declaraciones, inicio: r[0]!.inicio, cese: r[0]!.cese, sinCese: r[0]!.sinCese },
    { cargo: "RECTOR DE LA UNI", declaraciones: 11, inicio: "2021-11-11", cese: "2025-05-07", sinCese: false });
});

test("dos empleos distintos en el mismo empleador no se juntan, ni dos empleadores", () => {
  const r = juntarEmpleos([
    empleo({ cargo: "DECANO", inicio: "2015-03-01", cese: "2019-02-28", sinCese: false }),
    empleo({ cargo: "RECTOR", inicio: "2021-11-11" }),
    empleo({ ruc: EMPRESA, entidad: "EMPRESA DE PRUEBA S.A.C.", publica: false, cargo: "DIRECTOR", inicio: "2021-11-20" }),
  ]);
  assert.equal(r.length, 3);
  // Primero lo vigente; lo que ya cesó, al final.
  assert.equal(r[r.length - 1]!.cargo, "DECANO");
});

test("el puesto real sólo reemplaza una categoría y sólo en la misma entidad", () => {
  const empleos = [empleo({ cargo: "RECTOR DE LA UNI", declaraciones: 9 }), empleo({ cargo: "DECANO", declaraciones: 1, inicio: "2015-03-01" })];
  assert.equal(cargoRealDe("COLABORADOR", UNIVERSIDAD, empleos), "RECTOR DE LA UNI");
  assert.equal(cargoRealDe(null, UNIVERSIDAD, empleos), "RECTOR DE LA UNI");
  assert.equal(cargoRealDe("COLABORADOR", EMPRESA, empleos), null);
  assert.equal(cargoRealDe("COLABORADOR", null, empleos), null);
  assert.equal(cargoRealDe("GERENTE MUNICIPAL", UNIVERSIDAD, empleos), null);
  assert.equal(cargoRealDe("COLABORADOR", UNIVERSIDAD, [empleo({ cargo: "COLABORADOR" })]), null);
});
