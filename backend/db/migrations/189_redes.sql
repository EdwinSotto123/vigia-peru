-- 189 · Redes y conflictos (fase 4 del plan del 2026-10-27): dos cruces del contrato con su evidencia.
--
-- 1. «Un familiar de un funcionario es socio del ganador» (pariente_funcionario). El pariente que un funcionario de la
--    entidad declaró en su DJI (dji_vinculos, con su documento) figura en el RNP como socio, representante o directivo de
--    la empresa que ganó en esa MISMA entidad. Es el conflicto que la Ley 32069 trata como impedimento para ciertos cargos;
--    aquí es un indicio para revisar: no siempre el funcionario interviene en la compra. Grave si el parentesco es cercano
--    (cónyuge o conviviente, padres, hijos, hermanos), media si no (cuñados, primos, tíos, sobrinos, suegros). Sólo
--    contratos desde 2023 (las DJI son de quienes están hoy en el cargo) y con el pariente ya en la empresa al ganar.
--    El cargo del funcionario sale de su DJI en los datos abiertos por su nombre y su entidad (el código de la declaración
--    del portal no es el de los datos abiertos). Privacidad: ni el pariente ni el funcionario se identifican: el
--    parentesco, el cargo y el papel del pariente en la empresa.
--
-- 2. «Postores vinculados que se turnan» (turno_postores). Dos empresas que comparten una persona (socio, representante
--    o directivo en el RNP) o el domicilio fiscal compiten juntas en al menos 4 procesos con pocos postores (2 a 6) y se
--    reparten las buenas pro: cada una gana al menos 2 y entre las dos ganan 3 de cada 4. Competencia aparente sostenida
--    (rotación de ofertas). Sin el vínculo no se marca: dos proveedores grandes de un mismo rubro compiten y se reparten
--    el mercado sin colusión (3,339 pares de ese tipo en el país, 2026-10-28). Va en cada contrato que alguna de las dos
--    ganó en un proceso donde compitieron juntas, con el par y sus números.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/189_redes.sql y en producción
-- backend/scripts/aplicar_189.py (el SQL, los dos refrescos y lo que sigue: dedup, casos_cruce, antecedentes por entidad).
-- El Worker los llama en refrescarCasosCruce (comun.ts, siExiste), antes de dedup_cruces_proveedor.

-- ── 1. El familiar de un funcionario, socio del ganador ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_cruce_pariente_funcionario() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '256MB';
  -- Los parientes declarados con documento, su entidad y el cargo del funcionario que los declaró.
  CREATE TEMP TABLE _pfv ON COMMIT DROP AS
    SELECT DISTINCT ON (v.entidad_ruc, v.pariente_doc)
           v.entidad_ruc, v.pariente_doc AS dni, v.parentesco, v.grado, f.cargo
      FROM dji_vinculos v
      LEFT JOIN LATERAL (
        SELECT f.cargo FROM dji_funcionarios f JOIN dji_entidad_ruc m ON m.entidad = f.entidad
         WHERE m.ruc = v.entidad_ruc AND f.nombre_norm = v.declarante_norm
         ORDER BY f.fecha_presentacion DESC NULLS LAST LIMIT 1) f ON true
     WHERE v.pariente_doc ~ '^\d{8}$' AND v.entidad_ruc ~ '^\d{11}$'
     ORDER BY v.entidad_ruc, v.pariente_doc, CASE WHEN v.grado IN ('conyuge', 'padre', 'hijo', 'hermano') THEN 0 ELSE 1 END;
  CREATE INDEX ON _pfv (dni);

  -- Sus papeles en empresas (RUC 20) del RNP. Fuera las personas que figuran en más de 10 empresas (apoderados de muchas).
  CREATE TEMP TABLE _pfr ON COMMIT DROP AS
    SELECT r.numero_documento AS dni, r.ruc_empresa::text AS ruc, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
           min(r.fecha_inicio_vigencia) AS desde
      FROM rnp_conformacion_juridica r
     WHERE r.numero_documento IN (SELECT dni FROM _pfv) AND r.ruc_empresa::text ~ '^20\d{9}$'
       AND r.numero_documento NOT IN (SELECT numero_documento FROM rnp_conformacion_juridica
                                       WHERE numero_documento IN (SELECT dni FROM _pfv)
                                       GROUP BY 1 HAVING count(DISTINCT ruc_empresa) > 10)
     GROUP BY 1, 2;
  CREATE INDEX ON _pfr (ruc);

  -- Lo que esas empresas ganaron desde 2023 (como consorcio también), con su OCID.
  CREATE TEMP TABLE _pfg ON COMMIT DROP AS
    SELECT DISTINCT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc, a.fecha_buenapro AS f
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE a.fecha_buenapro >= DATE '2023-01-01'
       AND COALESCE(m.ruc_miembro, a.ruc_proveedor) IN (SELECT ruc FROM _pfr);

  DELETE FROM cruces_proveedor WHERE tipo = 'pariente_funcionario';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ocid, g.ruc)
         'pariente_funcionario', g.ruc, g.ocid,
         CASE WHEN v.grado IN ('conyuge', 'padre', 'hijo', 'hermano') THEN 'alta' ELSE 'media' END,
         g.f, NULL, NULL, r.rol,
         jsonb_build_object('parentesco', v.parentesco, 'grado', v.grado, 'cargo_funcionario', v.cargo,
                            'decisor', visita_decisor(v.cargo, NULL), 'rol_en_empresa', r.rol, 'desde_en_empresa', r.desde,
                            'buena_pro', g.f),
         'dji_vinculos', 'https://appdji.contraloria.gob.pe/DJIC/'
    FROM _pfg g
    JOIN _pfr r ON r.ruc = g.ruc AND (r.desde IS NULL OR r.desde <= g.f)
    JOIN _pfv v ON v.dni = r.dni AND v.entidad_ruc = g.entidad_ruc
   ORDER BY g.ocid, g.ruc, CASE WHEN v.grado IN ('conyuge', 'padre', 'hijo', 'hermano') THEN 0 ELSE 1 END,
            CASE WHEN visita_decisor(v.cargo, NULL) THEN 0 ELSE 1 END;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_pariente_funcionario() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_pariente_funcionario() FROM PUBLIC;

-- ── 2. Postores vinculados que se turnan ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_cruce_turno_postores() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '512MB';
  -- Quién se presentó a cada proceso (RUC 10 o 20) y cuántos fueron.
  CREATE TEMP TABLE _tpb ON COMMIT DROP AS
    SELECT DISTINCT codigo_convocatoria AS cod, ruc_postor AS ruc FROM conosce_postores
     WHERE ruc_postor ~ '^(10|20)\d{9}$' AND codigo_convocatoria IS NOT NULL;
  CREATE TEMP TABLE _tpn ON COMMIT DROP AS SELECT cod, count(*) AS n FROM _tpb GROUP BY 1;
  -- Quién ganó cada proceso (los integrantes de un consorcio, también).
  CREATE TEMP TABLE _tpw ON COMMIT DROP AS
    SELECT DISTINCT a.codigo_convocatoria AS cod, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc,
           max(a.fecha_buenapro) OVER (PARTITION BY a.codigo_convocatoria, a.entidad_ruc) AS f
      FROM conosce_adjudicaciones a
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _tpw (cod, ruc);
  -- Cada par de postores de un proceso con 2 a 6 postores (en una licitación con 20, dos de ellos no dicen nada).
  CREATE TEMP TABLE _tpp ON COMMIT DROP AS
    SELECT a.ruc AS a, b.ruc AS b, a.cod,
           EXISTS (SELECT 1 FROM _tpw w WHERE w.cod = a.cod AND w.ruc = a.ruc) AS gana_a,
           EXISTS (SELECT 1 FROM _tpw w WHERE w.cod = a.cod AND w.ruc = b.ruc) AS gana_b
      FROM _tpb a JOIN _tpb b ON b.cod = a.cod AND b.ruc > a.ruc
      JOIN _tpn n ON n.cod = a.cod AND n.n BETWEEN 2 AND 6
     WHERE a.ruc LIKE '20%' AND b.ruc LIKE '20%';
  CREATE TEMP TABLE _tpr ON COMMIT DROP AS
    SELECT a, b, count(*) AS juntos, count(*) FILTER (WHERE gana_a) AS ga, count(*) FILTER (WHERE gana_b) AS gb
      FROM _tpp GROUP BY 1, 2
    HAVING count(*) >= 4 AND count(*) FILTER (WHERE gana_a) >= 2 AND count(*) FILTER (WHERE gana_b) >= 2
       AND (count(*) FILTER (WHERE gana_a) + count(*) FILTER (WHERE gana_b))::float / count(*) >= 0.75;
  CREATE INDEX ON _tpr (a, b);

  -- El vínculo: una persona en las dos (RNP; fuera quien figura en más de 10 empresas) o el mismo domicilio fiscal
  -- (fuera las direcciones con más de 5 empresas: centros de oficinas).
  CREATE TEMP TABLE _tpg ON COMMIT DROP AS
    SELECT DISTINCT ruc_empresa::text AS ruc, numero_documento AS dni FROM rnp_conformacion_juridica
     WHERE numero_documento ~ '^\d{8}$' AND ruc_empresa::text IN (SELECT a FROM _tpr UNION SELECT b FROM _tpr);
  DELETE FROM _tpg WHERE dni IN (SELECT dni FROM _tpg GROUP BY dni HAVING count(*) > 10);
  CREATE INDEX ON _tpg (dni);
  CREATE TEMP TABLE _tpv ON COMMIT DROP AS
    SELECT x.ruc AS a, y.ruc AS b, 'persona' AS via FROM _tpg x JOIN _tpg y ON y.dni = x.dni AND y.ruc > x.ruc
    UNION
    SELECT x.ruc, y.ruc, 'domicilio' FROM
      (SELECT ruc::text AS ruc, mef_norm(domicilio_fiscal) AS d FROM empresas
        WHERE ruc::text IN (SELECT a FROM _tpr UNION SELECT b FROM _tpr) AND length(btrim(domicilio_fiscal)) > 10) x
      JOIN (SELECT ruc::text AS ruc, mef_norm(domicilio_fiscal) AS d FROM empresas
             WHERE ruc::text IN (SELECT a FROM _tpr UNION SELECT b FROM _tpr) AND length(btrim(domicilio_fiscal)) > 10) y
        ON y.d = x.d AND y.ruc > x.ruc
     WHERE x.d NOT IN (SELECT mef_norm(domicilio_fiscal) FROM empresas WHERE domicilio_fiscal IS NOT NULL
                        GROUP BY 1 HAVING count(*) > 5);
  CREATE TEMP TABLE _tpl ON COMMIT DROP AS
    SELECT r.*, string_agg(DISTINCT v.via, ', ' ORDER BY v.via) AS via
      FROM _tpr r JOIN _tpv v ON v.a = r.a AND v.b = r.b GROUP BY r.a, r.b, r.juntos, r.ga, r.gb;

  DELETE FROM cruces_proveedor WHERE tipo = 'turno_postores';
  -- Un cruce por contrato que ganó una de las dos en un proceso donde compitieron juntas, con la otra y los números del par.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (cv.ocid, w.ruc)
         'turno_postores', w.ruc, cv.ocid, 'alta', w.f, NULL, NULL, NULL,
         jsonb_build_object('otra_ruc', CASE WHEN w.ruc = l.a THEN l.b ELSE l.a END,
                            'otra', (SELECT e.nombre FROM empresa_resumen e WHERE e.ruc = CASE WHEN w.ruc = l.a THEN l.b ELSE l.a END),
                            'juntos', l.juntos, 'gano_esta', CASE WHEN w.ruc = l.a THEN l.ga ELSE l.gb END,
                            'gano_otra', CASE WHEN w.ruc = l.a THEN l.gb ELSE l.ga END, 'vinculo', l.via),
         'conosce_postores', 'https://conosce.oece.gob.pe/buscador/'
    FROM _tpl l
    JOIN _tpp p ON p.a = l.a AND p.b = l.b AND (p.gana_a OR p.gana_b)
    JOIN _tpw w ON w.cod = p.cod AND w.ruc = CASE WHEN p.gana_a THEN l.a ELSE l.b END
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = p.cod AND cv.entidad_ruc = w.entidad_ruc
   ORDER BY cv.ocid, w.ruc, l.juntos DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_turno_postores() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_turno_postores() FROM PUBLIC;
