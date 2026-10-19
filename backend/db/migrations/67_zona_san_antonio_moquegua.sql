-- 67 · El distrito de San Antonio (Mariscal Nieto, Moquegua), que faltaba en `zonas`.
--
-- Es un distrito nuevo (no estaba en el ubigeo con que se cargó `zonas`): el MEF ya lo trae como ejecutora 180107
-- ("MUNICIPALIDAD DISTRITAL DE SAN ANTONIO") y el JNE eligió a su alcalde en 2022. Sin la zona,
-- backend/scripts/cargar_gobiernos.py no podía ubicarlo y su gobierno 2023-2026 quedaba fuera de su partido.
-- Coordenadas: su capital, el centro poblado San Antonio, junto a la ciudad de Moquegua.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/67_zona_san_antonio_moquegua.sql
-- y después: python backend/scripts/cargar_gobiernos.py; SELECT refrescar_contrato_partido(); SELECT * FROM refrescar_partido_proceso();

INSERT INTO zonas (ubigeo, nivel, nombre, padre_ubigeo, lat, lon)
VALUES ('180107', 'distrito', 'San Antonio', '1801', -17.17600, -70.93300)
ON CONFLICT (ubigeo) DO NOTHING;
