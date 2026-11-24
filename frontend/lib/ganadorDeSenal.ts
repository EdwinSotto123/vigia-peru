/**
 * De cuál ganador habla una señal, en un proceso con varios ganadores (uno por ítem). El dictamen evalúa al proveedor
 * de a uno y la señal decía «El proveedor que ganó» sin decir cuál: en 2026-2543-197 (EsSalud, 8 ganadores en 11 ítems)
 * «RUC del ganador muy reciente» era de Hamuq Farma, que ganó el ítem 3, y la cabecera nombraba a otro. Pedido del
 * usuario del 2026-11-24.
 *
 * Se busca primero su RUC en el texto de la señal y, si no está, el núcleo de su nombre (sin la forma societaria). Si
 * lo nombran dos o ninguno, null: no se adivina.
 */

export interface GanadorDeItems {
  ruc: string | null;
  nombre: string | null;
  /** Los números de ítem que ganó (su posición en el registro). */
  items: number[];
}

const FORMAS = /\b(S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?\s?A\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?|SOCIEDAD ANONIMA( CERRADA| ABIERTA)?|SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA|EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA|SUCURSAL( DEL PERU)?|CORPORACION|LABORATORIOS?|INVERSIONES|GRUPO)\b/g;

const normal = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9&• ]+/g, " ").replace(/\s+/g, " ").trim();

/** Las dos primeras palabras de su nombre sin la forma societaria ni palabras genéricas: «HAMUQ FARMA», «AC FARMA». */
export function nucleoDelNombre(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const limpio = normal(normal(nombre).replace(FORMAS, " ")).split(" - ")[0];
  const palabras = limpio.split(" ").filter((p) => p.length > 1 && !p.includes("•"));
  const nucleo = palabras.slice(0, 2).join(" ");
  return nucleo.length >= 5 ? nucleo : null;
}

/** El ganador del que habla `texto`, o null si no se puede decir (ninguno o más de uno). */
export function ganadorDeLaSenal(texto: string | null | undefined, ganadores: GanadorDeItems[]): GanadorDeItems | null {
  if (!texto || ganadores.length < 2) return null;
  const porRuc = ganadores.filter((g) => g.ruc && texto.includes(g.ruc));
  if (porRuc.length === 1) return porRuc[0];
  if (porRuc.length > 1) return null;
  const t = ` ${normal(texto)} `;
  const porNombre = ganadores.filter((g) => {
    const n = nucleoDelNombre(g.nombre);
    return !!n && t.includes(` ${n} `);
  });
  return porNombre.length === 1 ? porNombre[0] : null;
}

/** «ganó el ítem 3», «ganó los ítems 4, 10 y 13» (vacío si no se saben sus ítems). */
export function itemsGanados(items: number[]): string {
  const xs = [...new Set(items)].sort((a, b) => a - b);
  if (!xs.length) return "";
  if (xs.length === 1) return `ganó el ítem ${xs[0]}`;
  return `ganó los ítems ${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}
