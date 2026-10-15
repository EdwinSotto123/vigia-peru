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
 * Objeto de contratación tal como lo escribe la entidad, sin el rótulo del formulario
 * ("DENOMINACIÓN DEL REQUERIMIENTO:", "OBJETO DE LA CONTRATACIÓN:") ni los "¿" que el SEACE deja
 * donde iban comillas tipográficas (“…”): si el texto no trae ningún "?", un "¿" no es una pregunta.
 */
export function limpiarObjeto(texto: string): string {
  let t = texto.replace(/\s+/g, " ").trim();
  t = t.replace(/^(DENOMINACI[OÓ]N|OBJETO|NOMBRE|DESCRIPCI[OÓ]N)( DEL?| DE LA)? (REQUERIMIENTO|CONTRATACI[OÓ]N|PROCESO|SERVICIO|BIEN|OBRA)\s*:\s*/i, "");
  if (!t.includes("?")) t = t.replace(/\s*¿\s*/g, " ").replace(/\s+/g, " ").trim();
  return t.replace(/^["'“”\s]+|["'“”\s]+$/g, "") || texto;
}
