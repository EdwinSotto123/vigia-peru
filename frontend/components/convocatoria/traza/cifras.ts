/**
 * Cómo se escriben las cifras propias de la traza. Dólares con tres decimales en toda la
 * pestaña (DESIGN_SYSTEM.md §10.3: un solo formato por columna): el costo de un agente suele
 * ser de milésimas y con dos decimales media tabla se leería "US$ 0.01".
 */

const USD = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const usd = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? `US$ ${USD.format(n)}` : "Sin dato";

/** Etiqueta de la rama de un nodo, para su chip. */
export const RAMA_LABEL: Record<string, string> = {
  inicio: "Arranque",
  reglas: "Rama de las reglas",
  expediente: "Rama del expediente",
  proveedor: "Rama del proveedor",
  sintesis: "Síntesis",
  control: "Control de calidad",
};

/**
 * El orden de las ramas del recorrido (el del DAG de backend/agent/deterministic.py) y su color de serie: el resumen de
 * la corrida reparte el costo por rama en una barra segmentada y cada caja del grafo lleva el cuadrito del mismo color.
 */
export const ORDEN_RAMAS = ["inicio", "reglas", "expediente", "proveedor", "sintesis", "control"] as const;
export const indiceRama = (rama: string): number => Math.max(0, ORDEN_RAMAS.indexOf(rama as (typeof ORDEN_RAMAS)[number]));
