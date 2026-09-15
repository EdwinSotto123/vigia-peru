#!/usr/bin/env bash
# Aplica los .sql en orden contra la BD `vigia` en Cloud SQL.
# Requiere variables:
#   PGHOST       = IP pública de la instancia Cloud SQL
#   PGUSER       = postgres (por defecto)
#   PGPASSWORD   = la que generaste al crear la instancia
#   PGDATABASE   = vigia
# Uso:
#   PGHOST=34.x.x.x PGPASSWORD='xxx' bash 99_apply_all.sh

set -e
cd "$(dirname "$0")/migrations"

PSQL_FLAGS="-h ${PGHOST:-127.0.0.1} -U ${PGUSER:-postgres} -d ${PGDATABASE:-vigia} --set ON_ERROR_STOP=on"

for f in 01_extensions.sql 02_core.sql 03_contrataciones.sql 04_alertas_red.sql 05_mef_cache.sql 06_documentos_opiniones.sql 07_alertas_extras.sql 08_penalidades.sql 09_financiamiento.sql 10_admin_config.sql 11_convocatorias_ubigeo.sql 12_procesamientos.sql 13_clasificacion.sql 14_lotes.sql 15_retencion_pedidos.sql 16_cobertura.sql 17_documentos_texto.sql 18_verificacion.sql 19_procesamiento_activo.sql; do
  if [ ! -f "$f" ]; then echo "⚠ $f no existe, salteo"; continue; fi
  echo "→ aplicando $f"
  psql ${PSQL_FLAGS} -f "$f"
done

echo "✓ schema aplicado"
