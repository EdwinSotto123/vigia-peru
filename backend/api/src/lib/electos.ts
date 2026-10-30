/**
 * Autoridades electas: quien es o fue autoridad (jne_autoridades) o ganó una elección (jne_candidaturas con resultado
 * «electo»). Su nombre es público y va completo en todo Vigía (decisión del usuario, 2026-10-30); el resto de las
 * personas naturales sale con un apellido tapado (lib/privacidad.ts). La respuesta marca a esa persona con
 * `electo: true` junto a su nombre y publicar() no se lo tapa.
 *
 * En SQL, como `IN (subconsulta)`: Postgres la resuelve una sola vez por consulta (hashed SubPlan) aunque la lista tenga
 * mil filas; jne_autoridades no tiene índice por DNI.
 */
export function esElectoSql(columnaDni: string): string {
  return `(${columnaDni} IN (SELECT dni FROM jne_autoridades WHERE dni IS NOT NULL)
           OR ${columnaDni} IN (SELECT numero_documento FROM jne_candidaturas WHERE resultado = 'electo' AND numero_documento IS NOT NULL))`;
}

/** `{ electo: true }` para esparcir junto al nombre, o nada. */
export function marcaElecto(electo: unknown): { electo?: true } {
  return electo === true ? { electo: true } : {};
}
