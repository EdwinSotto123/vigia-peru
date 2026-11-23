/**
 * mtc_car sin Cloudflare: arma los tres JSON de Gobserva Car (citv, licencia, gas) desde los Excel del MTC ya bajados,
 * con el mismo código del Worker (src/fuentes/mtc_car.ts). Sirve para comparar con frontend/scripts/car/{citv,mtc}.py
 * sobre los mismos archivos, o para regenerar frontend/data/car (el respaldo que trae la web).
 *
 *   node scripts/mtc_car_local.ts <carpeta con citv.xlsx, medicos.xlsx, …> <carpeta de salida>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { armar, conteos, LISTAS, leerCitv, leerLista, type Leida } from "../src/fuentes/mtc_car.ts";

const [entrada, salida] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error("uso: node scripts/mtc_car_local.ts <carpeta de .xlsx> <carpeta de salida>");
  process.exit(2);
}
const leidas: Record<string, Leida> = {};
for (const clave of Object.keys(LISTAS)) {
  const datos = new Uint8Array(readFileSync(join(entrada, `${clave}.xlsx`)));
  leidas[clave] = clave === "citv" ? leerCitv(datos) : leerLista(datos);
}
const a = armar(leidas);
mkdirSync(salida, { recursive: true });
for (const [nombre, d] of Object.entries(a)) writeFileSync(join(salida, `${nombre}.json`), JSON.stringify(d), "utf-8");
console.log(conteos(a as unknown as Record<string, Record<string, unknown>>));
