/**
 * Una línea JSON por registro con `severity`, como el dispatcher. Workers Logs indexa los campos del
 * JSON: se puede filtrar por `fuente` o `instancia`.
 */

export type Nivel = "INFO" | "WARNING" | "ERROR";

export function registrar(nivel: Nivel, mensaje: string, extra: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ severity: nivel, message: mensaje, logger: "scrapers", ...extra });
  if (nivel === "ERROR") console.error(linea);
  else if (nivel === "WARNING") console.warn(linea);
  else console.log(linea);
}
