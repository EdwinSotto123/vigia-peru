/**
 * ONPE Claridad: normalize_detail (incluido el aporte_clave, que depende de cómo Python imprime el monto) y
 * normalize_candidatos dan lo mismo que el pipeline de Python, sobre documentos sintéticos.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { fechaAporteCreible, normalizarCandidatos, normalizarDetalle, parsearJson, slug } from "../src/fuentes/onpe_claridad.ts";
import type { DocDetalle } from "../src/fuentes/onpe_claridad.ts";

interface VectorOnpe {
  detalle: { texto: string; filas: Record<string, unknown>[] }[];
  candidatos: { texto: string; filas: Record<string, unknown>[] };
  slug: [string, string][];
}
const V = (JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as { onpe: VectorOnpe }).onpe;

test("normalize_detail: mismas filas y mismo aporte_clave que Python (70000.0 ≠ 70000)", async () => {
  let filas = 0;
  for (const v of V.detalle) {
    const doc = parsearJson(v.texto) as DocDetalle;
    // Igual que Python, salvo el año mal tecleado de una fecha (fechaAporteCreible, 2026-11-17): Python lo dejaba pasar.
    const esperado = v.filas.map((f) => {
      const creible = fechaAporteCreible(f.fecha_aporte as string | null, doc.proceso);
      return creible && creible !== f.fecha_aporte ? { ...f, fecha_aporte: creible, "año": Number(creible.slice(0, 4)) } : f;
    });
    assert.deepEqual(await normalizarDetalle(doc), esperado, v.texto.slice(0, 300));
    filas += v.filas.length;
  }
  assert.ok(filas > 80, `${filas} filas`);
});

test("normalize_candidatos y slug", () => {
  assert.deepEqual(normalizarCandidatos(parsearJson(V.candidatos.texto) as { candidatos: Record<string, unknown>[] }), V.candidatos.filas);
  for (const [s, esperado] of V.slug) assert.equal(slug(s), esperado, s);
});

test("ONPE corre los miércoles", () => {
  assert.ok(fuentesDelCron(CRON_DATOS, Date.parse("2026-10-14T13:00:00Z")).includes("onpe_claridad"));   // miércoles 14
  assert.ok(!fuentesDelCron(CRON_DATOS, Date.parse("2026-10-15T13:00:00Z")).includes("onpe_claridad"));
});

test("onpe_claridad: un año mal tecleado en la fecha del aporte se corrige con el del proceso, o no se guarda", () => {
  assert.equal(fechaAporteCreible("0217-06-23", "IFA2017", 2026), "2017-06-23");
  assert.equal(fechaAporteCreible("1021-01-21", "EG2021", 2026), "2021-01-21");
  assert.equal(fechaAporteCreible("2002-03-26", "IFA2022", 2026), "2022-03-26");
  // Una campaña recibe aportes desde el año anterior: no se toca.
  assert.equal(fechaAporteCreible("2020-11-30", "EG2021", 2026), "2020-11-30");
  assert.equal(fechaAporteCreible("2025-12-01", "ERM2026", 2026), "2025-12-01");
  // Un 29 de febrero que no existe en el año del proceso, y un proceso sin año: sin fecha antes que una inventada.
  assert.equal(fechaAporteCreible("2916-02-29", "IFA2017", 2026), null);
  assert.equal(fechaAporteCreible("2916-02-29", "", 2026), null);
  assert.equal(fechaAporteCreible("2019-05-02", "", 2026), "2019-05-02");
  assert.equal(fechaAporteCreible(null, "EG2021", 2026), null);
});
