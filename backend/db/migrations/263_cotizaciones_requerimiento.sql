-- 263 · El requerimiento (TDR o especificaciones) de cada contratación menor abierta, copiado a R2.
--
-- Es lo que un proveedor lee para decidir si cotiza. La fuente `seace_cotizaciones` lo baja de prod6 por el relay junto
-- con el detalle y lo deja en R2 (vigia-peru-batch, clave seace/cotizaciones/req/<id_prod6>.pdf); la API lo sirve en
-- GET /licitaciones/menores/:id/requerimiento (la API no puede pedirlo en vivo: el WAF de prod6 bloquea su salida).

ALTER TABLE public.seace_cotizacion
  ADD COLUMN IF NOT EXISTS requerimiento_nombre text,
  ADD COLUMN IF NOT EXISTS req_r2 boolean NOT NULL DEFAULT false;
