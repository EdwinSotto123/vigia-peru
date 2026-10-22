/**
 * Lo que Vigía sabe de cada contrato de una lista, por su ocid: estado de lectura, peso del riesgo, cuántas señales
 * y los antecedentes del ganador (cada tipo una vez, con su severidad más alta). Lo usan la lista de contratos
 * (/contratos) y las de procesos de un partido y de una entidad, para que las tres muestren las mismas banderas.
 *
 * Son subconsultas por fila: van sobre una página YA recortada (`pag`), nunca sobre la lista entera.
 */

/** Banderas (señales) de la alerta de cada fila; necesita `ce` (contrato_estado) en el FROM. */
export const BANDERAS_DE_FILA = `LEFT JOIN LATERAL (SELECT count(*) AS n FROM banderas b WHERE b.alerta_id = ce.alerta_id) b ON TRUE`;

/** Cruces de los ganadores (migración 57): cada tipo una vez, con su severidad más alta; null si no hay. */
export const crucesDeFila = (ocid: string) => `LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('tipo', t.tipo, 'severidad', (ARRAY['alta', 'media', 'baja'])[t.r + 1]) ORDER BY t.r, t.tipo) AS cruces
      FROM (SELECT x->>'tipo' AS tipo, min(CASE x->>'severidad' WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS r
              FROM casos_cruce k, jsonb_array_elements(k.cruces) x WHERE k.ocid = ${ocid} GROUP BY 1) t
  ) kc ON TRUE`;

/**
 * Posible error de carga del OECE (migración 102, `contrato_dudoso`): lo adjudicado es 20 veces o más el valor
 * referencial, o el referencial es S/ 1 o menos. `{ motivo, referencial, adjudicado }` o null; necesita `cdu` en el FROM.
 */
export const COL_DUDOSO = `CASE WHEN cdu.ocid IS NULL THEN NULL ELSE jsonb_build_object('motivo', cdu.motivo, 'referencial', cdu.referencial::float,
  'adjudicado', cdu.adjudicado::float) END AS "datoDudoso"`;
export const joinDudoso = (ocid: string) => `LEFT JOIN contrato_dudoso cdu ON cdu.ocid = ${ocid}`;

/** Las columnas, con los mismos nombres que la fila de /contratos (la web usa los mismos chips). Sin ocid, todo null. */
export const COLS_ESTADO_FILA = `ce.estado_proc AS "estadoProcesamiento", ce.operativo AS "estadoOperativo", ce.score,
  CASE WHEN ce.ocid IS NULL THEN NULL WHEN ce.alerta_id IS NULL OR alerta_publicada(ce.alerta_estado) THEN COALESCE(b.n, 0)::int END AS banderas,
  COALESCE(ce.alerta_estado = 'revision', false) AS "enRevision", kc.cruces, ${COL_DUDOSO}`;

/** Los JOIN para COLS_ESTADO_FILA de una lista cuyo ocid puede faltar (procesos del OECE que no están en la base). */
export const joinsEstadoFila = (ocid: string) => `LEFT JOIN contrato_estado ce ON ce.ocid = ${ocid}
  ${BANDERAS_DE_FILA}
  ${crucesDeFila(ocid)}
  ${joinDudoso(ocid)}`;
