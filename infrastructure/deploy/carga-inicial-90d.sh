#!/usr/bin/env bash
# Carga inicial de los últimos 90 días al bucket (desde IP peruana). Dos fases:
#   1) releases + records (con refresco de los ya vistos) → subir → vigia-ingest   (~30-40 min)
#   2) documentos de TODO ese lote por tramos de 20 GB, subiendo y borrando local en cada tramo (~1-2 días)
#   bash infrastructure/deploy/carga-inicial-90d.sh   (log: dataset/_batch/logs/carga-90d.log)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PYTHONPATH=.
DIAS="${DIAS:-90}" SIN_DOCUMENTOS=1 SIN_PEDIDOS=1 MAX_RECORDS=30000 REFRESCAR_RECORDS=1 bash infrastructure/deploy/batch-nocturno.sh
L_REC="$(python -c "from backend.batch.estado import Estado; e=Estado(); ls=[l for l in e.lotes('records')]; print(ls[-1]['id'] if ls else '')")"
[[ -n "$L_REC" ]] || { echo "✗ sin lote de records"; exit 1; }
TRAMO_GB="${TRAMO_GB:-20}" bash infrastructure/deploy/batch-documentos-loop.sh "$L_REC" todo
