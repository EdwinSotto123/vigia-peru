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
import { normalizarCsv, normalizarWiki, periodoEntre } from "../src/fuentes/pnda_sancionados.ts";
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

test("sancionados: los CSV abiertos del OECE (wiki); sin fecha de fin es definitiva y el periodo sale de las fechas", () => {
  const cab = "FECHA_CORTE|RUC|NOMBRE_RAZONODENOMINACIONSOCIAL|FECHA_INICIO|FECHA_FIN|NUMERO_RESOLUCION|ID_MOTIVO_INFRACCION|DE_MOTIVO_INFRACCION";
  const inh = normalizarWiki([cab,
    "20261114|20000000001|EMPRESA DE PRUEBA S.A.C.|20260715|20290715|1234-2026- TCE-S1|12|Presentar documentos falsos",
    "20261114|20000000002|OTRA DE PRUEBA E.I.R.L.|19990218||008-1999-TC-S1|12|RESCISION ADMINISTRATIVA DEL CONTRATO",
    "20261114|10000000003|APELLIDO APELLIDO NOMBRE|20260301|20260201|77-2026-TCE-S2|5|Dejada sin efecto",   // termina antes de empezar
    "20261114||SIN RUC|20260301|20260901|78-2026-TCE-S2|5|x",
    ""].join("\r\n"), false);
  assert.equal(inh.length, 2);
  assert.deepEqual({ tipo: inh[0]!.tipo, ruc: inh[0]!.ruc, resolucion: inh[0]!.resolucion, periodo: inh[0]!.periodo, desde: inh[0]!.fecha_desde, hasta: inh[0]!.fecha_hasta },
    { tipo: "temporal", ruc: "20000000001", resolucion: "1234-2026-TCE-S1", periodo: "36 MESES", desde: "2026-07-15", hasta: "2029-07-15" });
  assert.deepEqual({ tipo: inh[1]!.tipo, periodo: inh[1]!.periodo, hasta: inh[1]!.fecha_hasta, natural: inh[1]!.es_persona_natural },
    { tipo: "definitivo", periodo: null, hasta: null, natural: false });
  const multas = normalizarWiki([`${cab}|MONTO`,
    "20261114|10000000003|APELLIDO APELLIDO NOMBRE|20260103|20260503|4291-2025-TCE-S4|237,|b) Incumplir con perfeccionar el contrato|23000.00"].join("\n"), true);
  assert.deepEqual({ tipo: multas[0]!.tipo, monto: multas[0]!.monto_multa_soles, periodo: multas[0]!.periodo, natural: multas[0]!.es_persona_natural },
    { tipo: "multa", monto: 23000, periodo: "4 MESES", natural: true });
  // Si el OECE cambia la cabecera, la carga se detiene avisando en vez de leer columnas corridas.
  assert.throws(() => normalizarWiki("RUC|NOMBRE|INICIO\n1|2|3", false), /cabecera/);
  assert.equal(periodoEntre("2026-01-31", "2026-03-30"), "1 MESES");
  assert.equal(periodoEntre("2026-01-15", null), null);
});
