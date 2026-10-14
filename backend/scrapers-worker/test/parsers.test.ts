/**
 * Paridad con Python de los parsers de las fuentes de la PNDA (vectores de scripts/vectores_py.py):
 * csv.reader, normalize_csv (sancionados), parse_row y parse_xlsx (visitas), parse_xls + normalize_rows
 * y _proceso_codigo (JNE), sobre entradas sintéticas y los fixtures de backend/scrapers/tests/fixtures.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodificarCp1252, leerCsv } from "../src/csv.ts";
import { codigoProceso, normalizarFilas, parsearXls } from "../src/fuentes/jne_infogob.ts";
import { normalizarCsv } from "../src/fuentes/pnda_sancionados.ts";
import { parsearFila, parsearXlsx } from "../src/fuentes/pnda_visitas.ts";
import { ZonaIndex } from "../src/ubigeo.ts";
import type { Celda } from "../src/xls.ts";
import { zonasSemilla } from "./zonas.ts";

type Resultado<T> = { ok?: T; error?: string };
interface Vectores {
  csv: [string, string[][] | null][];
  sancionados: { csv_b64: string; filas: Resultado<unknown[]> }[];
  visitas: { filas: [unknown[], Resultado<unknown>][]; fixture: { filas: unknown[]; descartadas: number } };
  jne: { fixture: unknown[]; procesos: [string, unknown, Resultado<string>][] };
}

const V = JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as Vectores;
const FX = new URL("../../scrapers/tests/fixtures/", import.meta.url);

test("csv.reader (newline='') en 313 textos con comillas, \\r sueltos y saltos dentro de comillas", () => {
  for (const [texto, esperado] of V.csv) {
    if (esperado === null) assert.throws(() => leerCsv(texto, ";"), JSON.stringify(texto));
    else assert.deepEqual(leerCsv(texto, ";"), esperado, JSON.stringify(texto));
  }
});

test("normalize_csv de sancionados (cp1252, BOM, bytes sin definir, fechas en tres formatos)", () => {
  let n = 0;
  for (const v of V.sancionados) {
    assert.ok(v.filas.ok, "los vectores no deberían traer errores de Python");
    const datos = Uint8Array.from(Buffer.from(v.csv_b64, "base64"));
    assert.deepEqual(normalizarCsv(decodificarCp1252(datos)), v.filas.ok);
    n += v.filas.ok.length;
  }
  assert.ok(n > 50, `${n} filas`);
});

test("parse_row de visitas en 600 filas sintéticas", () => {
  for (const [fila, esperado] of V.visitas.filas) {
    assert.ok(!esperado.error);
    assert.deepEqual(parsearFila(fila as (string | null)[]), esperado.ok ?? null, JSON.stringify(fila));
  }
});

test("parse_xlsx de visitas con el fixture (salta el título, descarta la fila sin visitante)", () => {
  const datos = new Uint8Array(readFileSync(new URL("REPORTE DE REGISTRO DE VISITAS - FEBRERO - 2025.xlsx", FX)));
  const { filas, descartadas } = parsearXlsx(datos);
  assert.deepEqual(filas, V.visitas.fixture.filas);
  assert.equal(descartadas, V.visitas.fixture.descartadas);
});

test("parse_xls + normalize_rows del JNE con el fixture (fechas Excel, ubigeo INEI)", () => {
  const datos = new Uint8Array(readFileSync(new URL("autoridades_vigentes_muestra.xls", FX)));
  const filas = normalizarFilas(parsearXls(datos, true), ZonaIndex.desdeFilas(zonasSemilla()), "https://www.datosabiertos.gob.pe/dataset/x");
  assert.deepEqual(filas, V.jne.fixture);
  assert.ok(filas.length > 0);
});

test("_proceso_codigo del JNE", () => {
  for (const [texto, anio, esperado] of V.jne.procesos) {
    const a = anio === null ? undefined : (anio as Celda);
    assert.equal(codigoProceso(texto, a), esperado.ok, JSON.stringify([texto, anio]));
  }
});
