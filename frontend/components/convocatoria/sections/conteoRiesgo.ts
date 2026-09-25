/**
 * Cómo se cuentan los análisis publicados por nivel, en UN solo lugar.
 *
 * /app/convocatoria mostraba dos recuentos del mismo listado que no cuadraban:
 * el panel lateral contaba "media" como "tiene al menos una señal media" (52)
 * y la lista de abajo como "tiene alguna señal media o alta" (70). Ninguno de
 * los dos era el nivel del contrato, que es lo que pinta la franja de color de
 * cada tarjeta. Ahora las dos vistas cuentan lo mismo, y el filtro por nivel usa
 * esta misma función: el número del chip es exactamente lo que queda al filtrar.
 *
 * Las palabras son las de DESIGN_SYSTEM.md §10.1:
 *  · "Sin señales": leído y publicado sin ninguna señal (verde, el único "positivo");
 *  · peso del riesgo "Riesgo alto · medio · bajo": el tramo del puntaje (cortes únicos
 *    de lib/severidad), y SÓLO si hay señales. Un contrato con señales y puntaje bajo
 *    ya no sale con el verde de "sin señal relevante" (auditoría de coherencia, P1).
 * Palabras y tonos salen de lib/severidad, los mismos que usan las listas de contratos.
 */

import { CORTE_ALTA, CORTE_MEDIA, nivelDeScore, SEVERIDAD, SIN_SENALES, type SeveridadUI } from "@/lib/severidad";

export type NivelAnalisis = "alta" | "media" | "baja" | "sin_senales";

/**
 * Nivel de un análisis de la lista. Sin señales publicadas (`n_banderas === 0`) es
 * "sin_senales" aunque traiga un puntaje; con señales, el tramo de su puntaje.
 * `null` si no trae ni conteo de señales ni puntaje.
 */
export function nivelDeAnalisis(it: { score?: number | null; n_banderas?: number | null }): NivelAnalisis | null {
  // Como severidadDeContrato (lib/severidad): 0 señales publicadas, o puntaje 0, es "sin señales".
  if (typeof it?.n_banderas === "number" && it.n_banderas === 0) return "sin_senales";
  if (it?.score === 0) return "sin_senales";
  const n = nivelDeScore(it?.score ?? null);
  return n === "sin_analizar" ? null : n;
}

export interface ConteoRiesgo {
  total: number;
  alta: number;
  media: number;
  baja: number;
  sin_senales: number;
}

export function contarPorNivel(items: Array<{ score?: number | null; n_banderas?: number | null }>): ConteoRiesgo {
  const c: ConteoRiesgo = { total: items.length, alta: 0, media: 0, baja: 0, sin_senales: 0 };
  for (const it of items) {
    const n = nivelDeAnalisis(it);
    if (n) c[n]++;
  }
  return c;
}

/** Orden en que se muestran los niveles (chips, panel lateral). */
export const NIVELES: NivelAnalisis[] = ["alta", "media", "baja", "sin_senales"];

/** Rótulos de cada nivel, con lo que cubre cada uno. */
export const NIVEL_ANALISIS: Record<NivelAnalisis, { etiqueta: string; rango: string }> = {
  alta: { etiqueta: "Riesgo alto", rango: `con señales y puntaje ${CORTE_ALTA} o más` },
  media: { etiqueta: "Riesgo medio", rango: `con señales y puntaje ${CORTE_MEDIA} a ${CORTE_ALTA - 1}` },
  baja: { etiqueta: "Riesgo bajo", rango: `con señales y puntaje menor a ${CORTE_MEDIA}` },
  sin_senales: { etiqueta: SIN_SENALES.etiqueta, rango: "leídos y publicados sin ninguna señal" },
};

/**
 * Color, ícono y palabra de cada nivel, de lib/severidad: el tramo con señales lleva los tonos
 * de severidad y la palabra del peso del riesgo ("Riesgo alto"); "Sin señales" es el único verde.
 */
export const UI_NIVEL: Record<NivelAnalisis, SeveridadUI> = {
  alta: { ...SEVERIDAD.alta, etiqueta: NIVEL_ANALISIS.alta.etiqueta },
  media: { ...SEVERIDAD.media, etiqueta: NIVEL_ANALISIS.media.etiqueta },
  baja: { ...SEVERIDAD.baja, etiqueta: NIVEL_ANALISIS.baja.etiqueta },
  sin_senales: SIN_SENALES,
};

/** Duración mediana de una lectura, en palabras ("unos 4 minutos"). `null` si no hay dato. */
export function duracionEnPalabras(seg: number | null | undefined): string | null {
  if (seg == null || !Number.isFinite(seg) || seg <= 0) return null;
  if (seg < 60) return "menos de un minuto";
  const min = Math.round(seg / 60);
  return min === 1 ? "alrededor de un minuto" : `unos ${min} minutos`;
}
