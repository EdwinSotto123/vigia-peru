#!/usr/bin/env bash
# Vigila la importación de los corpus de RAG Engine (cuota 5 RPM → horas): cada 15 min relanza lo que
# falte (idempotente; FAILED_PRECONDITION si el corpus tiene una operación viva) y, cuando los 4 corpus
# están completos, corre la evaluación y deja el resultado en backend/rag/.cache/eval-final.txt.
set -u
cd "$(dirname "$0")/../.."
PY=$(ls backend/rag/.venv/Scripts/python.exe 2>/dev/null || echo python)
LOG=backend/rag/.cache/watch-import.log
mkdir -p backend/rag/.cache
for i in $(seq 1 60); do
  echo "== $(date -Is) intento $i" >> "$LOG"
  if ! $PY -m backend.rag.corpus estado > backend/rag/.cache/estado.txt 2>&1; then echo "estado falló" >> "$LOG"; sleep 900; continue; fi
  grep -E "^  [a-z-]+: [0-9]+ archivos" backend/rag/.cache/estado.txt >> "$LOG"
  faltan=$(grep -E "^  [a-z-]+: [0-9]+ archivos en RAG Engine / [0-9]+ en cat" backend/rag/.cache/estado.txt \
           | awk '{ if ($2+0 < $7+0) n++ } END { print n+0 }')
  if [ "$faltan" = "0" ]; then
    echo "== completo; evaluando" >> "$LOG"
    $PY -m backend.rag.evaluar > backend/rag/.cache/eval-final.txt 2>&1
    echo "== eval exit $?" >> "$LOG"
    exit 0
  fi
  $PY -m backend.rag.corpus importar --rpm 5 --no-esperar >> "$LOG" 2>&1
  sleep 900
done
