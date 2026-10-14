/**
 * Compara los parsers del port con lo que dio Python sobre archivos reales (.paridad/archivos.json, ver
 * paridad_archivos.py).   node scripts/paridad_archivos.ts <carpeta>
 */

import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { decodificarCp1252 } from "../src/csv.ts";
import { normalizarFilas, parsearXls } from "../src/fuentes/jne_infogob.ts";
import { normalizarCsv } from "../src/fuentes/pnda_sancionados.ts";
import { parsearXlsx } from "../src/fuentes/pnda_visitas.ts";
import { ZonaIndex } from "../src/ubigeo.ts";
import type { FilaZona } from "../src/ubigeo.ts";

const carpeta = process.argv[2];
const esperado = JSON.parse(readFileSync(new URL("../.paridad/archivos.json", import.meta.url), "utf-8")) as Record<string, unknown>;
const csv = readFileSync(new URL("../../db/seed/zonas.csv", import.meta.url), "utf-8").trim().split(/\r?\n/);
const zonas: FilaZona[] = csv.slice(1).map((l) => {
  const [ubigeo, nivel, nombre, padre] = l.split(",");
  return { ubigeo, nivel, nombre, padre_ubigeo: padre || null };
});
const ix = ZonaIndex.desdeFilas(zonas);

let fallas = 0;
for (const [nombre, py] of Object.entries(esperado)) {
  const datos = new Uint8Array(readFileSync(`${carpeta}/${nombre}`));
  const t0 = performance.now();
  let ts: unknown;
  if (nombre.startsWith("visitas_")) ts = parsearXlsx(datos);
  else if (nombre.startsWith("jne_")) ts = normalizarFilas(parsearXls(datos, nombre.includes("vigentes")), ix, "https://www.datosabiertos.gob.pe/dataset/x");
  else ts = normalizarCsv(decodificarCp1252(datos));
  const ms = performance.now() - t0;
  const filasTs = (Array.isArray(ts) ? ts : (ts as { filas: unknown[] }).filas) as unknown[];
  const filasPy = (Array.isArray(py) ? py : (py as { filas: unknown[] }).filas) as unknown[];
  let distintas = 0;
  let ejemplo = "";
  for (let i = 0; i < Math.max(filasTs.length, filasPy.length); i++) {
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(filasTs[i] ?? null)), filasPy[i] ?? null)) {
      distintas++;
      if (!ejemplo) ejemplo = `   fila ${i}\n   ts=${JSON.stringify(filasTs[i]).slice(0, 500)}\n   py=${JSON.stringify(filasPy[i]).slice(0, 500)}`;
    }
  }
  const extra = Array.isArray(py) ? "" : ` · descartadas ts ${(ts as { descartadas: number }).descartadas} py ${(py as { descartadas: number }).descartadas}`;
  console.log(`${nombre}: ${filasTs.length} filas (py ${filasPy.length}) · distintas ${distintas}${extra} · ${ms.toFixed(0)} ms`);
  if (ejemplo) console.log(ejemplo);
  if (distintas) fallas++;
}
process.exit(fallas ? 1 : 0);
