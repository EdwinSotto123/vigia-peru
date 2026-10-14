/**
 * ONPE Claridad: normalize_detail (incluido el aporte_clave, que depende de cómo Python imprime el monto) y
 * normalize_candidatos dan lo mismo que el pipeline de Python, sobre documentos sintéticos.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { normalizarCandidatos, normalizarDetalle, parsearJson, slug } from "../src/fuentes/onpe_claridad.ts";
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
    assert.deepEqual(await normalizarDetalle(doc), v.filas, v.texto.slice(0, 300));
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
