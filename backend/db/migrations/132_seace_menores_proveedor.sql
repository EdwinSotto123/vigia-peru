-- 132 · Identidad SUNAT de los proveedores que ganan contratos menores ≤8 UIT (seace_menores). Muchos (sobre todo
-- personas naturales con negocio) NO están en empresa_resumen porque solo contratan por el módulo de menores; esta tabla
-- les da identidad (razón social, estado/condición SUNAT, actividad CIIU, antigüedad) para mostrarla en el panel del
-- menor y para las banderas: proveedor NO ACTIVO (baja/suspensión), NO HABIDO, y «ganó recién creada».
-- La llena backend/scripts/cargar_menores_proveedor.py desde el CSV de SUNAT (API Perú); la razón social de RUC-10
-- (persona natural) se redacta al mostrarla, como en el resto de Vigía.
CREATE TABLE IF NOT EXISTS seace_proveedor_sunat (
  ruc                       TEXT PRIMARY KEY,
  razon_social              TEXT,
  tipo_persona              TEXT,   -- juridica (RUC 20) | natural (RUC 10) | otro
  tipo_contribuyente        TEXT,   -- PERSONA NATURAL CON NEGOCIO, SOCIEDAD ANONIMA CERRADA, …
  estado                    TEXT,   -- ACTIVO | BAJA DEFINITIVA | SUSPENSION TEMPORAL | BAJA DE OFICIO
  condicion                 TEXT,   -- HABIDO | NO HABIDO | NO HALLADO
  fecha_inscripcion         DATE,
  fecha_inicio_actividades  DATE,
  departamento              TEXT,
  provincia                 TEXT,
  distrito                  TEXT,
  direccion                 TEXT,
  actividad_ciiu            TEXT,   -- actividad económica principal (giro)
  nombre_comercial          TEXT,
  nro_trabajadores          INTEGER,
  capturado                 TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE seace_proveedor_sunat IS 'Identidad SUNAT de proveedores de contratos menores (migración 132). RUC-10 = persona natural: redactar la razón social al mostrar.';
