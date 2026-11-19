-- 407 · Un integrante del comité de selección es socio o representante de una empresa que le gana a esa misma entidad
-- (indicador EN OBSERVACIÓN, migración 329).
--
-- Quien integra un comité trabaja en la entidad y decide quién cumple y cómo se puntúa. Si además es socio, gerente o
-- representante (RNP) de una empresa que le vende a esa entidad, está en el conflicto de interés que la ley de
-- contrataciones convierte en impedimento: el funcionario no puede ser proveedor de su entidad, ni sus empresas, mientras
-- ejerce y hasta doce meses después. La 395 (socio_en_entidad) lo ve cuando el DNI del socio aparece entre las personas
-- con órdenes de la entidad; ésta lo ve desde el comité, que leen los agentes en el acta, aunque la persona sea de
-- planta y no tenga órdenes.
--
-- Medido el 2026-11-19 sobre 3 288 procesos con comité leído (5 870 personas; 1 027 se llaman como alguien del RNP):
-- ninguno es socio de un postor del MISMO proceso; 8 son socios o representantes de una empresa que gana OTROS procesos
-- en su entidad (4 ya los marcaba la 395 por DNI; 4 son nuevos). Un caso: el presidente de un comité es socio desde 2016
-- de una empresa que le ganó a esa entidad S/ 3,9 millones en los meses previos.
--
-- Cómo se empareja, sin DNI: el nombre del acta (sin títulos, 3 palabras o más, cita comprobada) contra el nombre del
-- RNP de las empresas que ganan en ESA entidad, con las mismas palabras en cualquier orden. Que el nombre completo de un
-- integrante coincida con el de un socio justo de un proveedor de su entidad casi no puede ser casualidad, pero puede
-- serlo: por eso `identidad` dice cuán firme es: «documento» si el DNI de ese socio aparece entre las personas con órdenes
-- de la entidad (persona_entidad), «nombre_completo» con 4 palabras o más, «nombre» con 3.
--
-- Cuándo (`cuando`): la buena pro frente a las fechas de los procesos en que la persona integró el comité: «a_la_vez»
-- (entre el primero y el último), «cerca» (a un año o menos) o «lejos». `socio_al_ganar`: el vínculo del RNP regía ese día.
-- Alta: regía, a la vez o cerca, e identidad por documento o nombre completo; o la empresa ganó un proceso en cuyo comité
-- estuvo la persona. Media: regía, a la vez o cerca, con nombre de 3 palabras. Baja: lo demás.
--
-- Privacidad: como en los demás indicadores en observación, del funcionario sólo su papel en el comité y una clave estable
-- (`integrante`: md5 de entidad y nombre, la misma que en la 396, así se ven juntos sus casos de las dos señales). Ni su
-- nombre ni su DNI van al cruce.

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('comite_socio_proveedor', 'Nueva (migración 407): falta medir su precisión con 40 casos revisados a mano.')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_socio_proveedor() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_socio_proveedor');
BEGIN
  -- Cada integrante del comité por proceso, con la cita comprobada (como la 396) y su nombre con las palabras ordenadas.
  CREATE TEMP TABLE _sm ON COMMIT DROP AS
  SELECT DISTINCT ON (x.ocid, x.clave) x.*,
         (SELECT string_agg(w, ' ' ORDER BY w) FROM unnest(string_to_array(x.clave, ' ')) w) AS orden
    FROM (
      SELECT a.ocid, btrim(cv.entidad_ruc::text) AS ent, cv.fecha_convocatoria AS fconv,
             btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')) AS clave,
             NULLIF(btrim(m->>'rol'), '') AS rol,
             (m->'evidencia'->0->>'pagina')::int AS pagina, m->>'documento_sha256' AS sha
        FROM alertas a
        JOIN convocatorias cv ON cv.ocid = a.ocid
        CROSS JOIN LATERAL jsonb_array_elements(a.analisis_full->'document_analysis'->'comite_evaluacion') m
       WHERE jsonb_typeof(a.analisis_full->'document_analysis'->'comite_evaluacion') = 'array'
         AND jsonb_typeof(m) = 'object'
         AND COALESCE((m->'evidencia'->0->>'verificada')::boolean, false)) x
   WHERE array_length(string_to_array(x.clave, ' '), 1) >= 3
   ORDER BY x.ocid, x.clave, x.pagina NULLS LAST;

  -- Por persona y entidad: en cuántos procesos estuvo, entre qué fechas y el último (con su papel, página y documento).
  CREATE TEMP TABLE _sp ON COMMIT DROP AS
  SELECT ent, clave, orden, count(DISTINCT ocid)::int AS procesos, min(fconv) AS desde, max(fconv) AS hasta,
         array_agg(DISTINCT ocid) AS ocids,
         (array_agg(ocid ORDER BY fconv DESC NULLS LAST))[1] AS ocid_comite,
         (array_agg(rol ORDER BY fconv DESC NULLS LAST) FILTER (WHERE rol IS NOT NULL))[1] AS rol,
         (array_agg(pagina ORDER BY fconv DESC NULLS LAST))[1] AS pagina,
         (array_agg(sha ORDER BY fconv DESC NULLS LAST))[1] AS sha
    FROM _sm GROUP BY ent, clave, orden;
  CREATE INDEX ON _sp (orden);
  ANALYZE _sp;

  -- Lo que ganan las empresas (RUC 20, o cada integrante RUC 20 de un consorcio) en esas entidades, por proceso.
  CREATE TEMP TABLE _sa ON COMMIT DROP AS
  SELECT COALESCE(m.ruc_miembro, a.ruc_proveedor)::text AS ruc, btrim(a.entidad_ruc::text) AS ent, cv.ocid,
         max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE a.entidad_ruc IN (SELECT DISTINCT ent::bpchar FROM _sp)
     AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY 1, 2, 3;
  ANALYZE _sa;

  -- Socios, representantes y órganos de administración (RNP) de esas empresas, con el nombre en el mismo orden.
  CREATE TEMP TABLE _sr ON COMMIT DROP AS
  SELECT btrim(r.ruc_empresa::text) AS ruc, r.numero_documento AS doc, r.tipo_rol, r.fecha_inicio_vigencia AS ini,
         r.baja_corte AS baja,
         (SELECT string_agg(w, ' ' ORDER BY w)
            FROM unnest(string_to_array(btrim(regexp_replace(regexp_replace(upper(public.unaccent(r.nombre)), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')), ' ')) w) AS orden
    FROM rnp_conformacion_juridica r
   WHERE r.ruc_empresa IN (SELECT DISTINCT ruc::bpchar FROM _sa) AND r.nombre IS NOT NULL;
  CREATE INDEX ON _sr (orden);
  ANALYZE _sr;

  -- Los pares: la persona del comité es socia de una empresa que gana en su entidad. Por par, sus roles y su vigencia.
  CREATE TEMP TABLE _sx ON COMMIT DROP AS
  SELECT p.ent, p.clave, p.procesos, p.desde, p.hasta, p.ocids, p.ocid_comite, p.rol, p.pagina, p.sha, r.ruc,
         array_agg(DISTINCT r.tipo_rol ORDER BY r.tipo_rol) AS roles, min(r.ini) AS ini,
         CASE WHEN bool_or(r.baja IS NULL) THEN NULL ELSE max(r.baja) END AS baja,
         CASE WHEN EXISTS (SELECT 1 FROM persona_entidad pe
                            WHERE pe.entidad_ruc = p.ent AND substr(pe.ruc, 3, 8) = ANY(array_agg(r.doc)))
                THEN 'documento'
              WHEN array_length(string_to_array(p.orden, ' '), 1) >= 4 THEN 'nombre_completo'
              ELSE 'nombre' END AS identidad
    FROM _sp p
    JOIN _sr r ON r.orden = p.orden
   WHERE EXISTS (SELECT 1 FROM _sa s WHERE s.ruc = r.ruc AND s.ent = p.ent)
   GROUP BY p.ent, p.clave, p.orden, p.procesos, p.desde, p.hasta, p.ocids, p.ocid_comite, p.rol, p.pagina, p.sha, r.ruc;

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_socio_proveedor';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (z.ocid, z.ruc)
         'comite_socio_proveedor', z.ruc, z.ocid,
         CASE WHEN z.en_su_comite AND z.socio_al_ganar THEN 'alta'
              WHEN z.socio_al_ganar AND z.cuando IN ('a_la_vez', 'cerca') AND z.identidad <> 'nombre' THEN 'alta'
              WHEN z.socio_al_ganar AND z.cuando IN ('a_la_vez', 'cerca') THEN 'media'
              ELSE 'baja' END,
         z.f, z.monto, NULL, NULL, z.rol,
         jsonb_build_object('integrante', left(md5(z.ent || '|' || z.clave), 10), 'rol', z.rol,
                            'procesos_de_la_persona', z.procesos, 'ocid_comite', z.ocid_comite,
                            'comite_desde', z.desde, 'comite_hasta', z.hasta, 'cuando', z.cuando,
                            'en_su_comite', z.en_su_comite, 'rol_en_empresa', to_jsonb(z.roles), 'socio_desde', z.ini,
                            'socio_baja', z.baja, 'socio_al_ganar', z.socio_al_ganar, 'identidad', z.identidad,
                            'pagina', z.pagina, 'documento_sha256', z.sha, 'consorcio', z.consorcio,
                            'documento', 'acta del proceso (comité, cita comprobada) y Registro Nacional de Proveedores',
                            'en_observacion', v_obs),
         'comite_dictamen', NULL
    FROM (
      SELECT x.*, s.ocid, s.f, s.monto, s.consorcio,
             s.ocid = ANY(x.ocids) AS en_su_comite,
             (x.ini IS NULL OR x.ini <= s.f) AND (x.baja IS NULL OR x.baja >= s.f) AS socio_al_ganar,
             CASE WHEN s.f IS NULL OR x.desde IS NULL THEN 'sin_fechas'
                  WHEN s.f BETWEEN x.desde AND x.hasta THEN 'a_la_vez'
                  WHEN s.f BETWEEN x.desde - 365 AND x.hasta + 365 THEN 'cerca'
                  ELSE 'lejos' END AS cuando
        FROM _sx x
        JOIN _sa s ON s.ruc = x.ruc AND s.ent = x.ent) z
   ORDER BY z.ocid, z.ruc,
            CASE WHEN z.en_su_comite THEN 0 WHEN z.cuando = 'a_la_vez' THEN 1 WHEN z.cuando = 'cerca' THEN 2 ELSE 3 END,
            CASE z.identidad WHEN 'documento' THEN 0 WHEN 'nombre_completo' THEN 1 ELSE 2 END;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_comite_socio_proveedor() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_socio_proveedor() FROM PUBLIC;
