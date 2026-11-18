-- 353 · Mínimo privilegio: el rol de los agentes escribe sólo donde escribe, y las tablas nuevas ya no nacen abiertas.
--
-- Auditoría del 2026-11-17 (pedido del usuario: «que no haya fuga de datos, endpoints expuestos, que la base esté
-- segura»). Lo que se encontró en la base:
--
--   1. Los privilegios POR OMISIÓN de `postgres` daban a `vigia_agentes` lectura y ESCRITURA (INSERT, UPDATE, DELETE) en
--      toda tabla nueva, uso de toda secuencia y ejecución de toda función, y a `vigia_ab` lectura. Resultado: los agentes
--      (Lambdas que leen documentos de terceros con un modelo de lenguaje: el blanco natural de una inyección de
--      instrucciones) podían escribir en 211 tablas. En el código y en cuatro semanas de pg_stat_statements escriben en
--      once: alertas, banderas, entidades, documentos, postores, ofertas, documentos_texto, convocatoria_items,
--      opiniones_oece_estructurado, empresas y convocatorias. Todos los disparadores de esas tablas son SECURITY DEFINER
--      (no necesitan permisos del que escribe).
--   2. Por lo mismo, las tablas del 2026-11-17 (grupos de proveedores con 81 770 RUC 10, que llevan el DNI; vínculos con
--      nombres completos; compras repetidas; dos ingresos del Estado con nombres completos; red de familia) quedaron
--      legibles y escribibles para los agentes y legibles para vigia_ab y vigia_mcp. La regla de la casa (213, 301, 302):
--      una tabla con datos de personas la lee la API y nadie más.
--   3. Dos funciones SECURITY DEFINER de mantenimiento (refrescar_poder, refrescar_senales_sunat) eran ejecutables por
--      PUBLIC: cualquier rol podía lanzar un refresco pesado con los permisos de su dueño. Y borrar_cuenta, gobserva_suscribir,
--      aplicar_padron_sunat y otros refrescos SECURITY DEFINER eran ejecutables por los agentes y por vigia_ab.
--
-- Lo que hace:
--   · vigia_agentes: sin escritura en ninguna tabla salvo las once; secuencias, sólo las de esas tablas.
--   · Tablas de personas de hoy: sólo la API (y vigia_jobs, su dueño). sancion_segun_ficha y oece_ficha_proveedor siguen
--     legibles para los agentes (tools/expediente.py las lee) y sin escritura.
--   · Privilegios por omisión: una tabla, secuencia o función nueva ya NO le da nada a vigia_agentes ni a vigia_ab. Si
--     un agente necesita una tabla nueva, su migración lo dice con un GRANT. vigia_api conserva la lectura por omisión
--     (las tablas privadas la siguen revocando una por una, como hasta ahora).
--   · Funciones: fuera PUBLIC de los dos refrescos; fuera agentes y vigia_ab de las de mantenimiento y de cuentas.
--
-- Para deshacer el punto 1 (si un agente falla con «permission denied for table X»): GRANT INSERT, UPDATE, DELETE ON X TO
-- vigia_agentes; y sumar X a la lista de abajo.

BEGIN;

-- ── 1 · vigia_agentes escribe sólo en sus once tablas ────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM vigia_agentes;
GRANT INSERT, UPDATE, DELETE ON
  public.alertas, public.banderas, public.entidades, public.documentos, public.postores, public.ofertas, public.documentos_texto,
  public.convocatoria_items, public.opiniones_oece_estructurado, public.empresas, public.convocatorias
  TO vigia_agentes;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM vigia_agentes;
DO $$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT DISTINCT pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) AS seq
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name IN ('alertas', 'banderas', 'entidades', 'documentos', 'postores', 'ofertas', 'documentos_texto', 'convocatoria_items',
                            'opiniones_oece_estructurado', 'empresas', 'convocatorias')
       AND pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) IS NOT NULL
  LOOP
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO vigia_agentes', s.seq);
  END LOOP;
END $$;

-- ── 2 · Las tablas de personas del 2026-11-17: sólo la API ───────────────────────────────────────────────────────────
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['grupo_proveedor', 'grupo_proveedor_vinculo', 'grupo_proveedor_resumen', 'ordenes_repetidas', 'empresa_pariente_funcionario',
                           'funcionario_familiar', 'funcionario_familia_resumen', 'doble_percepcion', 'precios_lab_cola', 'dji_nepotismo_pares_estado',
                           'dji_nepotismo_pares_hecho'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      FOREACH r IN ARRAY ARRAY['vigia_agentes', 'vigia_ab', 'vigia_mcp'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  -- Las fichas del OECE (sanciones): los agentes las leen (tools/expediente.py); nadie más que su dueño las escribe.
  FOREACH t IN ARRAY ARRAY['sancion_segun_ficha', 'oece_ficha_proveedor'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM vigia_agentes, vigia_ab, vigia_mcp', t);
      EXECUTE format('GRANT SELECT ON public.%I TO vigia_agentes, vigia_ab', t);
    END IF;
  END LOOP;
END $$;

-- ── 3 · Lo nuevo ya no nace abierto para los agentes ni para vigia_ab ────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM vigia_agentes, vigia_ab;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM vigia_agentes, vigia_ab;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM vigia_agentes, vigia_ab;

-- ── 4 · Funciones: mantenimiento y cuentas, fuera del alcance de quien no las llama ──────────────────────────────────
DO $$
DECLARE f record;
BEGIN
  -- SECURITY DEFINER de mantenimiento ejecutables por PUBLIC: sólo su dueño (vigia_jobs: el Worker de scrapers y el CI).
  FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('refrescar_poder', 'refrescar_senales_sunat') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.firma);
  END LOOP;
  -- Mantenimiento y cuentas: ni los agentes ni vigia_ab (ninguno las llama; la API y los trabajos conservan lo suyo).
  FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f'
              AND (p.proname ~ '^(refrescar|refresh|aplicar|ajustar|calibrar|dedup|marcar_grupos|correr|encolar)_'
                   OR p.proname IN ('borrar_cuenta', 'gobserva_suscribir', 'asignar_contribucion', 'mcp_refrescar', 'gobserva_refrescar_proyectos')) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM vigia_agentes, vigia_ab', f.firma);
  END LOOP;
END $$;

COMMIT;
