import assert from "node:assert/strict";
import { test } from "node:test";
import { casoLectura, categoriaLectura } from "../src/lib/lectura.ts";

/** Evalúa el CASE de casoLectura("") sobre una fila: sólo entiende `col IN (...)` y `col = '...'`, que es lo que usa. */
function evaluarCaso(sql: string, fila: Record<string, string | null>): string {
  const ramas = [...sql.matchAll(/WHEN (\w+) (IN \(([^)]*)\)|= '(\w+)') THEN '(\w+)'/g)];
  assert.ok(ramas.length >= 4, "casoLectura cambió de forma: actualizar este evaluador");
  for (const r of ramas) {
    const valor = fila[r[1]];
    const lista = r[3] ? [...r[3].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [r[4]];
    if (valor != null && lista.includes(valor)) return r[5];
  }
  return /ELSE '(\w+)'/.exec(sql)![1];
}

test("categoriaLectura reparte igual que casoLectura (migración 383: facetas de partido ya agrupadas)", () => {
  const sql = casoLectura("");
  const estados = ["encolado", "procesando", "completado", "fallido", "sin_analizar", null];
  const riesgos = ["alto", "medio", "bajo", "en_revision", "sin_analizar", "descartado", null];
  for (const estado_proc of estados) {
    for (const riesgo of riesgos) {
      assert.equal(categoriaLectura(estado_proc, riesgo), evaluarCaso(sql, { estado_proc, riesgo }), `${estado_proc} / ${riesgo}`);
    }
  }
});
