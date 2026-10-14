/** Las zonas de backend/db/seed/zonas.csv (las mismas filas que la tabla `zonas`) para las pruebas. */

import { readFileSync } from "node:fs";
import type { FilaZona } from "../src/ubigeo.ts";

export function zonasSemilla(): FilaZona[] {
  const csv = readFileSync(new URL("../../db/seed/zonas.csv", import.meta.url), "utf-8").trim().split(/\r?\n/);
  const cab = csv[0].split(",");
  return csv.slice(1).map((l) => {
    const c = l.split(",");
    const f = Object.fromEntries(cab.map((k, i) => [k, c[i]]));
    return { ubigeo: f.ubigeo, nivel: f.nivel, nombre: f.nombre, padre_ubigeo: f.padre_ubigeo || null };
  });
}
