/**
 * Recorta un texto en el último espacio antes de `max`, nunca a mitad de palabra,
 * y le pone "…".
 *
 * Para objetos de contratación en filas de una línea (§10.7): la fila ya los
 * corta con CSS, pero el texto entero seguía en el DOM —títulos de 300
 * caracteres que el lector de la página cuenta como párrafos—. Quien lo use pone
 * el texto completo en `title` y lo muestra entero en el detalle: lo que se corta
 * aquí nunca es la única copia del dato.
 */
export function recortar(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const i = c.lastIndexOf(" ");
  return `${(i > max * 0.5 ? c.slice(0, i) : c).replace(/[\s,.;:(-]+$/, "")}…`;
}

/**
 * Un par «¿texto¿» que el SEACE dejó donde iban comillas tipográficas (“texto”): el que abre no va pegado a una letra
 * o una cifra («CAMPA¿A» es una ñ perdida, no una comilla) y el que cierra va pegado al final de una palabra y no a la
 * siguiente. Sin «?» ni otro «¿» adentro: «¿Qué es?» es una pregunta de verdad.
 */
const PAR_DE_COMILLAS = /(?<![\p{L}\d])¿(?=\S)([^¿?]*?[^\s¿?])¿(?![\p{L}\d])/gu;

/**
 * Objeto de contratación tal como lo escribe la entidad, sin el rótulo del formulario
 * ("DENOMINACIÓN DEL REQUERIMIENTO:", "OBJETO DE LA CONTRATACIÓN:") ni los "¿" que el SEACE deja
 * donde iban comillas tipográficas (“…”): un par «¿texto¿» vuelve a ser “texto” (2026-10-27: «AMPLIACIÓN MARGINAL
 * ¿CONSTRUCCIÓN DE BUZÓN…DE AREQUIPA¿, CUI 2679367» se leía con dos signos de pregunta), aunque el texto traiga un "?"
 * en otro lado; y si el texto no trae ningún "?", un "¿" suelto no es una pregunta y se quita. Tampoco los saltos de
 * línea que el SEACE manda escritos como texto (`\n`, `\t`): la base ya los limpia (migración 61), esto cubre lo que
 * llegue antes de la próxima carga.
 */
export function limpiarObjeto(texto: string): string {
  let t = texto.replace(/\\[nrt]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(DENOMINACI[OÓ]N|OBJETO|NOMBRE|DESCRIPCI[OÓ]N)( DEL?| DE LA)? (REQUERIMIENTO|CONTRATACI[OÓ]N|PROCESO|SERVICIO|BIEN|OBRA)\s*:\s*/i, "");
  // Las comillas de la fuente que envuelven todo el texto, primero: así no se come la que cierra un “…” del final.
  t = t.replace(/^["'“”\s]+|["'“”\s]+$/g, "");
  t = t.replace(PAR_DE_COMILLAS, "“$1”");
  if (!t.includes("?")) t = t.replace(/\s*¿\s*/g, " ").replace(/\s+/g, " ").trim();
  // Un «·» o «•» de la fuente separando partes («…de Lima"· CUI N.º 2354896»): en palabras, una coma.
  t = t.replace(/(\s*[·•]\s*)+/g, ", ").trim().replace(/^,\s*|\s*,$/g, "");
  // Lo que dejó un «¿» quitado delante de una coma («AREQUIPA , CUI»), y un “…” que envuelve todo el texto.
  t = t.replace(/\s+([,;:])/g, "$1").replace(/^“([^“”]*)”$/, "$1").trim();
  return t || texto;
}
