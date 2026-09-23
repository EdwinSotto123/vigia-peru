/**
 * Cómo se cuentan los análisis publicados por nivel de riesgo, en UN solo lugar.
 *
 * /app/convocatoria mostraba dos recuentos del mismo listado que no cuadraban:
 * el panel lateral contaba "media" como "tiene al menos una señal media" (52)
 * y la lista de abajo como "tiene alguna señal media o alta" (70). Ninguno de
 * los dos era el nivel de riesgo del contrato, que es lo que pinta la franja
 * de color de cada tarjeta.
 *
 * Ahora las dos vistas cuentan lo mismo: el nivel que sale del puntaje del
 * contrato con los cortes únicos de lib/severidad (alto ≥ 70, medio 40 a 69,
 * bajo < 40). El filtro por nivel usa esta misma función, así que el número
 * del chip es exactamente lo que queda al filtrar.
 */

import { CORTE_ALTA, CORTE_MEDIA, nivelDeScore, type NivelSeveridad } from "@/lib/severidad";

export type NivelAnalisis = Exclude<NivelSeveridad, "sin_analizar">;

/** Nivel de riesgo de un análisis de la lista, por su puntaje. `null` si no trae puntaje. */
export function nivelDeAnalisis(it: { score?: number | null }): NivelAnalisis | null {
  const n = nivelDeScore(it?.score ?? null);
  return n === "sin_analizar" ? null : n;
}

export interface ConteoRiesgo {
  total: number;
  alta: number;
  media: number;
  baja: number;
}

export function contarPorNivel(items: Array<{ score?: number | null }>): ConteoRiesgo {
  const c: ConteoRiesgo = { total: items.length, alta: 0, media: 0, baja: 0 };
  for (const it of items) {
    const n = nivelDeAnalisis(it);
    if (n) c[n]++;
  }
  return c;
}

/** Rótulos de los tres niveles, con el rango de puntaje que cubre cada uno. */
export const NIVEL_ANALISIS: Record<NivelAnalisis, { etiqueta: string; rango: string }> = {
  alta: { etiqueta: "Riesgo alto", rango: `puntaje ${CORTE_ALTA} o más` },
  media: { etiqueta: "Riesgo medio", rango: `puntaje ${CORTE_MEDIA} a ${CORTE_ALTA - 1}` },
  baja: { etiqueta: "Riesgo bajo", rango: `puntaje menor a ${CORTE_MEDIA}` },
};

/** Clases de la franja de puntaje: tokens de lib/severidad, texto oscuro sobre fondo suave. */
export const FRANJA_NIVEL: Record<NivelAnalisis | "sin", string> = {
  alta: "bg-crimson-soft text-crimsonTexto",
  media: "bg-amber-soft text-amberTexto",
  baja: "bg-moss/10 text-mossTexto",
  sin: "bg-paperDeep text-mute",
};

/** Duración mediana de una lectura, en palabras ("unos 4 minutos"). `null` si no hay dato. */
export function duracionEnPalabras(seg: number | null | undefined): string | null {
  if (seg == null || !Number.isFinite(seg) || seg <= 0) return null;
  if (seg < 60) return "menos de un minuto";
  const min = Math.round(seg / 60);
  return min === 1 ? "alrededor de un minuto" : `unos ${min} minutos`;
}
