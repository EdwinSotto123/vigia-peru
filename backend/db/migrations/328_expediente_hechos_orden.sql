-- 328 · expediente_hechos: dos lecturas que coinciden valen más que una cita.
--
-- La vista de la 327 da UN valor por proceso y tipo de hecho, el mejor comprobado. Su orden ponía «cita» (la frase que
-- copió UN lector trae el número) antes que «dos_lecturas» (dos lectores independientes, un modelo y una regla, dieron el
-- mismo valor). Es al revés: medido el 2026-11-16, ninguna lectura sola es fiable y juntas detectan los errores de la
-- otra. Orden nuevo: registro, plantilla (un reporte que genera el SEACE), dos lecturas, cita, sin verificar y, al final,
-- lo que contradice al registro. La ficha del contrato y el MCP pasan a leer de aquí: un dato, una fila.

CREATE OR REPLACE VIEW public.expediente_hechos AS
SELECT DISTINCT ON (h.ocid, h.tipo) h.ocid, h.tipo, h.clase, h.version, h.valor_num, h.valor_fecha, h.cita, h.verificado, h.contra,
       h.modelo, h.leido_at, h.sha256, h.pagina,
       (count(*) OVER (PARTITION BY h.ocid, h.tipo))::int AS fuentes,
       bool_or(h.verificado = 'contradice_registro') OVER (PARTITION BY h.ocid, h.tipo) AS con_contradiccion
  FROM public.hecho_documento h
 ORDER BY h.ocid, h.tipo,
          array_position(ARRAY['registro', 'plantilla', 'dos_lecturas', 'cita', 'sin_verificar', 'contradice_registro'], h.verificado),
          array_position(ARRAY['reporte_otorgamiento', 'reporte_presentacion', 'reporte_evaluacion', 'acta_no_formulacion',
                               'bases_secciones', 'contrato', 'bases', 'buena_pro', 'consultas'], h.clase);
