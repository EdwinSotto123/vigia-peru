-- 256 · Hallazgos por entidad: cada entidad comparada con sus pares (entidades parecidas), no a ojo.
--
-- Para «¿qué es lo más raro de la Municipalidad de Ate?» (GET /entidades/:ruc/hallazgos y GET /hallazgos/ranking,
-- routes/hallazgos.ts; las usa el MCP de Gobserva y el chat del panel). La API compara cada cifra de la entidad con la de
-- sus pares (mismo grupo y, si alcanza, mismo tercio de presupuesto) y marca como hallazgo lo que cae en el 10 % más alto
-- (o más bajo, en la ejecución del presupuesto). Aquí sólo están las cifras de cada entidad, con numerador y denominador
-- para que los porcentajes sean honestos; los percentiles y la selección los hace la API (lib/hallazgos.ts).
--
--   hallazgos_desde()        2023-01-01: el periodo de gobierno local en curso (2023-2026). Todo se cuenta desde ahí.
--   entidad_clase(nombre, tipo)
--                            el tipo de la entidad por su nombre: la MISMA lista y el mismo orden que la web y la API
--                            (REGLAS_TIPO_ENTIDAD en routes/entidades.ts; test/hallazgos.test.ts verifica que coincidan).
--   entidad_grupo(nombre, tipo, nivel MEF)
--                            el grupo de pares: municipalidad_distrital, municipalidad_provincial (con Lima Metropolitana y
--                            el Callao), gobierno_regional (la sede, sus gerencias subregionales y sus unidades ejecutoras
--                            que no son salud ni educación, sus proyectos especiales), salud (hospitales, redes, DIRESA,
--                            EsSalud), educacion (UGEL, direcciones regionales, colegios), universidad, empresa_publica
--                            (FONAFE, EPS, empresas municipales), nacional (ministerios, organismos autónomos y públicos,
--                            programas, Fuerzas Armadas y Policía), organismo_municipal (institutos viales, SAT,
--                            beneficencias, mancomunidades y otros organismos de una municipalidad) y otros.
--   entidad_metricas         (vista materializada) una fila por entidad: grupo, banda (tercio del PIM del último año
--                            completo dentro de su grupo; NULL sin presupuesto en el MEF) y, desde 2023:
--     · adj_*   procesos con buena pro (mcp_adjudicacion, 254): procesos, monto, directas, único postor (sobre los
--               procesos con postores conocidos y sin las directas), lo que se llevaron sus 5 proveedores principales
--               (empresas y consorcios; las personas naturales van juntas en 'otros' y no cuentan como proveedor).
--     · ord_*   órdenes de compra y servicio (entidad_orden_mes, 187: en soles, sin anuladas, sin duplicados): total,
--               lo que fue a personas naturales (RUC 10) y, en los años completos, lo emitido en diciembre.
--     · borde_ordenes  órdenes desde 2023 de los proveedores «al borde del tope» (la mitad o más de lo que les dio la
--               entidad cayó entre el 95 % y el 100 % de 8 UIT: empresa_borde_tope, 207, y persona_senal, 179). Contar
--               la franja en todas las órdenes recorre 650 mil páginas de conosce_ordenes (3 min en frío en DEV): se
--               reusa lo que ya calculan esas señales.
--     · mef_*   PIM y devengado del último año completo y del año en curso (mef_entity_budget, 151/152).
--     · ctl_*   informes de la Contraloría emitidos desde 2023 y cuántos con presunta responsabilidad penal.
--     · obras_* obras de INFOBRAS en ejecución o paralizadas hoy, y cuántas paralizadas.
--   categoria_gasto          conceptos de gasto buscados en la descripción de las órdenes (eventos, alimentos,
--                            publicidad, regalos): `consulta` y `excluir` van a to_tsquery('spanish', …).
--   entidad_gasto_categoria  por concepto y entidad, lo que suman sus órdenes desde 2023 (refrescar_gasto_categoria).
--   hallazgos_estado         una fila: cuándo se refrescó entidad_metricas.
--
--   refrescar_gasto_categoria(clave)
--     UNA consulta nacional por concepto, agrupada por entidad, con el índice GIN de la 255 (la expresión tiene que ser
--     la misma al carácter). Sin `<->` (frase) en `consulta` ni en `excluir`: con frases el GIN tiene que volver a
--     calcular to_tsvector en cada fila candidata (76 s por concepto en DEV); con palabras y `&`, no (2,5 a 30 s).
--   refrescar_hallazgos(p_horas, p_segundos, p_dias)
--     Lo llama el cron de cada 10 min de la API (POST /admin/asignar, routes/admin.ts) después de mcp_refrescar.
--     Refresca entidad_metricas si tiene más de p_horas y, mientras quede tiempo de los p_segundos, los conceptos de más
--     de p_dias (el más viejo primero; uno sólo empieza si lo que tardó la vez anterior cabe en lo que queda). Así cada
--     vuelta queda bajo los 120 s del pool del panel. Si ya hay uno corriendo, no espera: {"ocupado": true}.
--
-- Permisos: sólo la API (vigia_api, vigia_api_admin) lee estas tablas; no hay personas (los RUC 10 sólo se cuentan).
-- Ojo: entidad_metricas lee mcp_adjudicacion: volver a aplicar la 254 (que la borra y la crea) pide borrar antes
-- entidad_metricas (DROP MATERIALIZED VIEW entidad_metricas) y volver a aplicar ésta.
--
-- DEV:  python -X utf8 backend/scripts/aplicar_migracion.py dev backend/db/migrations/256_entidad_hallazgos.sql
-- PROD: python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/256_entidad_hallazgos.sql
-- Los conceptos quedan sin calcular (los llena el cron, uno o dos por vuelta). Para llenarlos de una vez:
--   SELECT clave, refrescar_gasto_categoria(clave) FROM categoria_gasto ORDER BY orden;

SET lock_timeout = '10s';

-- ─── El periodo ──────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hallazgos_desde() RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT DATE '2023-01-01' $$;

-- ─── El tipo y el grupo de cada entidad ──────────────────────────────────────────────────────────────────────────────

-- El tipo por el nombre oficial (minúsculas sin tildes), con la primera regla que calce: REGLAS_TIPO_ENTIDAD de
-- routes/entidades.ts, en el mismo orden (una mancomunidad no es ninguno). Sin regla, el tipo declarado si es confiable.
CREATE OR REPLACE FUNCTION entidad_clase(p_nombre text, p_tipo text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN n ~ '\m(municipalidad\s+(distrital|de\s+centro\s+poblado)|concejo\s+distrital|gobierno\s+local\s+distrital)\M' THEN 'municipal_distrital'
    WHEN n ~ '\mmunicipalidad\M' THEN 'municipal_provincial'
    WHEN n ~ '\m(jurado nacional de elecciones|oficina nacional de procesos electorales|registro nacional de identificacion|reniec|contraloria general|defensoria del pueblo|banco central de reserva|superintendencia de banca|tribunal constitucional|junta nacional de justicia|consejo nacional de la magistratura|academia de la magistratura|ministerio publico|poder judicial|corte superior de justicia)\M' THEN 'organismo_autonomo'
    WHEN n ~ '^mancomunidad\M' THEN NULL
    WHEN n ~ '\muniversidad\M' THEN 'universidad'
    WHEN n ~ '\mbeneficencia\M' THEN 'beneficencia'
    WHEN n ~ '\m(hospital|clinica|diris|diresa|geresa|essalud|utes|micro\s?red(es)?|enfermedades\s+neoplasicas)\M|\mred(es)?\s+(integradas\s+)?de\s+(servicios\s+de\s+)?salud\M|\mdireccion\s+(regional\s+)?de\s+salud\M|\minstituto\s+(nacional\s+(de\s+salud|materno|de\s+oftalmologia|de\s+rehabilitacion|de\s+ciencias\s+neurologicas)|regional\s+de\s+oftalmologia)|\m(establecimiento|seguro\s+social|seguro\s+integral|servicios\s+basicos)\s+de\s+salud\M|\munidad\s+ejecutora:?\s+(\d+\s+)?(de\s+)?salud\M' THEN 'salud'
    WHEN n ~ '\m(ugel|colegio|unidad\s+de\s+gestion\s+educativa|(direccion|gerencia)\s+regional\s+de\s+educacion)\M|\munidad\s+ejecutora:?\s+(\d+\s+)?educacion\M' THEN 'educacion'
    WHEN n ~ '\mministerio\M|^mef\M' THEN 'ministerio'
    WHEN n ~ '\m(empresa|e\.?p\.?s|entidad\s+prestadora|sedapal|petroleos\s+del\s+peru|petroperu|perupetro|electro\w*|egemsa|egasa|egesur|san\s+gaban|enapu|serpost|servicios\s+postales|corpac|banco\s+de\s+la\s+nacion|corporacion\s+financiera\s+de\s+desarrollo|fondo\s+mivivienda|fonafe|fondo\s+nacional\s+de\s+financiamiento\s+de\s+la\s+actividad\s+empresarial|activos\s+mineros|sociedad\s+electrica|servicio\s+industrial\s+de\s+la\s+marina|sociedad\s+anonima)\M|^servicio\s+(municipal\s+)?de\s+agua\s+potable\M|(^|[^a-z])(s\.?\s?a\.?\s?[ac]?\.?|s\.?\s?r\.?\s?l(tda)?\.?|sac|saa)\s*$' THEN 'empresa_publica'
    WHEN n ~ '\m(ejercito|marina\s+de\s+guerra|fuerza\s+aerea|fuerzas\s+armadas|policia\s+nacional|policial|pnp|rpnp|dirtepol|comando\s+conjunto|militar|iafas)\M|\mdireccion\s+territorial\s+de\s+policia\M' THEN 'fuerzas_armadas'
    WHEN n ~ '\m(programa|proyectos?\s+especial(es)?|provias|plan\s+copesco|foncodes|fondo\s+de\s+cooperacion\s+para\s+el\s+desarrollo\s+social|fondo\s+sierra\s+azul)\M' THEN 'programa'
    WHEN n ~ '\msalud\M' THEN 'salud'
    WHEN n ~ '\m(educacion|educativ[ao]s?|escuela|pedagogico|conservatorio)\M' THEN 'educacion'
    WHEN n ~ '\mgobierno\s+rer?gional\M|\mregion\s+[a-z]|\mgerencia\s+sub-?\s?regional\M' THEN 'gobierno_regional'
    WHEN n ~ '\m(organismo|superintendencia|instituto|institucion\s+vial|autoridad|servicio\s+nacional|servicio\s+de\s+administracion\s+tributaria|agencia|comision|consejo\s+nacional|centro\s+nacional|oficina\s+nacional|oficina\s+de\s+normalizacion\s+previsional|archivo\s+general|biblioteca\s+nacional|procuraduria|zona\s+registral|inpe|sunat|sunarp)\M|^onp\M' THEN 'organismo_publico'
    WHEN n ~ '\mdireccion\s+regional\M' THEN 'gobierno_regional'
    WHEN p_tipo IN ('municipal_distrital', 'municipal_provincial', 'gobierno_regional', 'ministerio', 'empresa_publica') THEN p_tipo
  END
  FROM (SELECT immutable_unaccent(lower(COALESCE(p_nombre, ''))) AS n) x
$$;

-- El grupo de pares. `p_nivel`: el nivel de gobierno de su unidad ejecutora en el MEF (E nacional, R regional, M local),
-- para los organismos que el nombre no ubica (un proyecto especial regional, un instituto vial provincial).
CREATE OR REPLACE FUNCTION entidad_grupo(p_nombre text, p_tipo text, p_nivel text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    -- Un centro poblado (una sola en 2026) no se parece a ninguna municipalidad de distrito.
    WHEN n ~ '\mcentro\s+poblado\M' THEN 'otros'
    -- Antes que las municipalidades: «Instituto Vial Provincial de la Municipalidad de Arequipa».
    WHEN n ~ '\m(instituto|institucion)\s+(vial|de\s+vialidad)\M' THEN 'organismo_municipal'
    WHEN c = 'municipal_distrital' THEN 'municipalidad_distrital'
    WHEN c = 'municipal_provincial' THEN 'municipalidad_provincial'
    WHEN c IN ('gobierno_regional', 'salud', 'educacion', 'universidad', 'empresa_publica') THEN c
    WHEN n ~ '\mgobierno\s+regional\M' OR p_nivel = 'R' THEN 'gobierno_regional'
    WHEN c = 'beneficencia' OR p_nivel = 'M'
      OR n ~ '^servicio\s+de\s+administracion\s+tributaria\M|\mmancomunidad\s+municipal\M|\mmunicipal(es)?\M|\mmetropolitan[oa]s?\M'
      THEN 'organismo_municipal'
    WHEN c IN ('ministerio', 'organismo_autonomo', 'fuerzas_armadas', 'organismo_publico', 'programa') OR p_nivel = 'E' THEN 'nacional'
    ELSE 'otros'
  END
  FROM (SELECT immutable_unaccent(lower(COALESCE(p_nombre, ''))) AS n, entidad_clase(p_nombre, p_tipo) AS c) x
$$;

-- ─── Conceptos de gasto en las órdenes ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categoria_gasto (
  clave          TEXT PRIMARY KEY CHECK (clave ~ '^[a-z_]{3,30}$'),
  nombre         TEXT NOT NULL,
  -- to_tsquery('spanish', …): palabras sin tildes unidas con | y &, con paréntesis. Sin <-> (ver la cabecera).
  consulta       TEXT NOT NULL CHECK (consulta !~ '<'),
  excluir        TEXT CHECK (excluir !~ '<'),
  orden          SMALLINT NOT NULL DEFAULT 0,
  refrescado_at  TIMESTAMPTZ,              -- NULL: todavía no se calculó (la API no lo compara)
  segundos       NUMERIC(8, 1),
  entidades      INT
);

-- Las palabras, revisadas contra una muestra de órdenes de 2025-2026 en DEV (2026-11-06). Lo que se sacó y por qué:
--   eventos    «evento compensable» (cláusula de contratos de obra: los montos más grandes), «bus de eventos» (software),
--              eventos de seguridad digital, eventos adversos (salud) y las tarjetas de consumo «para fiestas patrias y
--              navidad» que se dan al personal.
--   alimentos  sin «cena» sola (casa con «CEN», abreviatura de «central» en descripciones cortadas) y sin los programas
--              sociales (vaso de leche, complementación alimentaria, PCA, PANTBC, comedores, ollas comunes, Qali Warma),
--              las raciones (comedor universitario), la comida de pacientes, cadetes, tropa y penales, y la ayuda a
--              damnificados o albergues.
--   publicidad sin «publicidad» (su raíz es la de «público»), sin «emisora» sola (casa con «emisor», el colector de
--              desagüe), sin «imagen institucional» (compras de la oficina: papel, personal), sin sistemas de alerta
--              temprana ni arriendos.
--   regalos    sin «pavo» solo (casa con «NO PAV.», no pavimentada), sin «galvano» (celda galvánica), sin placas
--              recordatorias de obra y sin las canastas de los programas sociales.
--   alimentos y regalos, además, sin los beneficios del personal: las tarjetas electrónicas de consumo (el «refrigerio»
--              y las canastas por ley o por pacto colectivo: S/ 18 M en el MTC) y lo que cita un pacto colectivo.
-- Las categorías no se excluyen entre sí: «agasajo con juguetes y refrigerios» suma en dos.
INSERT INTO categoria_gasto (clave, nombre, consulta, excluir, orden) VALUES
  ('eventos', 'Eventos, fiestas y espectáculos',
   'evento | espectaculo | show | orquesta | artista | musical | musica | animacion | animador | fiesta | festival | festividad | concierto | toldo | estrado | escenario | sonido | parlante | (juego & luces) | danza | payaso | (hora & loca) | discomovil | serenata | (fuegos & artificiales) | pirotecnico',
   'compensable | software | ciberseguridad | ciberinteligencia | adverso | (seguridad & digital) | (tarjeta & consumo)', 1),
  ('alimentos', 'Alimentos y refrigerios (sin programas sociales)',
   'refrigerio | bocadito | (coffee & break) | catering | buffet | almuerzo | desayuno | lonche | (cena & (navidad | navideno | gala | confraternidad | almuerzo | desayuno)) | agasajo | chocolatada | paneton | banquete | brindis | (vino & honor)',
   '(vaso & leche) | (complementacion & alimentaria) | pca | pantbc | comedor | (olla & comun) | (qali & warma) | racion | paciente | hospitalizado | cadete | tropa | penitenciario | damnificado | albergue | (tarjeta & consumo) | (pacto & colectivo)', 2),
  ('publicidad', 'Publicidad, difusión e imagen',
   'publicitario | propaganda | spot | spots | difusion | perifoneo | gigantografia | banner | merchandising | souvenir | afiche | diptico | triptico | tomatodo | llavero | television | (emisora & (radial | radio)) | radiodifusion | pancarta | banderola | (redes & sociales) | (cobertura & periodistica) | (roll & screen)',
   '(alerta & temprana) | sirena | arrendamiento', 3),
  ('regalos', 'Regalos, premios y canastas',
   'regalo | canasta | juguete | premio | premiacion | trofeo | medalla | obsequio | (pavo & (navidad | navideno))',
   '(vaso & leche) | (complementacion & alimentaria) | pca | pantbc | comedor | (olla & comun) | (qali & warma) | (asistencia & alimentaria) | albergue | damnificado | (tarjeta & consumo) | (pacto & colectivo)', 4)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, consulta = EXCLUDED.consulta, excluir = EXCLUDED.excluir,
  -- Si cambiaron las palabras, lo calculado ya no vale: vuelve a la cola.
  refrescado_at = CASE WHEN categoria_gasto.consulta IS DISTINCT FROM EXCLUDED.consulta
                         OR categoria_gasto.excluir IS DISTINCT FROM EXCLUDED.excluir THEN NULL
                       ELSE categoria_gasto.refrescado_at END;

CREATE TABLE IF NOT EXISTS entidad_gasto_categoria (
  categoria       TEXT NOT NULL REFERENCES categoria_gasto (clave) ON DELETE CASCADE,
  entidad_ruc     TEXT NOT NULL,
  monto           NUMERIC(18, 2) NOT NULL,   -- sin las órdenes de monto dudoso
  ordenes         INT NOT NULL,              -- cada orden una vez (con las de monto dudoso)
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (categoria, entidad_ruc)
);
CREATE INDEX IF NOT EXISTS entidad_gasto_categoria_entidad ON entidad_gasto_categoria (entidad_ruc);

-- Las órdenes desde 2023 cuya descripción calza con el concepto, con las condiciones de entidad_orden_mes (187): en
-- soles, sin anuladas, con monto (o monto dudoso), hasta un mes adelante, cada (entidad, orden, fecha) una vez con la
-- versión del archivo más nuevo. Así el monto se puede dividir por el total de entidad_orden_mes.
-- enable_seqscan = off: el planificador cree que una búsqueda con muchas palabras trae el 10 % de la tabla y prefiere
-- leerla entera calculando to_tsvector en 29 M de filas (más de 3 min); por el índice son segundos.
CREATE OR REPLACE FUNCTION refrescar_gasto_categoria(p_clave text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET work_mem = '256MB' SET effective_io_concurrency = 64 SET enable_seqscan = off AS $$
DECLARE
  v categoria_gasto%ROWTYPE;
  t0 TIMESTAMPTZ := clock_timestamp();
  n INT;
BEGIN
  SELECT * INTO v FROM categoria_gasto WHERE clave = p_clave;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'categoria_gasto: «%» no existe', p_clave;
  END IF;
  DELETE FROM entidad_gasto_categoria WHERE categoria = p_clave;
  INSERT INTO entidad_gasto_categoria (categoria, entidad_ruc, monto, ordenes)
  SELECT p_clave, x.entidad_ruc, COALESCE(sum(x.monto) FILTER (WHERE x.monto_dudoso IS NULL), 0), count(*)
    FROM (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.entidad_ruc, o.monto, o.monto_dudoso
            FROM conosce_ordenes o
           WHERE to_tsvector('spanish'::regconfig, translate(lower(coalesce(descripcion, '')), 'áéíóúüñ', 'aeiouun'))
                   @@ to_tsquery('spanish', v.consulta)
             AND (v.excluir IS NULL
                  OR NOT to_tsvector('spanish'::regconfig, translate(lower(coalesce(descripcion, '')), 'áéíóúüñ', 'aeiouun'))
                           @@ to_tsquery('spanish', v.excluir))
             AND o.fecha_emision >= hallazgos_desde() AND o.fecha_emision < current_date + 32
             AND o.estado IS DISTINCT FROM 'Anulada' AND o.moneda = 'Nuevos Soles' AND o.entidad_ruc ~ '^\d{11}$'
             AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
           ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC) x
   GROUP BY x.entidad_ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE categoria_gasto
     SET refrescado_at = now(), entidades = n, segundos = round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1)
   WHERE clave = p_clave;
  RETURN n;
END $$;

-- ─── Las cifras de cada entidad ──────────────────────────────────────────────────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS entidad_metricas;
CREATE MATERIALIZED VIEW entidad_metricas AS
WITH p AS (
  SELECT hallazgos_desde() AS desde,
         extract(year FROM hallazgos_desde())::int AS anio_desde,
         -- El último año completo (en Lima): el de la ejecución del presupuesto, los diciembres y el tamaño.
         extract(year FROM (now() AT TIME ZONE 'America/Lima'))::int - 1 AS anio_completo
),
-- Procesos con buena pro: una fila por proceso (mcp_adjudicacion trae una por proceso y proveedor).
pr AS (
  SELECT m.entidad_ruc AS ruc, m.codigo_convocatoria,
         bool_or(m.es_directa) AS directa,
         bool_or(m.unico_postor) AS unico,          -- NULL: el proceso no tiene postores cargados
         sum(m.monto) FILTER (WHERE NOT m.dudoso) AS monto
    FROM mcp_adjudicacion m CROSS JOIN p
   WHERE m.anio >= p.anio_desde AND m.entidad_ruc IS NOT NULL
   GROUP BY 1, 2
),
adj AS (
  SELECT ruc, count(*)::int AS procesos, COALESCE(sum(monto), 0) AS monto,
         (count(*) FILTER (WHERE directa))::int AS directas,
         (count(*) FILTER (WHERE NOT directa AND unico IS NOT NULL))::int AS con_postores,
         (count(*) FILTER (WHERE NOT directa AND unico))::int AS unico
    FROM pr GROUP BY 1
),
-- Lo adjudicado a cada proveedor (empresa o consorcio; las personas naturales, sumadas en 'otros', no son uno).
prov AS (
  SELECT m.entidad_ruc AS ruc, m.proveedor_clave, sum(m.monto) FILTER (WHERE NOT m.dudoso) AS monto
    FROM mcp_adjudicacion m CROSS JOIN p
   WHERE m.anio >= p.anio_desde AND m.entidad_ruc IS NOT NULL AND m.proveedor_clave <> 'otros'
   GROUP BY 1, 2
),
top AS (
  SELECT ruc, count(*)::int AS proveedores, COALESCE(sum(monto) FILTER (WHERE n <= 5), 0) AS top5
    FROM (SELECT ruc, monto, row_number() OVER (PARTITION BY ruc ORDER BY monto DESC) AS n FROM prov WHERE monto > 0) x
   GROUP BY 1
),
om AS (
  SELECT m.entidad_ruc AS ruc,
         sum(m.ordenes)::int AS ordenes, sum(m.monto) AS monto, sum(m.monto_personas) AS monto_personas,
         (sum(m.ordenes) FILTER (WHERE m.mes < make_date(p.anio_completo + 1, 1, 1)))::int AS ordenes_completos,
         sum(m.monto) FILTER (WHERE m.mes < make_date(p.anio_completo + 1, 1, 1)) AS monto_completos,
         sum(m.monto) FILTER (WHERE extract(month FROM m.mes) = 12 AND m.mes < make_date(p.anio_completo + 1, 1, 1)) AS monto_diciembre,
         min(m.mes) AS primer_mes
    FROM entidad_orden_mes m CROSS JOIN p
   WHERE m.mes >= p.desde
   GROUP BY 1
),
-- Las órdenes «al borde del tope» que ya citan las señales de empresas (207) y de personas (179), desde 2023.
borde AS (
  SELECT x.entidad_ruc AS ruc, count(*)::int AS ordenes
    FROM (SELECT b.entidad_ruc, c->>'fecha' AS fecha
            FROM empresa_borde_tope b
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.citadas) = 'array' THEN b.citadas ELSE '[]'::jsonb END) c
          UNION ALL
          SELECT s.entidad_ruc, c->>'fecha'
            FROM persona_senal s
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.detalle->'citadas') = 'array' THEN s.detalle->'citadas' ELSE '[]'::jsonb END) c
           WHERE s.tipo = 'al_borde_del_tope') x
    CROSS JOIN p
   WHERE x.fecha ~ '^\d{4}-\d{2}-\d{2}' AND left(x.fecha, 10)::date >= p.desde
   GROUP BY 1
),
mef AS (
  SELECT b.entidad_ruc::text AS ruc, b.sec_ejecs,
         max((y->>'pim')::numeric) FILTER (WHERE (y->>'year')::int = p.anio_completo) AS pim,
         max((y->>'devengado')::numeric) FILTER (WHERE (y->>'year')::int = p.anio_completo) AS devengado,
         max((y->>'pim')::numeric) FILTER (WHERE (y->>'year')::int = p.anio_completo + 1) AS pim_actual,
         max((y->>'devengado')::numeric) FILTER (WHERE (y->>'year')::int = p.anio_completo + 1) AS devengado_actual
    FROM mef_entity_budget b
    CROSS JOIN p
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.by_year) = 'array' THEN b.by_year ELSE '[]'::jsonb END) y
   -- Un cruce con el pliego regional entero («pliego …») es el presupuesto de todo el gobierno regional: no es el suyo.
   WHERE b.kind = 'ok' AND COALESCE(b.keyword, '') NOT LIKE 'pliego %'
   GROUP BY 1, 2
),
-- El nivel de gobierno de sus unidades ejecutoras en el último año del MEF (para ubicar a los organismos).
niv AS (
  SELECT m.ruc, max(a.nivel_gobierno) AS nivel
    FROM mef m
    JOIN mef_ejecutora_anual a ON a.sec_ejec = ANY (m.sec_ejecs) AND a.anio = (SELECT max(anio) FROM mef_ejecutora_anual)
   GROUP BY 1
),
ic AS (
  SELECT i.entidad_ruc::text AS ruc, count(*)::int AS informes,
         (count(*) FILTER (WHERE 'penal' = ANY (i.responsabilidades)))::int AS penal
    FROM informes_control i CROSS JOIN p
   WHERE i.fecha_emision >= p.desde AND i.entidad_ruc IS NOT NULL
   GROUP BY 1
),
ob AS (
  SELECT o.entidad_ruc::text AS ruc,
         (count(*) FILTER (WHERE o.estado IN ('En Ejecución', 'Paralizada')))::int AS activas,
         (count(*) FILTER (WHERE o.estado = 'Paralizada'))::int AS paralizadas
    FROM obra_infobras o
   WHERE o.entidad_ruc IS NOT NULL AND NOT COALESCE(o.retirada, false)
   GROUP BY 1
),
base AS (
  SELECT e.ruc::text AS ruc, e.nombre,
         entidad_grupo(e.nombre, e.tipo, niv.nivel) AS grupo,
         NULLIF(upper(immutable_unaccent(btrim(COALESCE(e.region, '')))), '') AS departamento,
         niv.nivel AS nivel_mef,
         p.anio_completo,
         COALESCE(NULLIF(mef.pim, 0), mef.pim_actual) AS pim_ref,
         COALESCE(adj.procesos, 0) AS adj_procesos, COALESCE(adj.monto, 0)::float8 AS adj_monto,
         COALESCE(adj.directas, 0) AS adj_directas, COALESCE(adj.con_postores, 0) AS adj_con_postores,
         COALESCE(adj.unico, 0) AS adj_unico,
         COALESCE(top.top5, 0)::float8 AS adj_top5_monto, COALESCE(top.proveedores, 0) AS adj_proveedores,
         COALESCE(om.ordenes, 0) AS ord_ordenes, COALESCE(om.monto, 0)::float8 AS ord_monto,
         COALESCE(om.monto_personas, 0)::float8 AS ord_monto_personas,
         COALESCE(om.ordenes_completos, 0) AS ord_ordenes_completos, COALESCE(om.monto_completos, 0)::float8 AS ord_monto_completos,
         COALESCE(om.monto_diciembre, 0)::float8 AS ord_monto_diciembre,
         COALESCE(borde.ordenes, 0) AS borde_ordenes,
         mef.pim::float8 AS mef_pim, mef.devengado::float8 AS mef_devengado,
         mef.pim_actual::float8 AS mef_pim_actual, mef.devengado_actual::float8 AS mef_devengado_actual,
         COALESCE(ic.informes, 0) AS ctl_informes, COALESCE(ic.penal, 0) AS ctl_penal,
         COALESCE(ob.activas, 0) AS obras_activas, COALESCE(ob.paralizadas, 0) AS obras_paralizadas
    FROM entidades e
    CROSS JOIN p
    LEFT JOIN adj ON adj.ruc = e.ruc::text
    LEFT JOIN top ON top.ruc = e.ruc::text
    LEFT JOIN om ON om.ruc = e.ruc::text
    LEFT JOIN borde ON borde.ruc = e.ruc::text
    LEFT JOIN mef ON mef.ruc = e.ruc::text
    LEFT JOIN niv ON niv.ruc = e.ruc::text
    LEFT JOIN ic ON ic.ruc = e.ruc::text
    LEFT JOIN ob ON ob.ruc = e.ruc::text
   -- Sin las filas con un nombre que no es un nombre («nan» de una carga vieja).
   WHERE e.nombre !~* '^\s*(nan|none|null|n/?a|-+)?\s*$'
)
SELECT b.*,
       -- El tercio de presupuesto dentro de su grupo (1 el más chico); NULL sin PIM: se compara con todo el grupo.
       CASE WHEN b.pim_ref > 0 THEN ntile(3) OVER (PARTITION BY b.grupo, b.pim_ref > 0 ORDER BY b.pim_ref) END::smallint AS banda
  FROM base b;

-- La llave (la pide REFRESH ... CONCURRENTLY).
CREATE UNIQUE INDEX entidad_metricas_llave ON entidad_metricas (ruc);
CREATE INDEX entidad_metricas_grupo ON entidad_metricas (grupo, banda);

-- ─── Estado y refresco ───────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hallazgos_estado (
  id             BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  refrescado_at  TIMESTAMPTZ NOT NULL,
  segundos       NUMERIC(8, 1),
  entidades      INT
);

CREATE OR REPLACE FUNCTION refrescar_hallazgos(p_horas NUMERIC DEFAULT 20, p_segundos NUMERIC DEFAULT 90, p_dias NUMERIC DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '128MB' AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  t1 TIMESTAMPTZ;
  v_ultimo TIMESTAMPTZ;
  v_metricas JSONB := 'null'::jsonb;
  v_cats JSONB := '[]'::jsonb;
  r RECORD;
  n INT;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_hallazgos')) THEN
    RETURN jsonb_build_object('ocupado', true);
  END IF;
  SELECT refrescado_at INTO v_ultimo FROM hallazgos_estado WHERE id;
  IF COALESCE(p_horas, 0) <= 0 OR v_ultimo IS NULL
     OR v_ultimo < now() - make_interval(secs => (p_horas * 3600)::double precision) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY entidad_metricas;
    SELECT count(*) INTO n FROM entidad_metricas;
    INSERT INTO hallazgos_estado (id, refrescado_at, segundos, entidades)
    VALUES (true, now(), round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1), n)
    ON CONFLICT (id) DO UPDATE SET refrescado_at = EXCLUDED.refrescado_at, segundos = EXCLUDED.segundos, entidades = EXCLUDED.entidades;
    v_metricas := jsonb_build_object('entidades', n, 'segundos', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1));
  END IF;
  -- Los conceptos, el más viejo primero (los nunca calculados antes). Uno empieza si lo que tardó la vez anterior (60 s
  -- si nunca se calculó), con un margen, cabe en lo que queda de los p_segundos; y si en esta vuelta no se hizo nada
  -- todavía, empieza igual (en DEV, en frío, el más lento tardó 72 s: con 90 de presupuesto nunca «cabría» con margen).
  -- Si uno pasara los 120 s del pool, se cancela la sentencia entera y se reintenta en la vuelta siguiente, con las
  -- páginas ya leídas en la caché.
  FOR r IN SELECT clave, segundos FROM categoria_gasto
            WHERE refrescado_at IS NULL OR refrescado_at < now() - make_interval(secs => (COALESCE(p_dias, 7) * 86400)::double precision)
            ORDER BY refrescado_at NULLS FIRST, orden LOOP
    EXIT WHEN NOT (
      (v_metricas = 'null'::jsonb AND jsonb_array_length(v_cats) = 0 AND extract(epoch FROM clock_timestamp() - t0) < 10)
      OR extract(epoch FROM clock_timestamp() - t0) + 1.2 * COALESCE(r.segundos, 60) <= p_segundos);
    t1 := clock_timestamp();
    n := refrescar_gasto_categoria(r.clave);
    v_cats := v_cats || jsonb_build_object('clave', r.clave, 'entidades', n,
                                           'segundos', round(extract(epoch FROM clock_timestamp() - t1)::numeric, 1));
  END LOOP;
  RETURN jsonb_build_object('metricas', v_metricas, 'categorias', v_cats,
                            'segundos', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1));
END $$;

-- La primera marca (la vista recién creada ya tiene sus datos).
INSERT INTO hallazgos_estado (id, refrescado_at, entidades)
VALUES (true, now(), (SELECT count(*) FROM entidad_metricas))
ON CONFLICT (id) DO UPDATE SET refrescado_at = EXCLUDED.refrescado_at, entidades = EXCLUDED.entidades;

-- ─── Dueños y permisos (como la 254) ─────────────────────────────────────────────────────────────────────────────────

-- REFRESH exige ser dueño de la vista: todo es de vigia_jobs (lee las tablas de origen).
ALTER MATERIALIZED VIEW entidad_metricas OWNER TO vigia_jobs;
ALTER TABLE categoria_gasto OWNER TO vigia_jobs;
ALTER TABLE entidad_gasto_categoria OWNER TO vigia_jobs;
ALTER TABLE hallazgos_estado OWNER TO vigia_jobs;
ALTER FUNCTION hallazgos_desde() OWNER TO vigia_jobs;
ALTER FUNCTION entidad_clase(text, text) OWNER TO vigia_jobs;
ALTER FUNCTION entidad_grupo(text, text, text) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_gasto_categoria(text) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) OWNER TO vigia_jobs;

-- Sólo la API las lee. Los privilegios por defecto (37, 43, 44) le dan SELECT a otros roles en toda tabla nueva: fuera.
REVOKE ALL ON entidad_metricas, categoria_gasto, entidad_gasto_categoria, hallazgos_estado FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_mcp', 'vigia_ab', 'vigia_agentes'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON entidad_metricas, categoria_gasto, entidad_gasto_categoria, hallazgos_estado FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT SELECT ON entidad_metricas, categoria_gasto, entidad_gasto_categoria, hallazgos_estado TO vigia_api, vigia_api_admin;

-- Las funciones de refresco: sólo el cron de la API (pool del panel, vigia_api_admin, 120 s por sentencia).
REVOKE ALL ON FUNCTION refrescar_gasto_categoria(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION refrescar_gasto_categoria(text) FROM vigia_agentes;
    REVOKE ALL ON FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) FROM vigia_agentes;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) TO vigia_api_admin;
