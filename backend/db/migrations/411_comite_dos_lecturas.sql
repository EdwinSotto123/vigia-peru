-- 411 · El comité de las actas escaneadas: un nombre que leen igual dos modelos distintos.
--
-- La 408 sólo tomaba del lector del comité los nombres comprobados en el texto de la página. Las actas firmadas suelen
-- ser una imagen dentro del ZIP: en las primeras 445 lecturas, el 84 % traía nombres y sólo el 18 % alguno comprobado.
-- El lector marca esas actas con `sin_verificar` y la segunda lectura (leer.py --segunda --solo-con-banderas, versión
-- v1-2) las lee con OTRO modelo, de otra familia (Gemma 4 26B; la primera es GLM 5.3 flash). Un nombre sin comprobar por
-- texto que la segunda lee con la misma clave entra como `dos_lecturas`. Piloto del 2026-11-19 contra el comité de los
-- agentes (40 procesos): comprobados por texto 57 de 58 correctos; confirmados por los dos modelos 22 de 22; leídos por
-- uno solo 16 de 19 (no entran). Cobertura de los nombres de los agentes: 57 → 79 de 112.
--
-- También marca `sin_verificar` en las actas que la corrida en curso guardó con el código anterior (banderas vacías).
--
-- Cómo aplicarla: después de la 408. Luego SELECT refrescar_comite_integrante() y las señales (tarea:refrescar-piezas).

UPDATE documento_lectura l SET banderas = ARRAY['sin_verificar']
 WHERE l.clase = 'comite' AND l.version = 'v1' AND l.estado = 'ok' AND COALESCE(l.banderas, '{}') = '{}'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(l.salida->'comite', '[]')) m
                WHERE NOT COALESCE((m->>'verificada')::boolean, false));

DROP MATERIALIZED VIEW IF EXISTS comite_integrante;
CREATE MATERIALIZED VIEW comite_integrante AS
SELECT DISTINCT ON (x.ocid, x.clave) x.*
  FROM (
    SELECT a.ocid, btrim(cv.entidad_ruc::text) AS ent, cv.fecha_convocatoria AS fconv,
           btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')) AS clave,
           NULLIF(btrim(m->>'rol'), '') AS rol, (m->'evidencia'->0->>'pagina')::int AS pagina,
           m->>'documento_sha256' AS sha, 'agentes'::text AS fuente
      FROM alertas a
      JOIN convocatorias cv ON cv.ocid = a.ocid
      CROSS JOIN LATERAL jsonb_array_elements(a.analisis_full->'document_analysis'->'comite_evaluacion') m
     WHERE jsonb_typeof(a.analisis_full->'document_analysis'->'comite_evaluacion') = 'array'
       AND jsonb_typeof(m) = 'object'
       AND COALESCE((m->'evidencia'->0->>'verificada')::boolean, false)
    UNION ALL
    SELECT l.ocid, btrim(cv.entidad_ruc::text), cv.fecha_convocatoria,
           btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')),
           NULLIF(btrim(m->>'rol'), ''), (m->>'pagina_texto')::int, g.sha256, 'lector'
      FROM documento_lectura l
      JOIN convocatorias cv ON cv.ocid = l.ocid
      LEFT JOIN documentos_gcs g ON g.id = l.documentos[1]
      CROSS JOIN LATERAL jsonb_array_elements(l.salida->'comite') m
     WHERE l.clase = 'comite' AND l.estado = 'ok' AND l.version NOT LIKE '%-2'
       AND jsonb_typeof(l.salida->'comite') = 'array' AND jsonb_typeof(m) = 'object'
       AND COALESCE((m->>'verificada')::boolean, false)
    UNION ALL
    SELECT l.ocid, btrim(cv.entidad_ruc::text), cv.fecha_convocatoria,
           btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')),
           NULLIF(btrim(m->>'rol'), ''), (m->>'pagina_texto')::int, g.sha256, 'dos_lecturas'
      FROM documento_lectura l
      JOIN convocatorias cv ON cv.ocid = l.ocid
      LEFT JOIN documentos_gcs g ON g.id = l.documentos[1]
      JOIN documento_lectura z ON z.ocid = l.ocid AND z.clase = 'comite' AND z.version = l.version || '-2'
                              AND z.estado = 'ok' AND z.modelo <> l.modelo
      CROSS JOIN LATERAL jsonb_array_elements(l.salida->'comite') m
     WHERE l.clase = 'comite' AND l.estado = 'ok' AND l.version NOT LIKE '%-2'
       AND jsonb_typeof(l.salida->'comite') = 'array' AND jsonb_typeof(m) = 'object'
       AND NOT COALESCE((m->>'verificada')::boolean, false)
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(z.salida->'comite', '[]')) m2 WHERE m2->>'clave' = m->>'clave')) x
 WHERE array_length(string_to_array(x.clave, ' '), 1) >= 3
 ORDER BY x.ocid, x.clave, CASE x.fuente WHEN 'agentes' THEN 0 WHEN 'lector' THEN 1 ELSE 2 END, x.pagina NULLS LAST;

CREATE UNIQUE INDEX comite_integrante_uidx ON comite_integrante (ocid, clave);
CREATE INDEX comite_integrante_ent ON comite_integrante (ent);
COMMENT ON MATERIALIZED VIEW comite_integrante IS 'Integrantes del comité de selección por proceso: de los agentes (evidencia verificada), del lector del acta (comprobado en el texto) y confirmados por dos lecturas de modelos distintos (fuente dos_lecturas). Interna: no se otorga a la API ni al MCP. Migraciones 408 y 411.';

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER MATERIALIZED VIEW public.comite_integrante OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.comite_integrante FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON comite_integrante FROM PUBLIC;
