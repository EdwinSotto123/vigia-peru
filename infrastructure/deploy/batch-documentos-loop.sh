#!/usr/bin/env bash
# Baja TODOS los documentos de un lote de records por tramos y los va subiendo a GCS a medida que
# avanza (el disco local nunca acumula más de TRAMO_GB): descargar (tope GB) → subir --limpiar →
# vigia-ingest → repetir hasta que el lote no tenga pendientes. Sirve para la carga inicial de los
# 90 días y para el histórico por años. Reanudable: si se corta, se vuelve a lanzar con el mismo lote.
#
#   bash infrastructure/deploy/batch-documentos-loop.sh <records-lote-id> [politica=todo] [TRAMO_GB=20]
#   TRAMO_GB=10 bash infrastructure/deploy/batch-documentos-loop.sh records-20260915-071500
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

LOTE_REC="${1:?lote de records}"
POLITICA="${2:-todo}"
TRAMO_GB="${TRAMO_GB:-20}"
PY="${PYTHON:-python}"
REGION="${REGION:-us-central1}"
BUCKET_BATCH="${BUCKET_BATCH:-vigia-peru-batch}"
MAX_TRAMOS="${MAX_TRAMOS:-200}"

echo "── $(date -Is) · documentos por tramos · records $LOTE_REC · política $POLITICA · $TRAMO_GB GB por tramo"
LOTE_DOC=""
for ((i = 1; i <= MAX_TRAMOS; i++)); do
  if [[ -z "$LOTE_DOC" ]]; then
    LOTE_DOC="$("$PY" -m backend.batch.descargar documentos --lote "$LOTE_REC" --politica "$POLITICA" --max-gb-por-noche "$TRAMO_GB" | tail -n1)"
    [[ "$LOTE_DOC" == documentos-* ]] || { echo "── nada que bajar (o error): '$LOTE_DOC'"; exit 0; }
  else
    "$PY" -m backend.batch.descargar documentos --lote "$LOTE_DOC" --max-gb-por-noche "$TRAMO_GB" --reponer >/dev/null
  fi
  "$PY" -m backend.batch.subir --lote "$LOTE_DOC" --bucket "$BUCKET_BATCH" --paralelo 8 --limpiar || echo "⚠ subir con fallos"
  gcloud run jobs execute vigia-ingest --region "$REGION" --args=--lote,"$LOTE_DOC" --wait >/dev/null 2>&1 || echo "⚠ vigia-ingest con error"
  PEND="$("$PY" -c "from backend.batch.estado import Estado; e=Estado(); r=e.resumen('$LOTE_DOC'); print(r['pending']+r['processing']+r['failed']-r['agotados'])")"
  echo "── $(date -Is) · tramo $i listo · pendientes en $LOTE_DOC: $PEND"
  [[ "$PEND" -gt 0 ]] || break
done
echo "── $(date -Is) · documentos completos · lote $LOTE_DOC"
