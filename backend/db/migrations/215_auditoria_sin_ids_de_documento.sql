-- 215: la auditoría de lecturas de la 213 tomó también dos tablas sin documentos de personas, por columnas que son ids
-- de documentos: documentos.ocds_doc_id (el documento en OCDS) y seace_menores.id_documento_contrato. Son de las más
-- leídas por la API y llenaban el log (más de un tercio del volumen medido en PROD) sin cuidar a nadie. La 213 ya no
-- toma columnas con «id» al volver a correr su bloque 2. Idempotente.

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['public.documentos', 'public.seace_menores'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %s FROM rds_pgaudit', t);
    END IF;
  END LOOP;
END $$;
