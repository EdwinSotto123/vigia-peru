-- 220 · El rol de los scrapers vuelve a leer los aportes únicos.
--
-- La migración 211 creó la vista onpe_aporte_unico (dueña: postgres) sin GRANT a vigia_jobs. Tres funciones de
-- vigia_jobs la leen con el permiso de quien llama (SECURITY INVOKER): refrescar_cruces, refrescar_personas_senales y
-- refrescar_senales_politicas. Desde el 2026-10-30 la corrida diaria del OECE (oece_ocds, Worker vigia-scrapers)
-- cargaba las convocatorias y caía al refrescar los cruces: «permission denied for view onpe_aporte_unico». Las
-- convocatorias entraban; los cruces y las banderas de los contratos nuevos, no.
--
-- La API ya la leía (vigia_api); dev_jobs hereda de vigia_jobs.

GRANT SELECT ON onpe_aporte_unico TO vigia_jobs;
