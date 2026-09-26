/**
 * Cursores de paginación por clave (keyset): tokens opacos base64url de `[tipo, ...claves]`.
 *
 * `tipo` dice a qué orden pertenece el token (un cursor de orden=fecha no sirve para orden=monto) y
 * las claves van como TEXTO tal como las dio la base (`k::text`): node-pg convierte date/timestamptz
 * a Date y pierde los microsegundos, así que se piden como texto y se vuelven a castear en SQL
 * (`$n::date`, `$n::timestamptz`, `$n::numeric`). Tope de 512 caracteres (frontend: CURSOR_RX).
 */

const TOKEN = /^[A-Za-z0-9_-]{1,512}$/;
export const MAX_TOKEN = 512;

export function codificarCursor(tipo: string, claves: unknown[]): string {
  return Buffer.from(JSON.stringify([tipo, ...claves]), "utf8").toString("base64url");
}

/** Las `n` claves del token si es de este `tipo` y tiene la forma esperada; si no, null. */
export function decodificarCursor(token: string, tipo: string, n: number): (string | number | null)[] | null {
  if (!TOKEN.test(token)) return null;
  try {
    const v = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v[0] !== tipo || v.length !== n + 1) return null;
    const claves = v.slice(1);
    if (!claves.every((x) => x === null || typeof x === "string" || typeof x === "number")) return null;
    if (claves.some((x) => typeof x === "string" && x.length > 300)) return null;
    return claves;
  } catch {
    return null;
  }
}
