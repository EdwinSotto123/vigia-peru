/**
 * Genera la geometría del mapa de la portada (components/landing/MapaRegiones*.tsx).
 *
 *   node scripts/generar-mapa-portada.mjs
 *
 * Antes cada visita a `/` proyectaba los 25 departamentos en el servidor y los mandaba
 * DOS veces: en el HTML (los `<path>`) y en el payload RSC (las props `d` del client
 * component), ~40 KB de recorridos repetidos. Ahora la proyección se hace una sola vez,
 * acá, y queda en un JSON estático que el navegador baja cuando está ocioso y guarda un
 * año (`/assets/*` es immutable): la página ya no lleva ningún recorrido.
 *
 * Simplificación barata: coordenadas enteras sobre un lienzo de 520 × 720 (el mapa nunca
 * se dibuja a más de ~740 px de alto, así que el error es de medio píxel) y sin puntos
 * repetidos seguidos. 38 KB → 26 KB antes de gzip.
 *
 * Si cambia la geometría o el lienzo, subir la versión del nombre (`.v2.json`) y la
 * constante GEOMETRIA de MapaRegionesEscena.tsx: el archivo se cachea como immutable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoMercator, geoPath } from "d3-geo";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANCHO = 520;
const ALTO = 720;
const SALIDA = path.join(raiz, "public/assets/mapa/portada-departamentos.v1.json");

const deptos = JSON.parse(fs.readFileSync(path.join(raiz, "public/peru-departments.json"), "utf8"));
const proyeccion = geoMercator().fitExtent(
  [
    [8, 8],
    [ANCHO - 8, ALTO - 8],
  ],
  deptos,
);
const trazo = geoPath(proyeccion).digits(0);

/** Quita los puntos repetidos seguidos que deja el redondeo a enteros. */
function sinRepetidos(d) {
  return d.replace(/M([^MZ]+)Z/g, (_, cuerpo) => {
    const puntos = [];
    for (const p of cuerpo.split("L")) if (puntos[puntos.length - 1] !== p) puntos.push(p);
    return puntos.length < 3 ? "" : `M${puntos.join("L")}Z`;
  });
}

const zonas = deptos.features.map((f) => {
  const [cx, cy] = trazo.centroid(f);
  return {
    codigo: f.properties.code,
    nombre: f.properties.name,
    d: sinRepetidos(trazo(f) ?? ""),
    cx: Math.round(cx),
    cy: Math.round(cy),
  };
});

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify({ ancho: ANCHO, alto: ALTO, zonas }));
console.log(`${path.relative(raiz, SALIDA)}: ${zonas.length} zonas, ${fs.statSync(SALIDA).size} bytes`);
