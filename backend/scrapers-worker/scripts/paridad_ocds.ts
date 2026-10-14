/**
 * Compara normalizarRelease() con lo que dio Python sobre releases reales (.paridad/, ver paridad_ocds.py).
 *   node scripts/paridad_ocds.ts
 */

import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { normalizarRelease } from "../src/fuentes/oece_ocds.ts";
import type { Dict } from "../src/py.ts";
import { ZonaIndex } from "../src/ubigeo.ts";
import type { FilaZona } from "../src/ubigeo.ts";

const leer = (n: string) => JSON.parse(readFileSync(new URL(`../.paridad/${n}`, import.meta.url), "utf-8"));
const releases = leer("releases.json") as Dict[];
const esperado = leer("esperado.json") as unknown[];

const csv = readFileSync(new URL("../../db/seed/zonas.csv", import.meta.url), "utf-8").trim().split(/\r?\n/);
const zonas: FilaZona[] = csv.slice(1).map((l) => {
  const [ubigeo, nivel, nombre, padre] = l.split(",");
  return { ubigeo, nivel, nombre, padre_ubigeo: padre || null };
});
const ix = ZonaIndex.desdeFilas(zonas);

let iguales = 0;
const distintos: string[] = [];
const t0 = performance.now();
for (let i = 0; i < releases.length; i++) {
  const fila = normalizarRelease(releases[i], ix);
  if (isDeepStrictEqual(JSON.parse(JSON.stringify(fila)), esperado[i])) iguales++;
  else if (distintos.length < 5) distintos.push(`${i}: ts=${JSON.stringify(fila).slice(0, 600)}\n    py=${JSON.stringify(esperado[i]).slice(0, 600)}`);
}
const ms = performance.now() - t0;
console.log(`${iguales}/${releases.length} iguales · ${(ms / releases.length).toFixed(3)} ms por release`);
for (const d of distintos) console.log(d);
process.exit(iguales === releases.length ? 0 : 1);
