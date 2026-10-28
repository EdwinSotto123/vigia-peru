import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNA_SEGUIDO, errorSeguido, periodoVigente, porQue } from "../src/lib/seguidos.js";

test("seguir: el id de cada tipo", () => {
  assert.equal(errorSeguido("zona", "15"), null);
  assert.equal(errorSeguido("zona", "150101"), null);
  assert.equal(errorSeguido("zona", "1501011"), "invalid_ubigeo");
  assert.equal(errorSeguido("entidad", "20131369558"), null);
  assert.equal(errorSeguido("entidad", "2013136955"), "invalid_ruc");
  // Una empresa es sólo un RUC 20: una persona natural (RUC 10) no se sigue.
  assert.equal(errorSeguido("empresa", "20100047218"), null);
  assert.equal(errorSeguido("empresa", "10123456789"), "invalid_ruc");
  assert.equal(errorSeguido("empresa", "15123456789"), "invalid_ruc");
  assert.equal(errorSeguido("partido", "alianza-para-el-progreso"), null);
  assert.equal(errorSeguido("partido", "Alianza Para El Progreso"), "invalid_clave");
  assert.equal(errorSeguido("partido", "x".repeat(81)), "invalid_clave");
  assert.equal(errorSeguido("partido", "a; DROP TABLE usuarios"), "invalid_clave");
  assert.deepEqual(Object.keys(COLUMNA_SEGUIDO).sort(), ["empresa", "entidad", "partido", "zona"]);
});

test("seguir: el período de gobierno vigente", () => {
  assert.equal(periodoVigente("2026-10-28"), 2022);
  assert.equal(periodoVigente("2023-01-01"), 2022);
  assert.equal(periodoVigente("2020-06-15"), 2018);
  assert.equal(periodoVigente("2016-02-01"), 2014);
  // Pasado el último período cargado, el último (hasta que se cargue la elección siguiente).
  assert.equal(periodoVigente("2027-02-01"), 2022);
});

test("seguir: por qué un contrato está en lo nuevo de alguien", () => {
  const seguidos = { entidades: new Set(["20131369558"]), empresas: new Set(["20100047218"]) };
  const partidos = new Map([["alianza-para-el-progreso", "Alianza para el Progreso"]]);
  assert.deepEqual(
    porQue({ entidadRuc: "20131369558", entidad: "MUNICIPALIDAD DE LIMA", ruc: "20100047218", proveedor: "EMPRESA SAC", partidos: ["alianza-para-el-progreso"] }, seguidos, partidos),
    [
      { tipo: "entidad", id: "20131369558", nombre: "MUNICIPALIDAD DE LIMA" },
      { tipo: "empresa", id: "20100047218", nombre: "EMPRESA SAC" },
      { tipo: "partido", id: "alianza-para-el-progreso", nombre: "Alianza para el Progreso" },
    ],
  );
  // Un ganador persona natural nunca entra como «empresa que sigues», aunque su RUC estuviera en la lista.
  const conDiez = { entidades: new Set<string>(), empresas: new Set(["10123456789"]) };
  assert.deepEqual(porQue({ entidadRuc: "20131369558", entidad: null, ruc: "10123456789", proveedor: "PEREZ", partidos: null }, conDiez, partidos), []);
  // Sin nombre: se dice qué es, con su RUC (de una entidad o empresa, nunca de una persona).
  assert.deepEqual(porQue({ entidadRuc: "20131369558", entidad: null, ruc: "20999999999", proveedor: null, partidos: ["otro"] }, seguidos, partidos), [
    { tipo: "entidad", id: "20131369558", nombre: "Entidad con RUC 20131369558" },
    { tipo: "partido", id: "otro", nombre: "otro" },
  ]);
});
