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
