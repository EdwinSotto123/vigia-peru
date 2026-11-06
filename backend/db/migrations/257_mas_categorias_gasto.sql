-- 257 · Más conceptos de gasto para comparar a cada entidad con sus pares, cuáles son señal y cuáles contexto, y un
-- refresco más barato.
--
-- La 256 creó categoria_gasto con cuatro conceptos (eventos, alimentos, publicidad, regalos); la API convierte cada fila
-- en una cifra gasto_<clave> (qué parte del monto de sus órdenes fue a ese concepto) para GET /entidades/:ruc/hallazgos y
-- GET /hallazgos/ranking (lib/hallazgos.ts). Aquí:
--
--   categoria_gasto.es_senal  false: gasto normal de operación (telefonía, mantenimiento de vehículos, alquiler de
--                             maquinaria). Se compara con los pares como CONTEXTO («en qué gasta»), pero nunca es hallazgo:
--                             que una municipalidad con un pool de maquinaria la mantenga más que sus pares no es raro.
--                             true (por defecto, y los cuatro de la 256): gasto discrecional, que es hallazgo si cae en el
--                             10 % más alto de sus pares. La API lee la columna con SELECT * (sin ella, todo es señal).
--   siete conceptos nuevos    cuatro señales (viajes, asesorías, alquiler de camionetas, uniformes) y tres de contexto,
--                             con las palabras revisadas contra una muestra del 5 % de las órdenes desde 2023 en DEV (715
--                             mil, 2026-11-06): lo que se sacó y por qué va junto a cada uno.
--   refrescar_gasto_categoria `excluir` va DENTRO del tsquery («(consulta) & !(excluir)»): el índice GIN descarta esas
--                             filas sin leerlas del heap. Como filtro aparte (256) cada fila excluida se leía igual: el
--                             tiempo lo pone la lectura de páginas del heap (en DEV, ~1 ms por orden encontrada, en frío
--                             o «en caliente»: 15 GB no caben en la caché). Mismo resultado.
--   refrescar_hallazgos       no empieza un concepto que la vez anterior tardó más de 100 s: no cabe en los 120 s del pool
--                             del panel, se cancelaría la vuelta entera y, como queda primero en la cola, trabaría a todos
--                             los demás para siempre. Uno así se refresca a mano (ver abajo).
--
-- Las mismas reglas de la 256: palabras sin tildes unidas con | y &, con paréntesis; sin <-> (frases), que obligan al
-- GIN a volver a calcular to_tsvector en cada fila candidata. Lo negado («!») va DENTRO de `consulta`
-- («(viatico & !(responsable | auxiliar))»); `excluir` sólo lleva palabras y grupos con &, porque «profundizar» lo pasa
-- tal cual a gasto_por_concepto como términos a quitar, y ese no sabe de condiciones (sacaría de más). Ojo con las raíces
-- del español (to_tsvector 'spanish'): «calzado» = «calzada», «boleto» = «boleta», «celular» = «celulosa»,
-- «consultoría» = «consultorio», «vehículo» = «vehicular», «local» = «localidad», «vigilante» = «vigilancia», «polo» =
-- «POL.», «alquiler» ≠ «alquileres» (van las dos), «público» = «pública» = «publicidad», «flor» = «Flores» = «Florida».
--
-- Probados y FUERA de esta migración:
--   por lo que cuesta refrescarlos (son tan frecuentes que cada uno lee un tercio del heap de conosce_ordenes: más de los
--   120 s del cron aun con excluir dentro del tsquery; en DEV, limpieza 215 s en frío y 135 s con esta función):
--   combustible y lubricantes (~120 s), seguridad y vigilancia (~145 s), limpieza y fumigación (135 s), útiles de
--   oficina y fotocopiado (~130 s). Necesitan un índice GIN parcial desde 2023 (la mitad de filas) o un recorrido único
--   por semana fuera del cron. Sus palabras ya revisadas, para entonces:
--     combustible  '(combustible & !filtro) | gasolina | gasohol | petroleo | (diesel & !(camioneta | electrogeno |
--                  motobomba | motor)) | biodiesel | db5 | glp | lubricante | (aceite & (motor | hidraulico | transmision))'
--                  excluir 'alquiler | alquileres | arrendamiento | (estacion & (implementacion | construccion | instalacion))'
--     vigilancia   'vigilancia | vigilante | guardiania | (seguridad & privada)'
--                  excluir 'video | videovigilancia | camara | cctv | serenazgo | patrullaje | epidemiologica |
--                  entomologica | vectorial | aedes | sanitaria | nutricional | febriles | caseta | (calidad & agua)'
--     limpieza     '(limpieza & !(publica & !(concurso | ministerio | licitacion))) | fumigacion | desinfeccion |
--                  desratizacion | desinsectacion | jabon | detergente | lejia | escoba | trapeador | (papel & higienico)'
--                  excluir 'barrido | residuos | recoleccion | basura | contenedor | cauce | rio | canal | descolmatacion |
--                  quebrada | drenaje | acequia | alcantarillado | desague | buzon | colector | reservorio | pozo | via | vias |
--                  vial | vecinal | camino | carretera | trocha | calles | playa | terreno | maleza | obra | volquete |
--                  maquinaria'
--     utiles       '(utiles & (oficina | escritorio)) | papeleria | (toner & !(camion | volquete | carga)) | (tinta &
--                  (impresora | toner | cartucho | multifuncional | impresion)) | (cartucho & (tinta | toner | impresora))
--                  | (papel & bond) | resma | lapicero | boligrafo | folder | plumon | (archivador & (palanca | carton |
--                  plastico | utiles)) | (fotocopia & !(adquisicion | compra)) | (impresion & (fotocopia | escaneo |
--                  outsourcing | documentos))'
--                  excluir 'estudiantes | escolar | alumnos | dotacion | cuadernillo | texto | cuento | analizador |
--                  merchandising'
--   por ruido: flores y coronas (casi todo eran apellidos —Flores, Coronado—, lugares —La Florida—, «flora y fauna» y la
--   «corona» de pozos y muros; lo que queda, arreglos de S/ 400 a 4 mil, no llega al piso de S/ 50 mil y 1 % en casi
--   ninguna entidad) y bebidas y licores («pisco» es sobre todo la provincia de Pisco, «bebé» tiene la raíz de «bebida»
--   y las bebidas de verdad van con los alimentos —«alimentos y bebidas para consumo humano»—: ya suman en `alimentos`).
--   Tampoco los estudios y la consultoría de obra (expedientes, supervisión, preinversión): son inversión y los explican
--   sus obras; quedan fuera de `asesorias`.
--
-- DEV:  python -X utf8 backend/scripts/aplicar_migracion.py dev backend/db/migrations/257_mas_categorias_gasto.sql
-- PROD: python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/257_mas_categorias_gasto.sql
-- Los conceptos nuevos quedan sin calcular. El cron los haría primero (los nunca calculados van antes), uno por vuelta,
-- pero en PROD conviene llenarlos a mano apenas aplicada, sin el límite de 120 s del pool: el tope de 100 s de abajo
-- mira lo que tardó la vez anterior, y uno nunca calculado que pasara los 120 s en el cron trabaría la cola. En DEV, en
-- frío y con otra carga pesada en la base, de 28-36 s (alquiler de maquinaria) a 79-86 s (telefonía, mantenimiento,
-- asesorías); en caliente, de 1 a 25 s (asesorías, una vez, 48 s). Los tiempos quedan en categoria_gasto.segundos:
--   SELECT clave, refrescar_gasto_categoria(clave) FROM categoria_gasto WHERE refrescado_at IS NULL ORDER BY orden;

SET lock_timeout = '10s';

ALTER TABLE categoria_gasto ADD COLUMN IF NOT EXISTS es_senal boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN categoria_gasto.es_senal IS
  'false: gasto normal de operación; la API lo compara como contexto y nunca lo marca como hallazgo (257).';

INSERT INTO categoria_gasto (clave, nombre, consulta, excluir, orden, es_senal) VALUES
  -- ── Señales: gastos discrecionales ────────────────────────────────────────────────────────────────────────────────
  -- viajes: «pasaje» es también la calle (obras de movilidad urbana «en el pasaje Los Olivos»: lo más grande de la
  --   muestra), «boleto» casa con «boleta» (de venta, de pago), «alojamiento» es también el housing de servidores y la
  --   nube, «viaje» es el de un volquete o una cisterna, «viático» el del locador que los tramita y «hospedaje» el
  --   municipal. «Pasaje» suelto se queda (casi siempre son pasajes: «compra de pasajes»), pero sin nada de una calle
  --   («mantenimiento de graderías, barandas y pasajes», «señalización en el pasaje San Pedro», materiales, trocha). Sin
  --   los pasajes de pacientes del SIS y oncológicos (referencias: salud, no viajes del personal), sin el locador que
  --   tramita viáticos o escribe su directiva, sin la capacitación en hospedajes turísticos ni los vuelos de drones.
  ('viajes', 'Pasajes, viáticos y hospedaje',
   'pasaje | (boleto & (aereo | terrestre | viaje | pasaje | ruta)) | vuelo | (agencia & viajes) | (viaje & (comision | pasaje | aereo | terrestre)) | (viatico & !(responsable | auxiliar | asistente | rendicion | planilla | revision | registro | elaboracion)) | (hospedaje & !(municipal | responsable)) | (alojamiento & !(housing | hosting | nube | datos | servidores | tecnologica | web | plataforma))',
   'obra | movilidad | urbana | transitabilidad | via | vias | vial | calle | jiron | avenida | mantenimiento | infraestructura | paciente | oncologico | auxiliar | vereda | sardinel | pavimento | pista | escalinata | graderia | baranda | murete | peatonal | senalizacion | alumbrado | alcantarillado | buzon | trocha | quebrada | matriz | perforacion | materiales | ferreteria | construccion | turistico | restaurante | directiva | otorgamiento | dron | fotogrametrico',
   5, true),
  -- asesorias: asesoría legal, contable o de gestión, consultores, defensa legal de funcionarios y arbitrajes. Sin la
  --   consultoría de obra (expediente técnico —también «exp. técnico» y «xpediente»—, preinversión, PIP, IOARR, fichas,
  --   CUI, supervisión, liquidación, PTAR y todo lo que nombra un proyecto de Invierte.pe: «mejoramiento / creación /
  --   ampliación … del servicio de …»: es inversión), sin «consultorio» (misma raíz: consultorio externo, mantenimiento
  --   de consultorios), sin el arbitraje de un campeonato de fulbito y sin el personal de apoyo de la oficina de asesoría
  --   jurídica (auxiliares, secretarias, asistentes, coordinadores).
  ('asesorias', 'Asesorías, consultorías y defensa legal (sin estudios ni supervisión de obras)',
   'asesoria | asesor | consultoria | consultor | (arbitraje & !(campeonato | futsal | futbol | voley | deportivo | deporte | partido)) | (patrocinio & (legal | judicial | abogado)) | (defensa & legal)',
   'obra | expediente | xpediente | (exp & tecnico) | preinversion | inversion | pip | ioarr | ioar | cui | ficha | perfil | supervision | estudio | liquidacion | reformulacion | ptar | ((mejoramiento | creacion | ampliacion | recuperacion | rehabilitacion | instalacion) & servicio) | medico | enfermeria | tecnologo | paciente | odontologico | reparacion | mantenimiento | mtto | matto | emergencia | auxiliar | secretaria | asistente | coordinador | (oficina & juridica)',
   6, true),
  -- alquiler_vehiculos: camionetas, autos, minivanes y buses para llevar personal (la camioneta «para la alcaldía»). La
  --   maquinaria pesada, los volquetes y los camiones van en alquiler_maquinaria, y también los «vehículos» para el
  --   recojo de residuos sólidos (S/ 46 M en una municipalidad de Lima: son compactadoras); sin los locales y cocheras para
  --   vehículos, sin «vehicular» (transitabilidad vehicular: obras) y sin martillos, mezcladoras ni compresoras.
  ('alquiler_vehiculos', 'Alquiler de camionetas y vehículos (sin maquinaria pesada)',
   '(alquiler | alquileres | arrendamiento) & (camioneta | automovil | auto | minivan | van | bus | coaster | custer | motocicleta | moto | (vehiculo & !(transitabilidad | pesado | deposito | chatarreo)))',
   'residuos | solidos | recoleccion | basura | camion | volquete | maquinaria | martillo | mezcladora | compresora | cisterna | baranda | compactadora | grua | cargador | excavadora | retroexcavadora | motoniveladora | tractor | rodillo | inmueble | cochera | estacionamiento | almacenamiento | albergar | (local & (funcionamiento | oficina))',
   7, true),
  -- uniformes: uniformes institucionales, de serenazgo y de obreros, polos, chalecos y casacas institucionales. Sin el
  --   equipo de protección personal (EPP, zapatos de seguridad con punta de acero, chalecos antibalas y reflectivos), sin
  --   «vestuario» como ambiente (vestuarios y SSHH en obras y remodelaciones), sin «calzado» suelto (misma raíz que
  --   «calzada») ni «polo» suelto (abreviatura de policlínico) y sin lo que cita un pacto o convenio colectivo.
  ('uniformes', 'Uniformes y vestuario (sin equipos de protección)',
   'uniforme | vestuario | (polo & (algodon | manga | camisero | cuello | pique | confeccion | estampado | bordado | talla | institucional)) | casaca | chaleco | (calzado & (vestuario | uniforme | cuero | dama | caballero)) | zapato | zapatilla | camisa | camiseta | pantalon | buzo | chompa | gorro | indumentaria',
   'epp | epps | proteccion | acero | (zapato & seguridad) | (botin & seguridad) | antibalas | salvavidas | reflectivo | sshh | remodelacion | construccion | obra | ioarr | lavado | lavanderia | habilitacion | acondicionamiento | mtto | taller | (pacto & colectivo) | (convenio & colectivo)',
   8, true),
  -- ── Contexto: gastos normales de operación ────────────────────────────────────────────────────────────────────────
  -- telefonia: telefonía fija y móvil, internet y enlaces de datos. Sin las obras de «mejoramiento del servicio de
  --   cobertura de telefonía móvil» (amplificadores y repetidoras: inversión, lo primero del ranking de distritos), sin
  --   «celular» suelto (misma raíz que «celulosa»: los apósitos de acetato de celulosa de un hospital) ni el teléfono de
  --   juguete de un evento.
  ('telefonia', 'Telefonía e internet',
   'telefonia | telefono | internet | celulares | (celular & (linea | movil | plan | chip | recarga)) | (transmision & datos) | (enlace & datos) | (linea & dedicada)',
   'obra | cobertura | amplificador | repetidor | repetidora | juguete | aposito',
   9, false),
  -- mantenimiento_vehiculos: el servicio de mantenimiento y reparación de vehículos y maquinaria pesada. Sin el
  --   mantenimiento de vías (transitabilidad «vehicular», caminos, puentes, canales) ni de locales y coberturas, sin el
  --   alquiler de maquinaria «para el mantenimiento» de algo, sin las compras de volquetes y motoniveladoras de un
  --   proyecto de «servicios operativos o misionales» (IOARR) para el «departamento de mantenimiento», sin «maquinaria»
  --   suelta (es también el nombre de oficinas: «sub unidad de maquinaria y mantenimiento», que firma todo lo que
  --   mantiene), sin impresoras ni las compras de combustible para la maquinaria de mantenimiento. Sin los
  --   repuestos y las llantas sueltos (lo que no dice mantenimiento ni reparación): con ellos el refresco tardaba 97 s en
  --   frío en DEV, al borde de los 120 s del cron; sin ellos, 84 s.
  ('mantenimiento_vehiculos', 'Mantenimiento y reparación de vehículos y maquinaria pesada',
   '(mantenimiento | reparacion) & (vehiculo | camioneta | camion | volquete | motocicleta | moto | ambulancia | compactadora | automovil | flota | automotor | excavadora | retroexcavadora | cargador | motoniveladora | tractor | (maquinaria & (pesada | pool)))',
   'alquiler | alquileres | arrendamiento | misionales | transitabilidad | via | vias | vial | vecinal | carretera | camino | trocha | puente | canal | infraestructura | cobertura | estructura | consultoria | ficha | impresora | plotter | combustible | gasolina | gasohol | petroleo | b5 | s50',
   10, false),
  -- alquiler_maquinaria: maquinaria pesada, volquetes, cisternas y camiones (obras por administración directa, recojo de
  --   residuos —también los «vehículos para la recolección de residuos»—, emergencias). Sin los locales para guardarla.
  ('alquiler_maquinaria', 'Alquiler de maquinaria pesada, volquetes y camiones',
   '(alquiler | alquileres | arrendamiento) & (maquinaria | volquete | excavadora | retroexcavadora | cargador | minicargador | motoniveladora | tractor | rodillo | cisterna | compactadora | camion | grua | (hora & maquina) | (vehiculo & (residuos | recoleccion | basura)))',
   'inmueble | cochera | estacionamiento | almacenamiento | albergar | (local & (funcionamiento | oficina))',
   11, false)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, consulta = EXCLUDED.consulta, excluir = EXCLUDED.excluir,
  es_senal = EXCLUDED.es_senal,
  -- Si cambiaron las palabras, lo calculado ya no vale: vuelve a la cola.
  refrescado_at = CASE WHEN categoria_gasto.consulta IS DISTINCT FROM EXCLUDED.consulta
                         OR categoria_gasto.excluir IS DISTINCT FROM EXCLUDED.excluir THEN NULL
                       ELSE categoria_gasto.refrescado_at END;

-- ─── El refresco: excluir dentro del tsquery ─────────────────────────────────────────────────────────────────────────

-- Igual que en la 256 (mismas condiciones de entidad_orden_mes, misma expresión del índice de la 255 al carácter), salvo
-- que `excluir` va dentro del tsquery: «a & !b» lo resuelve el GIN con sus listas (sabe qué filas tienen «b»), así que
-- las filas excluidas no se leen del heap. Con un tsquery vacío (sólo palabras vacías) to_tsquery avisa y no calza nada.
CREATE OR REPLACE FUNCTION refrescar_gasto_categoria(p_clave text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET work_mem = '256MB' SET effective_io_concurrency = 64 SET enable_seqscan = off AS $$
DECLARE
  v categoria_gasto%ROWTYPE;
  q tsquery;
  t0 TIMESTAMPTZ := clock_timestamp();
  n INT;
BEGIN
  SELECT * INTO v FROM categoria_gasto WHERE clave = p_clave;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'categoria_gasto: «%» no existe', p_clave;
  END IF;
  q := to_tsquery('spanish', CASE WHEN v.excluir IS NULL OR btrim(v.excluir) = '' THEN v.consulta
                                  ELSE '(' || v.consulta || ') & !(' || v.excluir || ')' END);
  DELETE FROM entidad_gasto_categoria WHERE categoria = p_clave;
  INSERT INTO entidad_gasto_categoria (categoria, entidad_ruc, monto, ordenes)
  SELECT p_clave, x.entidad_ruc, COALESCE(sum(x.monto) FILTER (WHERE x.monto_dudoso IS NULL), 0), count(*)
    FROM (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.entidad_ruc, o.monto, o.monto_dudoso
            FROM conosce_ordenes o
           WHERE to_tsvector('spanish'::regconfig, translate(lower(coalesce(descripcion, '')), 'áéíóúüñ', 'aeiouun')) @@ q
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

-- ─── El cron: no empezar lo que no cabe ──────────────────────────────────────────────────────────────────────────────

-- Igual que en la 256, salvo la última condición del FOR: un concepto que la vez anterior tardó más de 100 s no entra
-- (con el «empieza igual si es el primero» de la 256, pasaría los 120 s del pool, se cancelaría la vuelta entera y,
-- como el más viejo va primero, la próxima vuelta lo intentaría otra vez: ningún otro concepto se volvería a refrescar).
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
  -- Nunca uno que ya tardó más de 100 s: ése se refresca a mano (SELECT refrescar_gasto_categoria('<clave>')).
  FOR r IN SELECT clave, segundos FROM categoria_gasto
            WHERE (refrescado_at IS NULL OR refrescado_at < now() - make_interval(secs => (COALESCE(p_dias, 7) * 86400)::double precision))
              AND COALESCE(segundos, 0) <= 100
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

-- CREATE OR REPLACE conserva dueño (vigia_jobs) y permisos de la 256; se repiten por si la 256 se aplicó a medias.
ALTER FUNCTION refrescar_gasto_categoria(text) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) OWNER TO vigia_jobs;
REVOKE ALL ON FUNCTION refrescar_gasto_categoria(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_hallazgos(NUMERIC, NUMERIC, NUMERIC) TO vigia_api_admin;
