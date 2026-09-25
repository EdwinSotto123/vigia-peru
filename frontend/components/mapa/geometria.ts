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
 * Qué nombres de departamento se imprimen sobre el mapa.
 *
 * Colocación codiciosa por prioridad, que es como resuelve esto cualquier motor
 * de rotulación: se ordenan los nombres por importancia —el escalón de la medida
 * activa, derivado del relleno— y se van colocando; el que choca con uno ya
 * colocado no se imprime. Sin esto había tres solapamientos medidos
 * (Cajamarca×Lambayeque, Ayacucho×Apurímac y Callao×Lima).
 *
 * Lo que no se imprime no se pierde: el nombre y las cifras están en la ficha
 * flotante al pasar por encima o al llegar con Tab.
 */
export function colocarEtiquetas(deptPaths: DeptPath[], regiones: Record<string, ZonaPintada>, fitScale: number): Set<string> {
  if (!deptPaths.length) return new Set<string>();
  const nivel = (u: string) => nivelDeEtiqueta(regiones[u]?.color ?? "#FFFFFF");
  const prioridad = (u: string) => (nivel(u) === "alto" ? 0 : nivel(u) === "medio" ? 1 : 2);
  // Tamaños nominales en unidades de viewBox (sin el factor de pantalla: acá
  // sólo importan las proporciones entre etiquetas, no su tamaño final).
  const tam = (u: string) => (nivel(u) === "alto" ? 14 : nivel(u) === "medio" ? 12 : 10);
  const candidatos = deptPaths
    .filter((p) => p.ubigeo !== "07")
    .sort((a, b) => prioridad(a.ubigeo) - prioridad(b.ubigeo) || a.name.localeCompare(b.name, "es"));

  const colocadas: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const visibles = new Set<string>();
  for (const p of candidatos) {
    const f = tam(p.ubigeo) / (fitScale || 1);
    const w = p.name.length * f * 0.52;
    const h = f * 1.1;
    const [cx, cy] = p.centroid;
    const caja = { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
    // ¿Entra en su propio departamento?
    if (w > (p.bounds[1][0] - p.bounds[0][0]) * 1.15) continue;
    // ¿Choca con alguna ya colocada?
    if (colocadas.some((c) => caja.x1 < c.x2 && caja.x2 > c.x1 && caja.y1 < c.y2 && caja.y2 > c.y1)) continue;
    colocadas.push(caja);
    visibles.add(p.ubigeo);
  }
  return visibles;
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
