/**
 * mtc_car (Gobserva Car): lo que no depende del Excel del MTC. La paridad con frontend/scripts/car/{citv,mtc}.py sobre
 * los Excel de verdad se mira con scripts/mtc_car_local.ts (dio igual en las tres salidas el 2026-11-22).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { caidas, fecha, juntar, telefono, urlExcel, type Local } from "../src/fuentes/mtc_car.ts";

test("teléfonos: los celulares se tapan (también los de ocho cifras), los fijos quedan", () => {
  assert.equal(telefono("987 654 321"), "9••••••••");
  assert.equal(telefono("97525528"), "9••••••••");
  assert.equal(telefono("(01) 4251234 / 987-654-321"), "(01) 4251234 / 9••••••••");
  assert.equal(telefono("044  231456"), "044 231456");
  assert.equal(telefono("  "), null);
});

test("fechas del MTC: dd/mm/aaaa y celdas de fecha", () => {
  assert.equal(fecha("28/06/2023"), "2023-06-28");
  assert.equal(fecha("2023-06-28 00:00:00"), "2023-06-28");
  assert.equal(fecha("sin fecha"), null);
});

test("un taller de GNV y GLP sale una vez, con los dos gases", () => {
  const l = (nombre: string, direccion: string, distrito = "LIMA"): Local => ({
    nombre, direccion, departamento: "LIMA", provincia: "LIMA", distrito, telefono: null, resolucion: null, fechaResolucion: null,
  });
  const r = juntar([l("Taller Uno", "Av. Perú 123"), l("Taller Dos", "Jr. Lima 1")], [l("TALLER UNO", "AV. PERU 123"), l("Taller Tres", "Calle 2", "ATE")]);
  assert.deepEqual(r.map((x) => [x.nombre, x.tipos]), [["Taller Tres", ["GLP"]], ["Taller Dos", ["GNV"]], ["Taller Uno", ["GNV", "GLP"]]]);
});

test("no se publica una lista que se achicó de golpe o quedó vacía", () => {
  assert.deepEqual(caidas({ "a.x": 100, "a.y": 6 }, { "a.x": 110, "a.y": 6 }), []);
  assert.deepEqual(caidas({ "a.x": 60 }, { "a.x": 100 }), ["a.x: 60 (antes 100)"]);
  assert.deepEqual(caidas({ "a.x": 0 }, {}), ["a.x: 0 (antes ?)"]);
  assert.deepEqual(caidas({ "a.x": 5 }, {}), []);
});

test("las direcciones de los Excel del MTC", () => {
  assert.equal(urlExcel("talleres-glp"), "https://rec.mtc.gob.pe/TallerConversionGNVGLP/arExportToExcel?pArrParametros=2%7C%7C%7C");
  assert.equal(urlExcel("citv"), "https://rec.mtc.gob.pe/CentroInspeccionTecnicoVehicular/arExportToExcel?pArrParametros=%7C%7C");
});
