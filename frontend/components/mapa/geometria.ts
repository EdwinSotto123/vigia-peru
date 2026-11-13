/**
 * Cálculos de colocación del coroplético (sin React): qué nombres de
 * departamento caben sobre el mapa y dónde va cada punto anclado a una zona.
 * Viven aparte de `PeruChoropleth` para que el componente sólo dibuje.
 */

import { geoContains, type GeoProjection } from "d3-geo";
import type { Feature } from "geojson";
import type { MapPoint, ZonaPintada } from "@/components/PeruChoropleth";
import { nivelDeEtiqueta } from "./escala";

/** Un departamento ya proyectado al viewBox. */
export interface DeptPath {
  ubigeo: string;
  id: string;
  name: string;
  d: string;
  centroid: [number, number];
  bounds: [[number, number], [number, number]];
}

/**
 * Qué nombres de departamento se imprimen sobre el mapa, y dónde.
 *
 * Colocación codiciosa por prioridad, que es como resuelve esto cualquier motor
 * de rotulación: se ordenan los nombres por importancia —el escalón de la medida
 * activa, derivado del relleno— y se van colocando; el que choca con uno ya
 * colocado prueba un lugar corrido (arriba, abajo, a los lados, sin salir de su
 * departamento) y, si ninguno está libre, no se imprime. Sin esto había tres
 * solapamientos medidos (Cajamarca×Lambayeque, Ayacucho×Apurímac y Callao×Lima).
 *
 * La caja de cada nombre se mide con lo que de verdad se dibuja (PeruChoropleth):
 * 14, 12 u 11 px según el escalón, en negrita, seminegrita o normal, más el halo.
 * Antes se medía a 10 px y a 0,52 em por letra, y en el mapa de partidos (todo
 * pintado con colores fuertes: todo «alto», 14 px en negrita) dos nombres vecinos
 * se encimaban («ÁncashHuánuco»).
 *
 * Devuelve la posición (unidades del viewBox) de cada nombre que se imprime. Lo
 * que no se imprime no se pierde: el nombre y las cifras están en la ficha
 * flotante al pasar por encima o al llegar con Tab.
 */
export function colocarEtiquetas(
  deptPaths: DeptPath[],
  regiones: Record<string, ZonaPintada>,
  fitScale: number,
): Map<string, [number, number]> {
  const visibles = new Map<string, [number, number]>();
  if (!deptPaths.length) return visibles;
  const nivel = (u: string) => nivelDeEtiqueta(regiones[u]?.color ?? "#FFFFFF");
  const prioridad = (u: string) => (nivel(u) === "alto" ? 0 : nivel(u) === "medio" ? 1 : 2);
  // Tamaño (px de pantalla) y peso de cada escalón: los de PeruChoropleth (`fs`, `peso`).
  const tam = (u: string) => (nivel(u) === "alto" ? 14 : nivel(u) === "medio" ? 12 : 11);
  const grosor = (u: string) => (nivel(u) === "alto" ? 1.06 : nivel(u) === "medio" ? 1.03 : 1);
  const escala = fitScale || 1;
  /** El halo (2,2 px de trazo: la mitad queda afuera) y un poco de aire entre dos nombres, en px de pantalla. */
  const margen = 2;
  const candidatos = deptPaths
    .filter((p) => p.ubigeo !== "07")
    .sort((a, b) => prioridad(a.ubigeo) - prioridad(b.ubigeo) || a.name.localeCompare(b.name, "es"));

  const colocadas: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const p of candidatos) {
    const f = tam(p.ubigeo) / escala;
    const m = margen / escala;
    const texto = anchoEnEm(p.name) * grosor(p.ubigeo) * f;
    const [[x0, y0], [x1, y1]] = p.bounds;
    // ¿Entra en su propio departamento? (con holgura: el nombre puede asomar sobre la frontera, como siempre)
    if (texto > (x1 - x0) * 1.35) continue;
    // La caja que no puede tocar a otra: el texto, su halo y el aire.
    const w = texto + 2 * m;
    const h = f * 1.15 + 2 * m;
    const [cx, cy] = p.centroid;
    // El centroide primero; después, corrido arriba y abajo (media y una caja entera) y a los lados.
    const desvios: [number, number][] = [
      [0, 0],
      [0, -0.6 * h],
      [0, 0.6 * h],
      [0, -1.1 * h],
      [0, 1.1 * h],
      [-0.25 * w, 0],
      [0.25 * w, 0],
    ];
    for (const [dx, dy] of desvios) {
      const x = cx + dx;
      const y = cy + dy;
      // Sin salir de su departamento: el centro del nombre queda dentro de su caja.
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const caja = { x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 };
      if (colocadas.some((c) => caja.x1 < c.x2 && caja.x2 > c.x1 && caja.y1 < c.y2 && caja.y2 > c.y1)) continue;
      colocadas.push(caja);
      visibles.set(p.ubigeo, [x, y]);
      break;
    }
  }
  return visibles;
}

/**
 * Lo que mide un nombre en «em» con la letra del mapa (Inter): angostas (i, l, t, r, el espacio), anchas (m, w),
 * mayúsculas y las demás. Medido en el navegador contra los 25 nombres: queda dentro de un 4 % (un ancho fijo por letra
 * se equivocaba en un 15 %: «San Martín» medía como «Amazonas»), y se suma ese 4 % para no quedarse corto.
 */
function anchoEnEm(nombre: string): number {
  let em = 0;
  for (const c of nombre) {
    if (/[iljtfríìI .'-]/.test(c)) em += 0.32;
    else if (/[mwMW]/.test(c)) em += 0.85;
    else if (c !== c.toLowerCase()) em += 0.68;
    else em += 0.56;
  }
  return em * 1.04;
}

/**
 * Posición de cada punto anclado a una zona. Los que comparten zona se abren en
 * espiral (ángulo áureo) desde el centroide, a pasos de 6 px REALES, y sólo se
 * aceptan posiciones que caen DENTRO del polígono (geoContains): a escala país
 * la provincia de Lima mide 15 px y una espiral libre dejaba puntos en el mar.
 * Si el polígono es tan chico que no entran todos, los que sobran se apilan
 * sobre los ya ubicados en vez de salirse.
 */
export function posicionesEnEspiral({
  points,
  projection,
  poligonosPorZona,
  centroides,
  escala,
}: {
  points: MapPoint[];
  projection: GeoProjection;
  /** Polígonos del geojson por código de zona (departamento o provincia). */
  poligonosPorZona: Map<string, Feature[]>;
  centroides: Map<string, [number, number]>;
  /** Píxeles de pantalla por unidad del viewBox, con el zoom incluido. */
  escala: number;
}): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const grupos = new Map<string, MapPoint[]>();
  for (const pt of points) {
    if (!pt.zona || !centroides.has(pt.zona)) continue;
    const g = grupos.get(pt.zona) ?? [];
    g.push(pt);
    grupos.set(pt.zona, g);
  }
  for (const [zona, pts] of grupos) {
    const c = centroides.get(zona)!;
    const poligonos = poligonosPorZona.get(zona) ?? [];
    const dentro = (x: number, y: number) => {
      const ll = projection.invert?.([x, y]);
      return !!ll && poligonos.some((f) => geoContains(f as any, ll as [number, number]));
    };
    const paso = 6 / (escala || 1);
    const ok: [number, number][] = [];
    for (let k = 0; ok.length < pts.length && k < 300; k++) {
      const rad = paso * Math.sqrt(k);
      const ang = k * 2.39996;
      const x = c[0] + rad * Math.cos(ang);
      const y = c[1] + rad * Math.sin(ang);
      if (poligonos.length === 0 || dentro(x, y)) ok.push([x, y]);
    }
    if (ok.length === 0) ok.push(c);
    const orden = [...pts].sort((a, b) => (a.grupo?.i ?? 0) - (b.grupo?.i ?? 0));
    orden.forEach((p, i) => out.set(p.id, ok[i] ?? ok[i % ok.length]));
  }
  return out;
}
