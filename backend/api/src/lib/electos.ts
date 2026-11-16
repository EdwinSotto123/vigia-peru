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

/**
 * Un cargo de elección popular como lo escribe la DJI, con sus variantes y errores («REGIDOR 4», «REGIGOR», «VICE
 * GOBERNADOR REGIONAL», «CONSEJERA REGIONAL POR …», «CONCEJO MUNICIPAL»). Sobre el texto en mayúsculas y sin tildes. La
 * misma expresión sirve en JavaScript y en Postgres (`~`). Ante la duda, cuenta como electo: lo que se hace con él es
 * reservar datos, no destaparlos.
 */
export const CARGO_DE_ELECCION = String.raw`^\s*(?:EX\s*-?\s*)?(?:TENIENTE\s+)?(?:ALCALD|REGID|REGIGOR|CONCEJAL|CONCEJO MUNICIPAL|GOBERNADOR|GOBERNACION REGIONAL|VICE\s*GOBERNADOR|CONSEJER|CONGRESISTA|DIPUTAD|SENADOR)`;
const CARGO_DE_ELECCION_RE = new RegExp(CARGO_DE_ELECCION);

export function esCargoDeEleccion(cargo: unknown): boolean {
  return typeof cargo === "string" && CARGO_DE_ELECCION_RE.test(cargo.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase());
}

/**
 * ¿El declarante de una DJI es una autoridad electa de esa entidad? (SQL, booleano). Su cargo es de elección, o su nombre
 * es el de una autoridad del JNE del gobierno al que pertenece la entidad (su municipalidad o su gobierno regional), o el
 * de un político cuya DJI se empató en ella (politico_dji, migración 301: el Congreso, el Despacho Presidencial). Es por
 * nombre: un homónimo cuenta como electo, y eso sólo reserva datos de más.
 */
export function declaranteElectoSql(nombre: string, entidad: string, cargo: string): string {
  return `(upper(immutable_unaccent(COALESCE(${cargo}, ''))) ~ '${CARGO_DE_ELECCION}'
    OR EXISTS (SELECT 1 FROM entidad_gobierno_amplia eg JOIN jne_autoridades ja ON ja.ubigeo = eg.ubigeo
                 AND eg.nivel = CASE ja.ambito WHEN 'DISTRITAL' THEN 'distrital' WHEN 'PROVINCIAL' THEN 'provincial' WHEN 'REGIONAL' THEN 'regional' END
                WHERE eg.ruc = ${entidad}::text AND eg.como = 'entidades' AND mef_norm(ja.nombre) = mef_norm(${nombre}))
    OR EXISTS (SELECT 1 FROM politico_dji pd JOIN partido_politico ppe ON ppe.codigo = pd.codigo
                WHERE pd.entidad_ruc = ${entidad}::text AND mef_norm(ppe.nombre) = mef_norm(${nombre})))`;
}
