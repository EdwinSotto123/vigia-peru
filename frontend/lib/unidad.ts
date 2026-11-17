/**
 * La unidad comparable, como `unidad_norm` de la base (migración 338): «GALONES», «gal» y «GLN» → «galon»; «Kg» →
 * «kilogramo». Lo demás («BALDE DE 05 GALONES») queda tal cual, en minúsculas y sin tildes: es otra unidad.
 */
export function unidadNorm(t: string | null | undefined): string | null {
  const u = (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!u) return null;
  if (/^(gal|gln|gl)(on|ones)?$/.test(u)) return "galon";
  if (/^(kg|kgs|kilo|kilos|kilogramos?)$/.test(u)) return "kilogramo";
  if (/^(l|lt|lts|litros?)$/.test(u)) return "litro";
  if (/^(und|unid|unidad|unidades|u|un|pza|pieza|piezas)$/.test(u)) return "unidad";
  if (/^(caja|cajas|cja)$/.test(u)) return "caja";
  if (/^(paquete|paquetes|paq|pqte)$/.test(u)) return "paquete";
  return u;
}

/** ¿Se comparan dos precios por unidad? Sólo en la misma unidad. */
export const mismaUnidad = (a: string | null | undefined, b: string | null | undefined) => {
  const x = unidadNorm(a), y = unidadNorm(b);
  return !!x && x === y;
};
