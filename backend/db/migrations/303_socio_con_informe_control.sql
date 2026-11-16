-- 303 · Señal `socio_con_informe_control`: un socio o representante legal del ganador figura, con responsabilidad
-- PRESUNTA, en un informe de control de la Contraloría emitido ANTES de la buena pro (2026-11-16).
--
-- Pedido del dueño: explotar a los implicados de los informes de control. La migración 302 guarda, por su DNI, a las
-- 84 387 personas comprendidas en los 14 154 informes con responsabilidad; aquí se cruzan con la gente de las empresas que
-- le ganan al Estado.
--
-- Red: rnp_conformacion_juridica, SOCIOS y REPRESENTANTES LEGALES por DNI (no directivos), de empresas con RUC 20. La
-- persona debe figurar en la empresa desde antes de la buena pro (cuando el RNP da la fecha) y el nombre de las dos
-- fuentes tiene que coincidir en dos palabras o más (un DNI mal escrito en una de ellas no une a dos personas: en PROD
-- deja fuera a 5 personas, 28 cruces). Ganadores: conosce_adjudicaciones desde 2018, también como integrante de un
-- consorcio.
--
--   alta   el informe le señala responsabilidad PENAL presunta;
--   media  civil o administrativa.
-- El detalle dice si el informe es de la MISMA entidad que contrató. Una bandera por contrato y empresa: la persona con
-- responsabilidad penal, de la misma entidad y con más informes, primero.
--
-- Es responsabilidad PRESUNTA: la Contraloría la identifica y la deriva; no es una condena ni un impedimento para
-- contratar. Es un hecho para revisar, no una acusación.
--
-- Privacidad: el DNI va en cruces_proveedor.persona_doc, como en las otras señales de personas (la API nunca lo devuelve);
-- el nombre es el del RNP (la API le tapa un apellido). El detalle no lleva ni documentos ni nombres de personas.
--
-- Medido en PROD antes de escribirla (CTE de sólo lectura con esta misma lógica): 6 719 banderas en 6 588 contratos, de
-- 1 256 empresas y 1 164 personas; 4 394 altas y 2 325 medias; 241 con un informe de la misma entidad (143 altas); 4 205
-- en procesos que ganó un consorcio; 4 916 desde 2023. Con directivos (órgano de administración) serían 7 986.

-- Las palabras de un nombre para comparar dos fuentes: sin tildes, de 3 letras o más y sin partículas («DE», «LA», «DEL»).
CREATE OR REPLACE FUNCTION palabras_de_nombre(p text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT w), '{}')
    FROM unnest(regexp_split_to_array(upper(public.immutable_unaccent(coalesce(p, ''))), '[^A-Z]+')) w
   WHERE length(w) >= 3 AND w NOT IN ('DEL', 'LAS', 'LOS', 'VDA', 'VIUDA')
$$;

CREATE OR REPLACE FUNCTION refrescar_cruce_socio_con_informe_control() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '600s' AS $$
DECLARE v_filas int;
BEGIN
  -- 1. Cada persona con DNI de cada informe, con lo que el informe le señala (4 figuran dos veces en el mismo informe).
  DROP TABLE IF EXISTS _sic_i;
  CREATE TEMP TABLE _sic_i ON COMMIT DROP AS
    SELECT p.doc, p.codigo AS informe, palabras_de_nombre(max(p.nombre)) AS palabras, array_agg(DISTINCT r.x ORDER BY r.x) AS resp,
           ic.numero, ic.titulo, ic.entidad_nombre, ic.entidad_ruc::text AS entidad_ruc, ic.fecha_emision AS emision,
           coalesce(ic.url_resumen, ic.url_pdf) AS url
      FROM informe_control_persona p
      JOIN informes_control ic ON ic.codigo = p.codigo
      CROSS JOIN LATERAL unnest(p.responsabilidades) r(x)
     WHERE p.doc ~ '^[0-9]{8}$' AND ic.fecha_emision IS NOT NULL
     GROUP BY p.doc, p.codigo, ic.numero, ic.titulo, ic.entidad_nombre, ic.entidad_ruc, ic.fecha_emision, ic.url_resumen, ic.url_pdf;
  CREATE INDEX ON _sic_i (doc);
  ANALYZE _sic_i;

  -- 2. Sus empresas en el RNP (RUC 20), como socio o representante legal: desde cuándo y con qué nombre.
  DROP TABLE IF EXISTS _sic_h;
  CREATE TEMP TABLE _sic_h ON COMMIT DROP AS
    SELECT r.numero_documento AS doc, r.ruc_empresa::text AS ruc, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
           min(r.fecha_inicio_vigencia) AS desde,
           -- Una sucesión figura con dos nombres completos («SUCESION … REPRESENTADA POR …»): no se guarda.
           CASE WHEN max(r.nombre) ~* 'SUCESI|REPRESENTAD|VIUDA DE|HEREDER|INDIVISA' THEN 'Sucesión (nombre reservado)' ELSE max(r.nombre) END AS nombre,
           palabras_de_nombre(max(r.nombre)) AS palabras
      FROM rnp_conformacion_juridica r
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.tipo_rol IN ('SOCIO_ACCIONISTA_TITULAR', 'REPRESENTANTE_LEGAL')
       AND r.ruc_empresa ~ '^20[0-9]{9}$' AND r.numero_documento IN (SELECT doc FROM _sic_i)
     GROUP BY 1, 2;
  CREATE INDEX ON _sic_h (ruc);
  ANALYZE _sic_h;

  -- 3. Lo que ganaron esas empresas desde 2018, solas o dentro de un consorcio (CONOSCE da al consorcio un código propio).
  DROP TABLE IF EXISTS _sic_g;
  CREATE TEMP TABLE _sic_g ON COMMIT DROP AS
    SELECT a.codigo_convocatoria::text AS codigo, a.ruc_proveedor::text AS ruc, NULL::text AS consorcio, min(a.fecha_buenapro) AS fecha,
           sum(a.monto_adjudicado) AS monto, max(a.entidad_ruc)::text AS entidad
      FROM conosce_adjudicaciones a
     WHERE a.anio >= 2018 AND a.monto_adjudicado > 0 AND a.fecha_buenapro IS NOT NULL AND a.ruc_proveedor IN (SELECT ruc FROM _sic_h)
     GROUP BY 1, 2
    UNION ALL
    SELECT a.codigo_convocatoria::text, q.ruc_miembro::text, max(q.consorcio), min(a.fecha_buenapro), sum(a.monto_adjudicado), max(a.entidad_ruc)::text
      FROM conosce_consorcios q
      JOIN conosce_adjudicaciones a ON a.ruc_proveedor = q.ruc_consorcio
     WHERE q.ruc_miembro IN (SELECT ruc FROM _sic_h) AND q.ruc_consorcio !~ '^(10|20)[0-9]{9}$'
       AND a.anio >= 2018 AND a.monto_adjudicado > 0 AND a.fecha_buenapro IS NOT NULL
     GROUP BY 1, 2;
  CREATE INDEX ON _sic_g (ruc);
  ANALYZE _sic_g;

  -- 4. Cada buena pro con cada informe de esa persona emitido ANTES, si ya estaba en la empresa y los nombres coinciden.
  DROP TABLE IF EXISTS _sic_m;
  CREATE TEMP TABLE _sic_m ON COMMIT DROP AS
    SELECT g.codigo, g.ruc, g.fecha, g.monto, g.consorcio, h.doc, h.nombre, h.rol, h.desde,
           i.informe, i.numero, i.titulo, i.entidad_nombre, i.entidad_ruc, i.emision, i.resp, i.url,
           'penal' = ANY (i.resp) AS penal, coalesce(i.entidad_ruc = g.entidad, false) AS misma
      FROM _sic_g g
      JOIN _sic_h h ON h.ruc = g.ruc AND (h.desde IS NULL OR h.desde <= g.fecha)
      JOIN _sic_i i ON i.doc = h.doc AND i.emision < g.fecha
     WHERE (SELECT count(*) FROM unnest(h.palabras) w WHERE w = ANY (i.palabras)) >= 2;
  CREATE INDEX ON _sic_m (codigo, ruc, doc);
  ANALYZE _sic_m;

  DELETE FROM cruces_proveedor WHERE tipo = 'socio_con_informe_control';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, p.ruc) 'socio_con_informe_control', p.ruc, c.ocid, CASE WHEN p.penal THEN 'alta' ELSE 'media' END,
         p.fecha, p.monto, p.doc, p.nombre, p.rol,
         jsonb_build_object(
           'informe_codigo', p.informes->0->>'codigo', 'informe_numero', p.informes->0->>'numero', 'informe_titulo', p.titulo,
           'informe_entidad', p.informes->0->>'entidad', 'informe_entidad_ruc', p.informes->0->>'entidad_ruc',
           'emision', p.informes->0->>'emision', 'responsabilidades', p.informes->0->'responsabilidades',
           'misma_entidad', (p.informes->0->>'misma_entidad')::boolean, 'url_resumen', p.informes->0->>'url_resumen',
           -- El primero es el más grave; si es de otra entidad, ¿alguno de los demás es de la que contrató?
           'misma_entidad_en_otro', p.misma AND NOT (p.informes->0->>'misma_entidad')::boolean,
           'dias_antes', p.fecha - (p.informes->0->>'emision')::date,
           'rol_en_empresa', p.rol, 'en_la_empresa_desde', to_char(p.desde, 'YYYY-MM-DD'),
           -- Los demás informes de la persona anteriores a la buena pro (hasta 4) y cuántas personas de la empresa figuran.
           'n_informes', p.n_informes,
           'otros_informes', (SELECT jsonb_agg(e ORDER BY k) FROM jsonb_array_elements(p.informes) WITH ORDINALITY t(e, k) WHERE k BETWEEN 2 AND 5),
           'n_personas', p.n_personas, 'consorcio', p.consorcio),
         'informes_control', coalesce(p.informes->0->>'url_resumen', 'https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/Avanzada.html')
    FROM (
      SELECT m.codigo, m.ruc, m.doc, max(m.nombre) AS nombre, max(m.rol) AS rol, max(m.desde) AS desde, max(m.fecha) AS fecha,
             max(m.monto) AS monto, max(m.consorcio) AS consorcio, bool_or(m.penal) AS penal, bool_or(m.misma) AS misma,
             count(*) AS n_informes, count(*) OVER (PARTITION BY m.codigo, m.ruc) AS n_personas,
             (array_agg(m.titulo ORDER BY m.penal DESC, m.misma DESC, m.emision DESC, m.informe))[1] AS titulo,
             jsonb_agg(jsonb_build_object('codigo', m.informe, 'numero', m.numero, 'entidad', m.entidad_nombre, 'entidad_ruc', m.entidad_ruc,
                                          'emision', to_char(m.emision, 'YYYY-MM-DD'), 'responsabilidades', to_jsonb(m.resp),
                                          'misma_entidad', m.misma, 'url_resumen', m.url)
                       ORDER BY m.penal DESC, m.misma DESC, m.emision DESC, m.informe) AS informes
        FROM _sic_m m
       GROUP BY m.codigo, m.ruc, m.doc
    ) p
    JOIN convocatorias c ON c.codigo::text = p.codigo
   ORDER BY c.ocid, p.ruc, p.penal DESC, p.misma DESC, p.n_informes DESC, p.doc;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_socio_con_informe_control() OWNER TO vigia_jobs;
-- Lee informe_control_persona (con DNI): sólo la corre su dueño (el Worker de scrapers y los refrescos como vigia_jobs).
REVOKE ALL ON FUNCTION refrescar_cruce_socio_con_informe_control() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION refrescar_cruce_socio_con_informe_control() FROM vigia_agentes;
  END IF;
END $$;

-- Tablas temporales chicas (a lo más decenas de miles de filas, con ANALYZE) y el RNP recorrido una vez: la misma lógica
-- en CTE tardó 43 s en PROD. La micro de DEV es varias veces más lenta; si pasa de 10 minutos algo anda mal y se corta.
SET statement_timeout = '600s';
SELECT refrescar_cruce_socio_con_informe_control() AS socio_con_informe_control;
RESET statement_timeout;
