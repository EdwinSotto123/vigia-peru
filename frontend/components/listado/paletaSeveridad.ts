import type { CSSProperties } from "react";
import { colorSerie, type ParteBarra } from "@/components/charts/BarraSegmentada";
import { porcentaje } from "@/lib/formato";

/**
 * La gravedad como color en un reparto (las personas por su señal más grave, las empresas por su antecedente más grave) y
 * en los chips de la barra de filtros que le sirven de leyenda (`OpcionFaceta.muestra`). Antes la paleta y la cuota
 * vivían copiadas en ListaPersonas y ListaEmpresas, y los chips no llevaban color: no se veía qué parte de la barra era
 * cada uno (auditoría del 2026-11-05). Server-safe.
 */

export type Gravedad = "alta" | "media" | "baja";

/**
 * El token de cada gravedad, como canales (los de `rgb(var(--…))`): alta en rojo, media en ámbar, baja en gris medio. Lo
 * que no tiene ninguna («sin señales», «sin antecedentes») va en el gris claro de «Otros» de la barra (`"otros"`).
 */
const TOKEN_GRAVEDAD: Record<Gravedad, string> = { alta: "var(--crimson)", media: "var(--amber)", baja: "var(--mute)" };

/** El color de un cuadrito: una serie por su lugar en la barra (`colorSerie`), «otros», o una gravedad. */
export type MuestraColor = number | "otros" | Gravedad;

export const colorMuestra = (m: MuestraColor): string =>
  typeof m === "number" || m === "otros" ? colorSerie(m) : `rgb(${TOKEN_GRAVEDAD[m]})`;

const esGravedad = (c: string): c is Gravedad => c === "alta" || c === "media" || c === "baja";

/**
 * La paleta de series apuntada a la gravedad, sólo dentro del reparto (va en el `style` de su envoltorio):
 * `BarraSegmentada` y `MuestraSerie` pintan por el LUGAR de cada parte (--serie-1, --serie-2…), así que cada lugar recibe
 * el token de la gravedad que de verdad está ahí, por su `clave` («alta», «media», «baja»). Las partes en cero no se
 * pasan (la barra les daría una astilla de 3 px), y sin esta cuenta la media de una lista sin altas saldría en rojo.
 * Fuera de ese bloque las series siguen siendo las de siempre; un chip que hace de leyenda usa `colorMuestra` con la
 * misma gravedad y sale del mismo color.
 */
export const paletaGravedad = (visibles: ParteBarra[]): CSSProperties =>
  Object.fromEntries(visibles.map((p, i) => [`--serie-${i + 1}`, esGravedad(p.clave) ? TOKEN_GRAVEDAD[p.clave] : "var(--mute)"])) as CSSProperties;

/** La parte de un total, «menos de 1 %» y no «0 %»: una parte que existe nunca se lee como nada. */
export const cuotaDe = (n: number, total: number): string => {
  const p = total ? (n / total) * 100 : 0;
  return p > 0 && p < 1 ? `menos de ${porcentaje(1)}` : porcentaje(p);
};
