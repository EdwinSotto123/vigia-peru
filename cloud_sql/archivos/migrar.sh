#!/usr/bin/env bash
# Mueve la base `vigia` entre Cloud SQL (GCP) y RDS (AWS), en cualquier dirección.
#
#   bash cloud_sql/archivos/migrar.sh gcp-a-aws    # volcado de Cloud SQL → restauración en RDS
#   bash cloud_sql/archivos/migrar.sh aws-a-gcp    # al revés (si GCP aprueba créditos)
#   bash cloud_sql/archivos/migrar.sh verificar    # compara filas por tabla entre ambas
#
# Requiere: docker (usa postgres:16 para pg_dump/pg_restore), gcloud, aws (perfil founder.edwin), python+psycopg2.
# El volcado queda en cloud_sql/archivos/datos/ (gitignored: tiene datos personales). Las contraseñas se
# leen de Secret Manager / SSM y no se imprimen. La base destino se VACÍA antes de restaurar.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PROYECTO="${GCP_PROJECT:-project-a974c6e5-0cdf-4b11-a86}"
AWS_PROFILE="${AWS_PROFILE:-founder.edwin}"; AWS_REGION="${AWS_REGION:-us-east-2}"
GCP_HOST="${GCP_HOST:-34.63.237.180}"
AWS_HOST="${AWS_HOST:-$(aws rds describe-db-instances --profile "$AWS_PROFILE" --region "$AWS_REGION" --db-instance-identifier vigia-db --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null || true)}"
DATOS="$(pwd -W 2>/dev/null || pwd)/cloud_sql/archivos/datos"
mkdir -p cloud_sql/archivos/datos
IMG="postgres:16"

pw_gcp() { gcloud secrets versions access latest --secret=cloudsql-password --project="$PROYECTO"; }
exportar_pw_roles() {  # contraseñas de los roles de la migración 37, para crear_roles.py
  local n
  for n in api api-admin dispatcher jobs mcp; do
    export "PW_cloudsql_password_${n//-/_}=$(gcloud secrets versions access latest --secret=cloudsql-password-$n --project="$PROYECTO")"
  done
}
pw_aws() { MSYS_NO_PATHCONV=1 aws ssm get-parameter --profile "$AWS_PROFILE" --region "$AWS_REGION" --name /vigia/vigia-db/password --with-decryption --query Parameter.Value --output text; }

pg() {  # pg <host> <password> <cmd...> : herramienta de postgres en docker contra ese host
  local host="$1" pass="$2"; shift 2
  MSYS_NO_PATHCONV=1 PGPASSWORD="$pass" docker run --rm -e PGPASSWORD -e PGSSLMODE=require -v "$DATOS:/datos" "$IMG" "$@" -h "$host" -U postgres
}

volcar() {  # volcar <host> <password>
  echo "▶ volcado de $1 …"
  pg "$1" "$2" pg_dump -d vigia -Fc --no-owner -f /datos/vigia.dump 2>&1 | tail -3
  ls -la cloud_sql/archivos/datos/vigia.dump
}

restaurar() {  # restaurar <host> <password>
  local host="$1" pass="$2"
  echo "▶ extensiones y roles en $host …"
  for e in postgis vector pg_trgm unaccent pg_stat_statements; do
    pg "$host" "$pass" psql -d vigia -qc "CREATE EXTENSION IF NOT EXISTS $e" 2>&1 | grep -v NOTICE || true
  done
  echo "▶ restauración en $host (limpia lo existente) …"
  # Sin --exit-on-error: algunos objetos de extensiones (postgis) avisan al limpiar; se cuentan y se muestran.
  pg "$host" "$pass" pg_restore -d vigia --no-owner --clean --if-exists -j 2 /datos/vigia.dump >cloud_sql/archivos/datos/restore.log 2>&1 || true
  echo "errores de pg_restore: $(grep -c 'pg_restore: error' cloud_sql/archivos/datos/restore.log || true) (detalle: cloud_sql/archivos/datos/restore.log)"
  grep 'pg_restore: error' -A1 cloud_sql/archivos/datos/restore.log | head -12 || true
  pg "$host" "$pass" psql -d vigia -qc "ANALYZE" >/dev/null
}

case "${1:-}" in
  gcp-a-aws)
    A="$(pw_aws)"; G="$(pw_gcp)"; exportar_pw_roles
    ORIGEN_HOST="$GCP_HOST" ORIGEN_PASSWORD="$G" PGHOST="$AWS_HOST" PGPASSWORD="$A" python cloud_sql/archivos/crear_roles.py
    volcar "$GCP_HOST" "$G"
    restaurar "$AWS_HOST" "$A"
    ;;
  aws-a-gcp)
    A="$(pw_aws)"; G="$(pw_gcp)"; exportar_pw_roles
    ORIGEN_HOST="$AWS_HOST" ORIGEN_PASSWORD="$A" PGHOST="$GCP_HOST" PGPASSWORD="$G" python cloud_sql/archivos/crear_roles.py
    volcar "$AWS_HOST" "$A"
    restaurar "$GCP_HOST" "$G"
    ;;
  restaurar-aws)   # reutiliza el último volcado de datos/ (para repetir una restauración sin volver a volcar)
    A="$(pw_aws)"; G="$(pw_gcp)"; exportar_pw_roles
    ORIGEN_HOST="$GCP_HOST" ORIGEN_PASSWORD="$G" PGHOST="$AWS_HOST" PGPASSWORD="$A" python cloud_sql/archivos/crear_roles.py
    restaurar "$AWS_HOST" "$A"
    ;;
  verificar)
    python cloud_sql/archivos/verificar.py "$GCP_HOST" "$(pw_gcp)" "$AWS_HOST" "$(pw_aws)"
    ;;
  *) sed -n 2,9p "$0"; exit 2;;
esac
