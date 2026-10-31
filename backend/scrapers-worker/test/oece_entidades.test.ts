/**
 * Entidades contratantes de la OECE (src/fuentes/oece_entidades.ts): la lectura del CSV, igual que leer() de
 * backend/scripts/cargar_entidades_oece.py. Con RUC y nombres inventados.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fechaOece, leerEntidades } from "../src/fuentes/oece_entidades.ts";

const CABECERA = "RUC|NOMBRE_DE_ENTIDAD|DEPARTAMENTO|PROVINCIA|DISTRITO|CODIGO_SIAF|CODCONSUCODE|ESTADO|ULTIMAACTUALIZACION";

test("fechaOece: dd/mm/aa como strptime %y", () => {
  assert.equal(fechaOece("27/08/26"), "2026-08-27");
  assert.equal(fechaOece("01/02/99"), "1999-02-01");
  assert.equal(fechaOece("31/02/26"), null);
  assert.equal(fechaOece(""), null);
  assert.equal(fechaOece("2026-08-27"), null);
});

test("leerEntidades: códigos, fuera del SIAF, repetidos y descartes", () => {
  const csv = [
    CABECERA,
    "20000000001|MUNICIPALIDAD   DISTRITAL DE PRUEBA|LIMA|LIMA|LIMA|0117|123|ACTIVO|27/08/26",
    "20000000002|EMPRESA MUNICIPAL DE PRUEBA|CUSCO|CUSCO|CUSCO|930012|456|ACTIVO|01/02/25",
    "20000000003|ENTIDAD SIN CODIGO|PIURA|PIURA|PIURA||789|ACTIVO|",
    "20000000001|MUNICIPALIDAD DISTRITAL DE PRUEBA (OTRA)|LIMA|LIMA|LIMA|0118|123|ACTIVO|28/08/26",
    "2000000000X|RUC MALO|LIMA|LIMA|LIMA|0001|1|ACTIVO|01/01/26",
    "20000000004|CODIGO MALO|LIMA|LIMA|LIMA|01A7|1|ACTIVO|01/01/26",
    "20000000005|POCAS COLUMNAS|LIMA",
    "",
  ].join("\r\n");
  const { filas, cuenta } = leerEntidades(new TextEncoder().encode(`﻿${csv}`));
  assert.equal(filas.length, 3);
  const por = Object.fromEntries(filas.map((f) => [f.ruc, f]));
  // El último repetido manda (como el dict de Python) y el código se lee como número.
  assert.equal(por["20000000001"].sec_ejec, 118);
  assert.equal(por["20000000001"].nombre, "MUNICIPALIDAD DISTRITAL DE PRUEBA (OTRA)");
  assert.equal(por["20000000001"].fuera_siaf, false);
  assert.equal(por["20000000001"].actualizado, "2026-08-28");
  // 930xxx y vacío: fuera del SIAF, sin sec_ejec.
  assert.equal(por["20000000002"].fuera_siaf, true);
  assert.equal(por["20000000002"].sec_ejec, null);
  assert.equal(por["20000000002"].codigo_siaf, "930012");
  assert.equal(por["20000000003"].fuera_siaf, true);
  assert.equal(por["20000000003"].codigo_siaf, null);
  assert.equal(cuenta["RUC repetidos (queda el último)"], 1);
  assert.equal(cuenta["descartadas: RUC"], 1);
  assert.equal(cuenta["descartadas: código"], 1);
  assert.equal(cuenta["descartadas: columnas"], 1);
});

test("leerEntidades: Windows-1252 cuando no es UTF-8", () => {
  const texto = `${CABECERA}\n20000000009|MUNICIPALIDAD DE PEÑA|LIMA|LIMA|LIMA|0001|1|ACTIVO|01/01/26\n`;
  const bytes = Uint8Array.from([...texto].map((c) => c.charCodeAt(0)));   // Ñ = 0xD1 suelto: no es UTF-8 válido
  const { filas } = leerEntidades(bytes);
  assert.equal(filas[0].nombre, "MUNICIPALIDAD DE PEÑA");
});

test("leerEntidades: una cabecera distinta corta la carga", () => {
  assert.throws(() => leerEntidades(new TextEncoder().encode("RUC|NOMBRE\n20000000001|X\n")), /cabecera inesperada/);
});
