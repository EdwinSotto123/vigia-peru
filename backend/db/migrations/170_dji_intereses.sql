-- 170 · Lo que cada funcionario declara en las secciones 1 a 6 de su DJI (Ley 31227), y la bandera del contrato
-- cuando una empresa que declaró le ganó un contrato a SU entidad.
--
-- La DJI trae, además de los familiares (sección 7, dji_vinculos): 1 empresas en las que él o su cónyuge tienen
-- participación patrimonial, 2 representaciones y poderes, 3 directorios y consejos, 4 empleos, asesorías y consultorías
-- (públicos y privados, con su periodo), 5 organizaciones privadas (partidos, gremios, ONG) y 6 comités de selección.
-- Medido en 300 PDF (1,848 declaraciones, 2026-10-27): 249 declaran participación en empresas, 53 poderes, 22
-- directorios, 78 empleos o asesorías, 104 organizaciones y 89 comités, casi siempre con el RUC.
-- Lo lee backend/scripts/parse_dji_intereses.py y lo carga backend/scripts/procesar_dji_intereses.py, de los mismos PDF.
--
-- La bandera (cruces_proveedor, como socio_en_entidad de la migración 122), sobre cada contrato que la empresa le ganó
-- a la entidad del declarante (conosce_adjudicaciones):
--   interes_declarado  secciones 1 a 3: tenía acciones, un poder o un asiento en el directorio de la empresa. Alta si la
--                      buena pro cae dentro del periodo que declaró (o no dio fecha); media si cae fuera.
--   empleo_declarado   sección 4: trabajó o asesoró a la empresa. Alta si la buena pro cae mientras trabajaba para ella;
--                      media si fue después (puerta giratoria); no se marca si la buena pro es de antes de ese empleo.
-- Nunca cuenta la propia entidad ni otra entidad pública (las EPS y beneficencias de un directorio municipal).
--
-- Privacidad: el RUC 10 que declare (una persona natural con negocio) se guarda para cruzar y no se publica (como todo
-- RUC 10). La tabla no es de la API: lo que se publica sale por cruces_proveedor. Y se quita a vigia_ab, vigia_agentes y
-- vigia_mcp (los roles de los modelos) el acceso a los DNI de familiares (dji_vinculos, dji_nepotismo), que no usan.

CREATE TABLE IF NOT EXISTS dji_intereses (
  id              bigserial PRIMARY KEY,
  entidad_ruc     text NOT NULL,       -- la entidad del declarante (la del PDF <ruc>_<apellidos>_<nombres>.pdf)
  declarante_norm text NOT NULL,       -- apellidos y nombres en mayúsculas, como dji_vinculos
  ejercicio       smallint,            -- año de la declaración
  oportunidad     text,                -- AL INICIO, PERIÓDICA, AL CESAR…
  seccion         smallint NOT NULL CHECK (seccion BETWEEN 1 AND 6),
  ruc             text,                -- el RUC que declaró
  nombre          text,                -- como lo escribió (el nombre oficial sale de la SUNAT por el RUC)
  detalle         text,                -- naturaleza, cargo, tipo de comité
  periodo         text,
  desde           date,
  hasta           date,                -- NULL con «Actualidad»
  pdf_r2          text,
  capturado       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dji_intereses_declarante ON dji_intereses (entidad_ruc, declarante_norm);
CREATE INDEX IF NOT EXISTS dji_intereses_ruc ON dji_intereses (ruc) WHERE ruc IS NOT NULL;

-- Lo que marcó en cada sección de cada declaración: un «No» es un dato, no un hueco.
CREATE TABLE IF NOT EXISTS dji_secciones (
  entidad_ruc     text NOT NULL,
  declarante_norm text NOT NULL,
  ejercicio       smallint NOT NULL DEFAULT 0,
  oportunidad     text NOT NULL DEFAULT '',
  seccion         smallint NOT NULL,
  marca           text NOT NULL CHECK (marca IN ('si', 'no')),
  PRIMARY KEY (entidad_ruc, declarante_norm, ejercicio, oportunidad, seccion)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON dji_intereses, dji_secciones TO vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE dji_intereses_id_seq TO vigia_jobs;
-- Los privilegios por defecto dan SELECT a los roles de la API y de los modelos: estas tablas no son de ellos.
REVOKE ALL ON dji_intereses, dji_secciones FROM vigia_api, vigia_api_admin, vigia_ab, vigia_agentes, vigia_mcp;
REVOKE ALL ON dji_vinculos, dji_nepotismo FROM vigia_ab, vigia_agentes, vigia_mcp;

CREATE OR REPLACE FUNCTION refrescar_cruce_interes_dji() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo IN ('interes_declarado', 'empleo_declarado');
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  WITH i AS (
    -- Cada empresa (RUC 20 que no es una entidad pública) que un funcionario declaró, con el periodo de su vínculo y,
    -- si lo declaró en la sección 4, desde cuándo trabaja en su entidad (la fila con el RUC de la entidad).
    SELECT d.entidad_ruc, d.declarante_norm, d.ruc, d.seccion, max(d.detalle) AS detalle,
           min(d.desde) AS desde, CASE WHEN bool_or(d.hasta IS NULL) THEN NULL ELSE max(d.hasta) END AS hasta,
           max(d.ejercicio) AS ejercicio, max(d.pdf_r2) AS pdf_r2,
           (SELECT min(x.desde) FROM dji_intereses x
             WHERE x.entidad_ruc = d.entidad_ruc AND x.declarante_norm = d.declarante_norm AND x.seccion = 4 AND x.ruc = d.entidad_ruc) AS ingreso
      FROM dji_intereses d
     WHERE d.ruc ~ '^20\d{9}$' AND d.seccion BETWEEN 1 AND 4 AND d.ruc <> d.entidad_ruc
       AND NOT EXISTS (SELECT 1 FROM entidades e WHERE e.ruc = d.ruc)
     GROUP BY d.entidad_ruc, d.declarante_norm, d.ruc, d.seccion
  ), c AS (
    -- Cada contrato que esa empresa le ganó a ESA entidad, con su ocid (como socio_en_entidad, migración 122).
    SELECT cv.ocid, a.ruc_proveedor AS ruc, a.entidad_ruc, max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
     WHERE (a.ruc_proveedor, a.entidad_ruc) IN (SELECT ruc, entidad_ruc FROM i)
     GROUP BY cv.ocid, a.ruc_proveedor, a.entidad_ruc
  ), m AS (
    SELECT c.ocid, c.ruc AS ruc_c, c.entidad_ruc, c.f, c.monto, i.declarante_norm, i.seccion, i.detalle, i.desde, i.hasta,
           i.ejercicio, i.ingreso,
           CASE WHEN i.seccion = 4 THEN 'empleo_declarado' ELSE 'interes_declarado' END AS tipo_c,
           (i.desde IS NULL OR c.f >= i.desde) AND (i.hasta IS NULL OR c.f <= i.hasta) AS dentro
      FROM c JOIN i ON i.ruc = c.ruc AND i.entidad_ruc = c.entidad_ruc
     WHERE c.f IS NOT NULL
  )
  SELECT DISTINCT ON (m.ocid, m.ruc_c, m.tipo_c)
         m.tipo_c, m.ruc_c, m.ocid,
         CASE WHEN m.dentro THEN 'alta' ELSE 'media' END,
         m.f, m.monto, NULL, m.declarante_norm,
         (SELECT f.cargo FROM dji_funcionarios f WHERE f.nombre_norm = m.declarante_norm AND f.cargo IS NOT NULL
           ORDER BY f.fecha_inicio_cargo DESC NULLS LAST LIMIT 1),
         jsonb_build_object('seccion', m.seccion, 'detalle', m.detalle, 'desde', m.desde, 'hasta', m.hasta,
                            'ejercicio', m.ejercicio, 'ingreso', m.ingreso, 'dentro', m.dentro),
         -- La consulta pública de la DJIC por la entidad (la misma que usa backend/scripts/scrape_dji.py).
         'dji', 'https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc=' || m.entidad_ruc
    FROM m
   -- Un empleo declarado no marca un contrato de antes de ese empleo: entonces todavía no había vínculo.
   WHERE NOT (m.seccion = 4 AND m.desde IS NOT NULL AND m.f < m.desde)
   ORDER BY m.ocid, m.ruc_c, m.tipo_c, m.dentro DESC, m.seccion;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_interes_dji() OWNER TO vigia_jobs;
