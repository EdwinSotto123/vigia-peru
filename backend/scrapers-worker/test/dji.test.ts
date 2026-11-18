/**
 * pnda_dji: qué CSV del dataset se carga y con qué cabecera. La Contraloría sube cada corte con otro nombre y deja el
 * anterior (2026-11-02: ListadoDDJJ.csv junto al Reporte1.csv de julio); pedir un nombre fijo dejó la base en julio.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CABECERAS, cabeceraCsv, elegirMasReciente } from "../src/fuentes/pnda_dji.ts";

const SALTO = String.fromCharCode(10);
const RETORNO = String.fromCharCode(13);

test("pnda_dji: de varios CSV del dataset, el de fecha más reciente", () => {
  const julio = { archivo: "Reporte1.csv", modificado: Date.parse("2026-08-11T00:00:00Z") };
  const octubre = { archivo: "ListadoDDJJ.csv", modificado: Date.parse("2026-11-02T00:00:00Z") };
  assert.equal(elegirMasReciente([julio, octubre])?.archivo, "ListadoDDJJ.csv");
  assert.equal(elegirMasReciente([octubre, julio])?.archivo, "ListadoDDJJ.csv");
  // Sin fecha de ninguno (el portal no la dio): el último de la página, que es el que se añadió después.
  assert.equal(elegirMasReciente([{ archivo: "a.csv", modificado: 0 }, { archivo: "b.csv", modificado: 0 }])?.archivo, "b.csv");
  assert.equal(elegirMasReciente([]), null);
});

test("pnda_dji: la cabecera del CSV, sin BOM ni comillas; la de un archivo con otras columnas no coincide", () => {
  const linea = CABECERAS.funcionarios.map((c) => `"${c}"`).join(",");
  const bom = String.fromCharCode(0xfeff);
  assert.deepEqual(cabeceraCsv(`${bom}${linea}${RETORNO}${SALTO}"1","DNI","A","B","C"`), CABECERAS.funcionarios);
  assert.deepEqual(cabeceraCsv(CABECERAS.empleos.join(",") + SALTO), CABECERAS.empleos);
  assert.notDeepEqual(cabeceraCsv(`"CODIGO_DDJJ","NOMBRES"${SALTO}`), CABECERAS.funcionarios);
  assert.equal(CABECERAS.funcionarios.length, 11);
  assert.equal(CABECERAS.empleos.length, 8);
});
