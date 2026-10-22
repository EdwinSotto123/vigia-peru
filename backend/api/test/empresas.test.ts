import test from "node:test";
import assert from "node:assert/strict";
import { publicar, TAPA_NOMBRE } from "../src/lib/privacidad.js";
import { RUC_EMPRESA } from "../src/routes/empresas.js";

// Las respuestas de /empresas con la forma que arman las rutas: la empresa sale entera, su gente con un apellido tapado.

test("la ficha de una empresa no toca su razón social ni su RUC", () => {
  const r = publicar({ empresa: { ruc: "20511037001", nombre: "GRUPO SANTA FE S.A.C.", departamento: "LIMA" } });
  assert.equal(r.empresa.nombre, "GRUPO SANTA FE S.A.C.");
  assert.equal(r.empresa.ruc, "20511037001");
});

test("los socios, representantes y directivos salen con el materno tapado (orden SUNAT)", () => {
  const r = publicar({ socios: [{ nombre: "QUISPE MAMANI JUAN CARLOS", roles: ["socio"], desde: "2019-01-01", otrasEmpresas: 2 }] });
  assert.equal(r.socios[0].nombre, `QUISPE ${TAPA_NOMBRE} JUAN CARLOS`);
});

test("en las empresas vinculadas, la empresa sale entera y la persona en común tapada", () => {
  const r = publicar({
    vinculadas: [{ ruc: "20602217354", nombre: "CONSTRUCTORA ANDINA E.I.R.L.", socios: [{ nombre: "FLORES HUAMAN ROSA MARIA", rol: "socio", rolAlla: "representante legal" }] }],
  });
  assert.equal(r.vinculadas[0].nombre, "CONSTRUCTORA ANDINA E.I.R.L.");
  assert.equal(r.vinculadas[0].socios[0].nombre, `FLORES ${TAPA_NOMBRE} ROSA MARIA`);
});

test("en las visitas se tapan el visitante y el funcionario", () => {
  const r = publicar({
    visitas: [{ fecha: "2025-03-02", entidad: "MUNICIPALIDAD DISTRITAL DE ATE", visitante: "RAMOS TICONA PEDRO", funcionario: "SALAS VERA ANA LUCIA", via: "representante legal" }],
  });
  assert.equal(r.visitas[0].visitante, `RAMOS ${TAPA_NOMBRE} PEDRO`);
  assert.equal(r.visitas[0].funcionario, `SALAS ${TAPA_NOMBRE} ANA LUCIA`);
  assert.equal(r.visitas[0].entidad, "MUNICIPALIDAD DISTRITAL DE ATE");
});

test("sólo un RUC 20 abre la ficha de empresa (las personas naturales van en /personas)", () => {
  assert.ok(RUC_EMPRESA.test("20511037001"));
  assert.ok(!RUC_EMPRESA.test("10439608801"));
  assert.ok(!RUC_EMPRESA.test("2051103700"));
});
