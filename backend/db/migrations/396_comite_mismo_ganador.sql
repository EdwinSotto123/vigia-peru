-- 396 · El mismo integrante del comité, el mismo ganador (indicador EN OBSERVACIÓN, migración 329).
--
-- Una red de personas que sale de lo que leen los agentes: cada dictamen guarda el comité de selección del acta
-- (`alertas.analisis_full->'document_analysis'->'comite_evaluacion'`), con el nombre, el rol y la cita comprobada en el
-- documento (`evidencia[0].verificada`). Si una misma persona integró el comité en varios procesos de una entidad y la
-- misma empresa ganó la mitad o más de ellos, y esa empresa gana bastante menos en los procesos de la entidad en los que
-- esa persona NO estuvo, la relación entre quien evalúa y quien gana merece mirarse: es el patrón del comité que
-- favorece a un proveedor. No prueba nada: puede ser el único proveedor del rubro, o el comité de un área que compra
-- siempre lo mismo. Por eso se compara con la parte de la empresa SIN esa persona.
--
-- Medido el 2026-11-18: 3 149 procesos con comité leído (crece con el análisis masivo), 5 832 integrantes por entidad;
-- 75 pares persona-empresa con 3 o más adjudicaciones juntas, 35 con la mitad o más de los procesos de esa persona.
--
-- Reglas: nombre completo de 3 palabras o más sin títulos (ING., DR., LIC.…), igual en la misma entidad; cita
-- comprobada; ganador RUC 20 (o cada integrante RUC 20 del consorcio). Sale si la empresa ganó 3 o más de los procesos
-- de esa persona, la mitad o más, y su parte con ella es al menos el doble de su parte sin ella. Media; alta con 5 o más
-- y una parte sin ella de 10 % o menos; baja si la entidad no tiene procesos leídos sin esa persona (sin contraste).
--
-- Privacidad: como en los demás indicadores en observación, del funcionario se muestra sólo su papel en el comité. El
-- nombre NO se guarda en el cruce (`persona_nombre` va vacío) ni la cita literal (lo trae): va `integrante`, una clave
-- estable (md5 de entidad y nombre, 10 caracteres) que permite ver que es la misma persona en varios contratos sin
-- nombrarla. Sin DNI. Del documento, sólo la página y su huella.

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('comite_mismo_ganador', 'Nueva (migración 396): falta medir su precisión con 40 casos revisados a mano.')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_mismo_ganador() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_mismo_ganador');
BEGIN
  -- Cada integrante del comité por proceso, con la cita comprobada en el documento.
  CREATE TEMP TABLE _cm ON COMMIT DROP AS
  SELECT DISTINCT ON (x.ocid, x.clave) x.*
    FROM (
      SELECT a.ocid, btrim(cv.entidad_ruc::text) AS ent,
             btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')) AS clave,
             m->>'nombre_completo' AS nombre, NULLIF(btrim(m->>'rol'), '') AS rol,
             (m->'evidencia'->0->>'pagina')::int AS pagina, m->>'documento_sha256' AS sha
        FROM alertas a
        JOIN convocatorias cv ON cv.ocid = a.ocid
        CROSS JOIN LATERAL jsonb_array_elements(a.analisis_full->'document_analysis'->'comite_evaluacion') m
       WHERE jsonb_typeof(a.analisis_full->'document_analysis'->'comite_evaluacion') = 'array'
         AND jsonb_typeof(m) = 'object'
         AND COALESCE((m->'evidencia'->0->>'verificada')::boolean, false)) x
   WHERE array_length(regexp_split_to_array(x.clave, ' '), 1) >= 3
   ORDER BY x.ocid, x.clave, x.pagina NULLS LAST;
  ANALYZE _cm;

  -- El ganador de cada uno: la empresa, o cada integrante RUC 20 de un consorcio.
  CREATE TEMP TABLE _cg ON COMMIT DROP AS
  SELECT c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM (SELECT DISTINCT ocid FROM _cm) c
    JOIN convocatorias v ON v.ocid = c.ocid
    JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo AND a.entidad_ruc = v.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor);
  ANALYZE _cg;

  -- Los pares persona-empresa: cuántos procesos juntos, de cuántos de esa persona, y la parte de la empresa sin ella.
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH con_ganador AS (SELECT DISTINCT c.ent, c.ocid FROM _cm c WHERE EXISTS (SELECT 1 FROM _cg g WHERE g.ocid = c.ocid)),
       total AS (SELECT ent, count(*) AS total FROM con_ganador GROUP BY ent),
       persona AS (SELECT c.ent, c.clave, count(DISTINCT c.ocid) AS n
                     FROM _cm c JOIN con_ganador p ON p.ocid = c.ocid GROUP BY c.ent, c.clave),
       juntos AS (SELECT c.ent, c.clave, g.ruc, count(DISTINCT c.ocid) AS k
                    FROM _cm c JOIN _cg g ON g.ocid = c.ocid GROUP BY c.ent, c.clave, g.ruc),
       empresa AS (SELECT p.ent, g.ruc, count(DISTINCT p.ocid) AS gana
                     FROM con_ganador p JOIN _cg g ON g.ocid = p.ocid GROUP BY p.ent, g.ruc)
  SELECT j.ent, j.clave, j.ruc, j.k, pe.n, t.total, e.gana,
         round(j.k::numeric / pe.n, 2) AS parte_con,
         CASE WHEN t.total > pe.n THEN round((e.gana - j.k)::numeric / (t.total - pe.n), 2) END AS parte_sin
    FROM juntos j
    JOIN persona pe ON pe.ent = j.ent AND pe.clave = j.clave
    JOIN total t ON t.ent = j.ent
    JOIN empresa e ON e.ent = j.ent AND e.ruc = j.ruc
   WHERE j.k >= 3 AND j.k::numeric / pe.n >= 0.5;
  DELETE FROM _cp WHERE parte_sin IS NOT NULL AND parte_con < 2 * parte_sin;

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_mismo_ganador';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, p.ruc)
         'comite_mismo_ganador', p.ruc, c.ocid,
         CASE WHEN p.parte_sin IS NULL THEN 'baja'
              WHEN p.k >= 5 AND p.parte_sin <= 0.10 THEN 'alta' ELSE 'media' END,
         g.f, g.monto, NULL, NULL, c.rol,
         jsonb_build_object('integrante', left(md5(p.ent || '|' || p.clave), 10), 'veces', p.k, 'procesos_de_la_persona', p.n, 'parte_con_la_persona', p.parte_con,
                            'parte_sin_la_persona', p.parte_sin, 'procesos_leidos_de_la_entidad', p.total,
                            'rol', c.rol, 'pagina', c.pagina, 'documento_sha256', c.sha, 'consorcio', g.consorcio,
                            'documento', 'acta del proceso, leída por los agentes de Vigía (cita comprobada)',
                            'en_observacion', v_obs),
         'comite_dictamen', NULL
    FROM _cp p
    JOIN _cm c ON c.ent = p.ent AND c.clave = p.clave
    JOIN _cg g ON g.ocid = c.ocid AND g.ruc = p.ruc
   ORDER BY c.ocid, p.ruc, p.k DESC, p.parte_con DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_comite_mismo_ganador() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_mismo_ganador() FROM PUBLIC;
