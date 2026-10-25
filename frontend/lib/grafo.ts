/**
 * Helpers compartidos de los grafos del mapa de poder (components/grafo, components/entidad/*Viz/Explorador*).
 * Antes cada grafo reimplementaba corto/rad/ángulos/anchor/radio: acá viven una sola vez. Sólo lógica, sin JSX
 * ni clases de color (los colores son tokens y se arman en los primitivos, components/grafo/primitivos.tsx).
 */
import { tituloNatural } from "@/lib/landing";

/** Lienzo cuadrado por defecto de los radiales (viewBox 0 0 VB VB) y su centro. */
export const VB = 1000;
export const C = VB / 2;

export const rad = (grados: number) => (grados * Math.PI) / 180;

/** Título natural recortado a n caracteres con elipsis. La forma repetida en 9 grafos. */
export function corto(s: string, n: number): string {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Ángulo (en grados) del i-ésimo de N nodos repartidos en un anillo; arranca arriba (-90). */
export const anguloEnAnillo = (i: number, n: number, desde = -90) => desde + (i * 360) / Math.max(n, 1);

/** Radio del nodo por raíz del valor (área ~ valor), acotado. El patrón de todos los radiales. */
export const radioPorRaiz = (valor: number, max: number, base: number, k: number) =>
  base + k * Math.sqrt(Math.max(valor, 0) / Math.max(max, 1));

/** Ancla del rótulo según de qué lado del centro cae el nodo (coseno del ángulo). */
export const anchorDeCos = (cosAng: number): "start" | "end" => (cosAng >= 0 ? "start" : "end");

/** Un lazo «fuerte»: la empresa financió al partido que gobierna o tiene un socio contratado por la entidad. */
export const esLazoFuerte = (lazos: string[]) =>
  lazos.includes("partido_gobernante") || lazos.includes("socio_en_entidad");

/** Texto humano de un tipo de lazo empresa↔partido/entidad. */
export const etiquetaLazo = (l: string) =>
  l === "partido_gobernante" ? "financió al partido que gobierna"
    : l === "vendio_gobernante" ? "le vendió a la campaña"
    : l === "socio_en_entidad" ? "socio contratado por esta entidad"
    : l;

/** Nivel de gobierno de una entidad territorial, en palabras. */
export const nivelTxt = (n: string) =>
  n === "regional" ? "Gobierno regional"
    : n === "provincial" ? "Municipalidad provincial"
    : n === "distrital" ? "Municipalidad distrital"
    : n;
