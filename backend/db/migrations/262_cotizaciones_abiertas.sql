-- 262 · Contrataciones menores ABIERTAS (≤8 UIT, prod6 del SEACE): lo que un proveedor todavía puede cotizar.
--
-- seace_menores (129) guarda los contratos menores ya adjudicados: su llave es el contrato de prod4, que sólo existe
-- cuando hay ganador. Las cotizaciones en curso («Vigente» en prod6) no tienen contrato y nunca entraban. Son el módulo
-- más usado de las plataformas para proveedores (LicitaLAB Perú las ofrece con postulación asistida): unas 2 700
-- abiertas a la vez el 2026-11-07, con ventanas cortas (la de la muestra se abrió a las 23:50 y cerró a las 07:00).
--
-- Las carga cada hora la fuente `seace_cotizaciones` del Worker de scrapers (por el relay de Zúrich, que pasa el WAF de
-- prod6): el listado de las vigentes, el detalle de las nuevas (ítems con CUBSO, cantidad y distrito) y, al final,
-- refrescar_cotizaciones() (la entidad por su nombre y las regiones de los ítems). Las que dejan de estar vigentes
-- quedan «Cerrada» (después pasan a evaluación y, con ganador, a seace_menores por su código CM).
--
-- Del detalle NO se guarda el DNI ni el nombre de quien aprueba cada etapa (prod6 los manda).

CREATE TABLE IF NOT EXISTS public.seace_cotizacion (
  id_prod6           integer PRIMARY KEY,          -- idContrato de prod6
  codigo             text NOT NULL,                -- CM-212658-2026-DRNRT (la misma llave que seace_menores.codigo)
  objeto             text,                         -- Bien | Servicio | Obra | Consultoría de Obra
  descripcion        text,
  entidad            text,
  id_entidad         integer,                      -- id de la entidad en prod6 (detalle)
  entidad_ruc        text,                         -- por el nombre (refrescar_cotizaciones)
  area_usuaria       text,
  tipo_invitacion    text,                         -- INVITACIÓN ABIERTA | cerrada (detalle)
  estado             text NOT NULL,                -- Vigente | Cerrada | En Evaluación | Culminado
  fec_publica        timestamptz,
  fec_ini_cotizacion timestamptz,
  fec_fin_cotizacion timestamptz,
  consultas_hasta    timestamptz,
  items              jsonb,                        -- [{cubso, nombre, descripcion, cantidad, unidad, distrito}]
  cubso8             text[],                       -- los primeros 8 dígitos del CUBSO de cada ítem (segmento a clase)
  distritos          text[],                       -- «LIMA/LIMA/JESUS MARIA»
  departamentos      text[],                       -- ubigeo de 2 dígitos (como `region` en convocatorias)
  primera_vez        timestamptz NOT NULL DEFAULT now(),
  visto_at           timestamptz NOT NULL DEFAULT now(),
  detalle_at         timestamptz
);
CREATE INDEX IF NOT EXISTS seace_cotizacion_abiertas ON public.seace_cotizacion (fec_fin_cotizacion) WHERE estado = 'Vigente';
CREATE INDEX IF NOT EXISTS seace_cotizacion_nuevas ON public.seace_cotizacion (primera_vez DESC);
CREATE INDEX IF NOT EXISTS seace_cotizacion_codigo ON public.seace_cotizacion (codigo);
CREATE INDEX IF NOT EXISTS seace_cotizacion_departamentos ON public.seace_cotizacion USING gin (departamentos);
CREATE INDEX IF NOT EXISTS seace_cotizacion_cubso8 ON public.seace_cotizacion USING gin (cubso8);
CREATE INDEX IF NOT EXISTS seace_cotizacion_entidad ON public.seace_cotizacion (entidad_ruc);
ALTER TABLE public.seace_cotizacion OWNER TO vigia_jobs;
GRANT SELECT ON public.seace_cotizacion TO vigia_api, vigia_api_admin;
COMMENT ON TABLE public.seace_cotizacion IS
  'Contrataciones menores abiertas y recién cerradas de prod6 (migración 262): lo que un proveedor todavía puede cotizar.';

-- La entidad por su nombre (prod6 no trae RUC): el nombre normalizado del catálogo de entidades, y si no, el de los
-- contratos menores ya adjudicados (prod4 sí trae el RUC). Las regiones, del primer tramo del distrito de cada ítem.
-- Devuelve cuántas filas tocó.
CREATE OR REPLACE FUNCTION public.refrescar_cotizaciones() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0; m int;
BEGIN
  WITH nombres AS (
    SELECT DISTINCT ON (k) k, ruc FROM (
      SELECT mef_norm(e.nombre) AS k, e.ruc::text AS ruc, 1 AS pref FROM entidades e WHERE e.ruc IS NOT NULL
      UNION ALL
      SELECT mef_norm(s.entidad), s.entidad_ruc, 2 FROM seace_menores s WHERE s.entidad_ruc ~ '^\d{11}$'
    ) x WHERE k <> '' ORDER BY k, pref
  )
  UPDATE seace_cotizacion c SET entidad_ruc = nm.ruc
    FROM nombres nm
   WHERE c.entidad_ruc IS NULL AND nm.k = mef_norm(c.entidad);
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

  UPDATE seace_cotizacion c
     SET departamentos = ARRAY(
           SELECT DISTINCT z.ubigeo
             FROM unnest(c.distritos) d
             JOIN zonas z ON z.nivel = 'departamento'
                         AND mef_norm(z.nombre) = mef_norm(regexp_replace(split_part(d, '/', 1), '^PROV\.? CONST\.? DEL ', '')))
   WHERE c.distritos IS NOT NULL AND c.departamentos IS NULL;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

  -- Las vigentes cuyo plazo ya venció (por si el listado no corrió a tiempo).
  UPDATE seace_cotizacion SET estado = 'Cerrada' WHERE estado = 'Vigente' AND fec_fin_cotizacion < now();
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  RETURN n;
END $$;
ALTER FUNCTION public.refrescar_cotizaciones() OWNER TO vigia_jobs;
