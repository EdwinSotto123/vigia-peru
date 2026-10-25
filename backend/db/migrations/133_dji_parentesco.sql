-- Grados de parentesco declarados en la DJI (Ley 31227), agregados por declaración.
--
-- El dato abierto de "Familiares declarados" (Reporte2, 15.9M filas) trae SOLO el parentesco por cada
-- CODIGO_DDJJ — NO el nombre ni el DNI del pariente (lo borra la Contraloría por protección de datos). Así que
-- a nivel masivo NO se puede cruzar un pariente concreto con un proveedor. Lo que SÍ aporta: saber qué grados
-- declaró cada funcionario, para REFORZAR la señal `apellidos_funcionario`/`apellidos_autoridad` (que hoy exige
-- los dos apellidos = patrón de hermanos): si el declarante NO declaró ningún hermano, un proveedor con sus dos
-- apellidos difícilmente es su hermano → se degrada; si SÍ declaró hermano(s), el indicio es más consistente.
-- Sigue siendo "para revisar", nunca "grave" (sin DNI no hay prueba de identidad). Ver vigia-seace / auditoría DJI.
--
-- Se agrega por CODIGO_DDJJ (1 fila por declaración, ~1.8M) desde las ~15.9M del CSV. Foto completa: el cargador
-- hace TRUNCATE + COPY. Solo cuenta grados que comparten apellido con el declarante de forma predecible
-- (hermano = ambos apellidos; hijo/padre/madre = un apellido en posición fija); el resto va a n_otros.

CREATE TABLE IF NOT EXISTS dji_parentesco (
  codigo_ddjj bigint PRIMARY KEY,
  n_hermanos  int NOT NULL DEFAULT 0,   -- HERMANO(A) DEL DECLARANTE (comparte ap1 y ap2)
  n_hijos     int NOT NULL DEFAULT 0,   -- HIJO(A) (comparte ap1 si el declarante es el padre)
  n_padres    int NOT NULL DEFAULT 0,   -- PADRE/MADRE DEL DECLARANTE
  n_conyuge   int NOT NULL DEFAULT 0,   -- CONYUGE / CONVIVIENTE (no comparte apellido)
  n_otros     int NOT NULL DEFAULT 0,   -- cuñados, primos, tíos, sobrinos, abuelos, afines, etc.
  n_total     int NOT NULL DEFAULT 0
);

COMMENT ON TABLE dji_parentesco IS
  'Grados de parentesco declarados por cada DJI (Ley 31227), agregados por codigo_ddjj. El dato abierto no trae identidad del pariente; refuerza la señal de apellidos. Migración 133.';

GRANT SELECT ON dji_parentesco TO vigia_api, vigia_api_admin, vigia_agentes, vigia_ab;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON dji_parentesco TO vigia_jobs;
