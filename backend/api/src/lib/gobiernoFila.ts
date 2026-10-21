/**
 * El partido que gobernaba la entidad cuando se convocó cada contrato (contrato_partido, migraciones 41 y 76): el
 * gobierno regional, provincial o distrital de su ubigeo, en el mandato que incluye la fecha de convocatoria. Uno por
 * contrato; null en las entidades sin gobierno electo (ministerios, organismos nacionales) o sin fecha.
 *
 * Es una subconsulta por fila: va sobre una página YA recortada o sobre un solo contrato.
 */
export const gobiernoDeFila = (ocid: string) => `LEFT JOIN LATERAL (
    SELECT cp.org_clave, cp.org_nombre, cp.org_tipo, cp.anio_eleccion, cp.nivel, cp.gobierno_ubigeo, zg.nombre AS lugar
      FROM contrato_partido_tabla cp LEFT JOIN zonas zg ON zg.ubigeo = cp.gobierno_ubigeo
     WHERE cp.ocid = ${ocid} ORDER BY cp.anio_eleccion DESC LIMIT 1
  ) gob ON TRUE`;

/** `gobierno`: { clave, nombre, tipo, anio (de la elección), nivel, ubigeo, lugar } o null. */
export const COL_GOBIERNO = `CASE WHEN gob.org_clave IS NULL THEN NULL ELSE jsonb_build_object(
    'clave', gob.org_clave, 'nombre', gob.org_nombre, 'tipo', gob.org_tipo, 'anio', gob.anio_eleccion,
    'nivel', gob.nivel, 'ubigeo', gob.gobierno_ubigeo, 'lugar', gob.lugar) END AS gobierno`;
