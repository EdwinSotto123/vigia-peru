/**
 * Una línea JSON por registro con `severity` (lo que hace _FormatoJson en main.py para Cloud
 * Logging). Workers Logs indexa los campos del JSON: se puede filtrar por `worker` u `ocid`.
 */

export type Nivel = "INFO" | "WARNING" | "ERROR";

export function registrar(nivel: Nivel, mensaje: string, extra: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ severity: nivel, message: mensaje, logger: "dispatcher", ...extra });
  if (nivel === "ERROR") console.error(linea);
  else if (nivel === "WARNING") console.warn(linea);
  else console.log(linea);
}
