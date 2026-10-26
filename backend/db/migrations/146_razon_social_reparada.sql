-- 146 · Razón social reparada: 2,002 empresas se llamaban «Servicio», «Bien» u «Obra».
--
-- Una carga del 2026-10-23 (1,763 filas, todas a las 10:15:39 UTC) y otra del 2026-05-17 (239) escribieron en
-- empresas.razon_social el TIPO del objeto (Servicio, Bien, Obra) en vez del nombre. Se vio en la ficha de un contrato
-- de MAPFRE: «…declara el mismo domicilio fiscal que Servicio». Afecta todo lo que muestra el nombre de una empresa.
--
-- 1) Guardia: un trigger ignora esa escritura venga de donde venga (en un UPDATE deja el nombre que había; en un INSERT
--    pone «RUC <número>»: la columna no admite NULL y un nombre falso es peor que ninguno).
-- 2) Reparación: el nombre de la SUNAT (seace_proveedor_sunat) o, si no hay, el más repetido en CONOSCE (adjudicaciones
--    y postores). Las que no tienen fuente quedan como «RUC <número>».
-- 3) empresa_resumen.nombre, que lo copió, igual.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/146_razon_social_reparada.sql
-- y después: SELECT refrescar_cruce_domicilio_compartido();   (guarda los nombres en su detalle)

CREATE OR REPLACE FUNCTION empresas_sin_nombre_generico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.razon_social IS NOT NULL AND btrim(NEW.razon_social) ~* '^(servicios?|bienes|bien|obras?|consultor[ií]as?)$' THEN
    NEW.razon_social := CASE WHEN TG_OP = 'UPDATE' THEN OLD.razon_social ELSE 'RUC ' || NEW.ruc END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS empresas_sin_nombre_generico ON empresas;
CREATE TRIGGER empresas_sin_nombre_generico
  BEFORE INSERT OR UPDATE OF razon_social ON empresas
  FOR EACH ROW EXECUTE FUNCTION empresas_sin_nombre_generico();

WITH malas AS (
  SELECT ruc FROM empresas WHERE btrim(razon_social) ~* '^(servicios?|bienes|bien|obras?|consultor[ií]as?)$'
), nombre AS (
  SELECT m.ruc,
         COALESCE(
           (SELECT s.razon_social FROM seace_proveedor_sunat s WHERE s.ruc = m.ruc AND length(s.razon_social) > 6 LIMIT 1),
           (SELECT a.proveedor FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = m.ruc AND length(a.proveedor) > 6
             GROUP BY a.proveedor ORDER BY count(*) DESC, a.proveedor LIMIT 1),
           (SELECT p.postor FROM conosce_postores p WHERE p.ruc_postor = m.ruc AND length(p.postor) > 6
             GROUP BY p.postor ORDER BY count(*) DESC, p.postor LIMIT 1),
           'RUC ' || m.ruc) AS nombre
    FROM malas m
)
UPDATE empresas e SET razon_social = n.nombre FROM nombre n WHERE e.ruc = n.ruc;

UPDATE empresa_resumen r SET nombre = e.razon_social
  FROM empresas e
 WHERE e.ruc = r.ruc AND btrim(r.nombre) ~* '^(servicios?|bienes|bien|obras?|consultor[ií]as?)$';
