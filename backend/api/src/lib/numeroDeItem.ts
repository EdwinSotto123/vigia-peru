/**
 * El número oficial de un ítem (su posición en el registro) a partir de su descripción. El análisis de mercado numera los
 * ítems por su orden en la lista del OCDS, que no es su número: en 2026-2543-197 (EsSalud) la «atorvastatina 10 mg» salía
 * como ítem 9 (es el 4) y la hidroxocobalamina como 13 (es el 9, desierto). Se cambia el número sólo si la descripción
 * coincide con UN ítem del registro en su nombre y su concentración, con ventaja sobre el segundo. Pedido del usuario del
 * 2026-11-24.
 */

const GENERICAS = new Set([
  "MG", "ML", "MCG", "G", "UI", "TAB", "TABLETA", "TABLETAS", "CAP", "CAPSULA", "CAPSULAS", "INY", "INYECTABLE", "AMP",
  "AMPOLLA", "UNIDAD", "UND", "X", "DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "EN", "CON", "PARA", "POR", "ITEM", "N", "NO",
  "SOLUCION", "SUSPENSION", "FRASCO", "SODICA", "SODIO", "DE", "CITRATO",
]);

/** Las palabras que distinguen un ítem: su nombre y sus números (la concentración), sin unidades ni palabras de forma. */
export function rasgos(descripcion: string | null | undefined): Set<string> {
  const t = String(descripcion ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/ITEM\s*N\W*\s*\d+\s*:?/g, " ")
    .replace(/(\d)[.,](\d)/g, "$1_$2")
    .replace(/[^A-Z0-9_]+/g, " ");
  return new Set(t.split(" ").filter((p) => p && !GENERICAS.has(p) && (p.length >= 4 || /\d/.test(p))));
}

const puntaje = (a: Set<string>, b: Set<string>) => {
  let nombre = 0;
  let cifras = 0;
  for (const x of a) {
    if (!b.has(x)) continue;
    if (/\d/.test(x)) cifras++;
    else nombre++;
  }
  // Sin una palabra del nombre en común no es el mismo ítem (dos tabletas de 10 mg no son lo mismo).
  return nombre ? nombre * 2 + cifras : 0;
};

/** La posición del ítem del registro que corresponde a `descripcion`, o null si no hay una sola coincidencia clara. */
export function posicionPorDescripcion(descripcion: string | null | undefined, items: { posicion: number; descripcion: string | null }[]): number | null {
  const r = rasgos(descripcion);
  if (!r.size) return null;
  const puntos = items.map((it) => ({ pos: it.posicion, p: puntaje(r, rasgos(it.descripcion)) })).sort((a, b) => b.p - a.p);
  const [mejor, segundo] = puntos;
  if (!mejor || mejor.p < 3) return null;
  if (segundo && segundo.p >= mejor.p) return null;
  return mejor.pos;
}
