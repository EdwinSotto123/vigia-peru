/**
 * Escala del coropleto del mapa. Cinco escalones por **cuantiles**, nunca por
 * `valor / máximo`.
 *
 * Por qué: medido contra `/contratos/geo?nivel=departamento` el 2026-09-22,
 * Lima contrata S/ 5 723 M y Tumbes S/ 25 M. Con la escala lineal que tenía el
 * mapa (`t < 0.2` → escalón más bajo) **21 de los 25 departamentos caían en el
 * mismo escalón**: el país entero se veía de un solo color y el mapa no decía
 * nada. Con cuantiles cada escalón tiene cinco departamentos por construcción,
 * y la leyenda publica los valores de cada corte para que el usuario sepa qué
 * significa cada tono en vez de adivinar "más/menos".
 *
 * Todas las medidas salen de datos reales de la API (`ContratoZona`), en los
 * tres niveles que devuelve `/contratos/geo`. No hay ninguna métrica local.
 */

import type { ContratoZona } from "@/lib/contratos";

export type MedidaId = "monto" | "contratos" | "cola" | "leidos" | "senales";

export interface Medida {
  id: MedidaId;
  /** Etiqueta del control (corta: entra en la barra de filtros). */
  label: string;
  /** Qué se está pintando, en palabras, para el encabezado del mapa. */
  titulo: string;
  /** Una línea que explica el dato y de dónde sale. */
  ayuda: string;
  valor: (z: ContratoZona) => number;
  /** Formato compacto para la leyenda y el popover. */
  formato: (n: number) => string;
  /** Sustantivo para el popover: "892 en cola". */
  sustantivo: (n: number) => string;
}

const enteros = (n: number) => n.toLocaleString("es-PE");

/** S/ 5 723 M · S/ 196 M · S/ 840 mil — los montos del mapa van redondeados. */
export function formatoSoles(n: number): string {
  if (n >= 1_000_000_000) return `S/ ${(n / 1_000_000_000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} mil M`;
  if (n >= 1_000_000) return `S/ ${(n / 1_000_000).toLocaleString("es-PE", { maximumFractionDigits: 0 })} M`;
  if (n >= 1_000) return `S/ ${(n / 1_000).toLocaleString("es-PE", { maximumFractionDigits: 0 })} mil`;
  return `S/ ${enteros(Math.round(n))}`;
}

export const MEDIDAS: Medida[] = [
  {
    id: "monto",
    label: "Monto",
    titulo: "Monto contratado",
    ayuda: "Suma de lo contratado en los expedientes del SEACE ingresados, por zona.",
    valor: (z) => z.montoPen ?? 0,
    formato: formatoSoles,
    sustantivo: (n) => `${formatoSoles(n)} contratados`,
  },
  {
    id: "contratos",
    label: "Contratos",
    titulo: "Contratos ingresados",
    ayuda: "Expedientes descargados de la API OCDS del OECE, sin importar su estado.",
    valor: (z) => z.total ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} contrato${n === 1 ? "" : "s"} ingresados`,
  },
  {
    id: "cola",
    label: "En cola",
    titulo: "Contratos en cola de lectura",
    ayuda: "Contratos cuyo tipo y etapa ya tienen análisis activo: se pueden financiar hoy.",
    valor: (z) => z.enCola ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} en cola`,
  },
  {
    id: "leidos",
    label: "Leídos",
    titulo: "Contratos leídos por los agentes",
    ayuda: "Contratos con el pipeline completo corrido y dictamen guardado.",
    valor: (z) => z.procesados ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} leído${n === 1 ? "" : "s"}`,
  },
  {
    id: "senales",
    label: "Con señal",
    titulo: "Contratos con señal publicada",
    ayuda: "Leídos cuyo dictamen publicado trae al menos una señal de riesgo con norma citada.",
    valor: (z) => z.conSenales ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} con señal`,
  },
];

export const medidaPorId = (id: MedidaId): Medida => MEDIDAS.find((m) => m.id === id) ?? MEDIDAS[0];

/**
 * Rampa secuencial cálida (tokens `warm1`…`warm5` de tailwind.config).
 * `warm0` queda fuera de la rampa: es el color de **sin dato**, y además va
 * rayado, porque un tono más claro dentro de la misma rampa se lee como
 * "poco", no como "no sabemos". Ese era el defecto de la escala anterior:
 * `pendiente #D9DEE4` y `sin_datos #EEF1F4` eran el mismo gris (ΔE 5,8).
 */
export const RAMPA = ["#D9B97A", "#C28840", "#A05A1F", "#7A2E18", "#4A150C"] as const;
export const SIN_DATO = "#E8DFC7";
export const ESCALONES = RAMPA.length;

/**
 * Cortes por cuantil sobre los valores presentes. Devuelve como máximo
 * `ESCALONES - 1` cortes; si hay empates (p. ej. muchos ceros) se colapsan,
 * y la escala queda con menos escalones en vez de fingir que los distingue.
 */
export function cortesPorCuantil(valores: number[], escalones = ESCALONES): number[] {
  const v = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length < 2) return [];
  const cortes: number[] = [];
  for (let i = 1; i < escalones; i++) {
    const idx = Math.min(v.length - 1, Math.floor((i / escalones) * v.length));
    const c = v[idx];
    if (cortes.length === 0 ? c > v[0] : c > cortes[cortes.length - 1]) cortes.push(c);
  }
  return cortes;
}

/** Índice de escalón (0 … cortes.length) de un valor dentro de la escala. */
export function escalonDe(valor: number, cortes: number[]): number {
  for (let i = 0; i < cortes.length; i++) if (valor < cortes[i]) return i;
  return cortes.length;
}

export interface Escala {
  cortes: number[];
  min: number;
  max: number;
  /** Colores efectivamente en uso (tantos como escalones reales). */
  colores: string[];
  /** Límites [desde, hasta] de cada escalón, para rotular la leyenda con números. */
  tramos: { desde: number; hasta: number; color: string }[];
  color: (valor: number | null | undefined) => string;
  vacia: boolean;
}

/** Construye la escala completa a partir de los valores reales de las zonas visibles. */
export function construirEscala(valores: number[]): Escala {
  const limpios = valores.filter((n) => Number.isFinite(n));
  const cortes = cortesPorCuantil(limpios);
  const min = limpios.length ? Math.min(...limpios) : 0;
  const max = limpios.length ? Math.max(...limpios) : 0;
  const n = cortes.length + 1;
  // Con menos de 5 escalones reales se usan los tonos de los extremos hacia
  // adentro, así el más oscuro siempre significa "lo más alto que hay".
  const colores = RAMPA.slice(RAMPA.length - n);
  const tramos = colores.map((color, i) => ({
    desde: i === 0 ? min : cortes[i - 1],
    hasta: i === colores.length - 1 ? max : cortes[i],
    color,
  }));
  return {
    cortes,
    min,
    max,
    colores: [...colores],
    tramos,
    vacia: limpios.length === 0,
    color: (valor) => (valor == null ? SIN_DATO : colores[escalonDe(valor, cortes)] ?? SIN_DATO),
  };
}
