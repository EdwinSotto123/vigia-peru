-- Los agentes leen lo que Vigía ya calculó de las personas naturales contratadas (órdenes por entidad y sus señales:
-- declaraciones juradas de intereses, planilla, JNE, ONPE, visitas). Con eso el expediente de un ganador con RUC 10
-- sale de la base y no de un servicio externo. Sólo lectura; el agente usa el tipo de señal, no su detalle.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.persona_entidad, public.persona_senal TO %I', r);
    END IF;
  END LOOP;
END $$;
