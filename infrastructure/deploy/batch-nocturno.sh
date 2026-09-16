#!/usr/bin/env bash
# Flujo nocturno del SEACE desde IP peruana (laptop o VPS de Lima). NO corre en GCP.
#   pedidos (financiados sin docs) → releases (últimos N días) → records nuevos → documentos clave → subir a GCS → job vigia-ingest
#
#   bash infrastructure/deploy/batch-nocturno.sh                 # ventana: últimos 7 días
#   DIAS=30 bash infrastructure/deploy/batch-nocturno.sh          # ventana más larga
#   DESDE=2016-01-01 HASTA=2016-12-31 bash infrastructure/deploy/batch-nocturno.sh   # histórico por tramos
#   SIN_DOCUMENTOS=1 … · MAX_RECORDS=5000 … · MAX_GB=5 … · SIN_INGESTA=1 … (solo descarga+sube) · SIN_PEDIDOS=1 · MAX_PEDIDOS=200 · REFRESCAR_RECORDS=1 (re-bajar records ya vistos)
#   DATASETS=pnda_visitas,jne_infogob … (forzar una fuente externa fuera de agenda; las 4 automáticas
#   ya corren solas por Cloud Scheduler, ver paso 6) · ONPE=1 … (correr ONPE Claridad: abre Chromium con ventana)
#
# Programación:
#   VPS Lima (crontab):  30 1 * * *  /opt/vigia/infrastructure/deploy/batch-nocturno.sh >> /var/log/vigia-batch.log 2>&1
#   Windows (Task Scheduler, diario 01:30):
#     "C:\Program Files\Git\bin\bash.exe" -lc "/c/Users/usuario/Desktop/PROYECTOS/vigia-peru/infrastructure/deploy/batch-nocturno.sh"
# Requisitos: python 3.12+ con `pip install -r backend/batch/requirements.txt`, ADC de GCP
# (`gcloud auth application-default login`) y `gcloud` autenticado para ejecutar el job.
# Todo es reanudable: si una noche se corta, la siguiente retoma (ítems `completed` se saltan;
# `descargar <tipo> --lote <id>` reanuda un lote a medias).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PY="${PYTHON:-python}"
REGION="${REGION:-us-central1}"
BUCKET_BATCH="${BUCKET_BATCH:-vigia-peru-batch}"
DIAS="${DIAS:-7}"
HASTA="${HASTA:-$(date +%F)}"
DESDE="${DESDE:-$(date -d "$HASTA - $DIAS days" +%F 2>/dev/null || python -c "import datetime as d;print((d.date.fromisoformat('$HASTA')-d.timedelta(days=$DIAS)).isoformat())")}"
MAX_RECORDS="${MAX_RECORDS:-20000}"
MAX_GB="${MAX_GB:-10}"
POLITICA="${POLITICA:-clave}"
LOTES=()

echo "── $(date -Is) · batch nocturno · $DESDE → $HASTA · bucket gs://$BUCKET_BATCH"

# 0. pedidos de descarga: contratos financiados cuyos documentos no están (o expiraron) en GCS.
#    Van primero: son los que alguien ya pagó. record + TODOS los docs; la ingesta los re-encola.
if [[ -z "${SIN_PEDIDOS:-}" ]]; then
  mapfile -t L_PED < <("$PY" -m backend.batch.descargar pedidos --max "${MAX_PEDIDOS:-200}" --max-gb-por-noche "${MAX_GB_PEDIDOS:-20}" | tail -n2 | grep -E '^(records|documentos)-')
  for l in "${L_PED[@]}"; do [[ -n "$l" ]] && LOTES+=("$l"); done
fi

# 1. releases (los logs van a stderr; stdout = id del lote)
L_REL="$("$PY" -m backend.batch.descargar releases --desde "$DESDE" --hasta "$HASTA" --ventana 7d | tail -n1)"
[[ -n "$L_REL" ]] || { echo "✗ releases no devolvió lote"; exit 1; }
LOTES+=("$L_REL")

# 2. records nuevos (los ya bajados en noches anteriores se saltan)
L_REC="$("$PY" -m backend.batch.descargar records --lote "$L_REL" --max-por-noche "$MAX_RECORDS" --paralelo 4 ${REFRESCAR_RECORDS:+--incluir-existentes} | tail -n1)"
[[ -n "$L_REC" ]] && LOTES+=("$L_REC")

# 3. documentos clave (bases, buena pro, contrato) con tope de GB; se corta solo si el SEACE bloquea (403 seguidos)
if [[ -z "${SIN_DOCUMENTOS:-}" && -n "$L_REC" ]]; then
  L_DOC="$("$PY" -m backend.batch.descargar documentos --lote "$L_REC" --politica "$POLITICA" --max-gb-por-noche "$MAX_GB" | tail -n1)"
  [[ -n "$L_DOC" ]] && LOTES+=("$L_DOC")
fi

# 4. subir (reanudable; escribe el manifiesto de cada lote). El bucket es el almacén: --limpiar borra
#    cada archivo local ya verificado en GCS (CONSERVAR_LOCAL=1 para dejarlos en dataset/_batch/).
ARGS=()
for l in "${LOTES[@]}"; do ARGS+=(--lote "$l"); done
if [[ ${#LOTES[@]} -gt 0 ]]; then
  "$PY" -m backend.batch.subir "${ARGS[@]}" --bucket "$BUCKET_BATCH" --paralelo 8 $( [[ -z "${CONSERVAR_LOCAL:-}" ]] && echo --limpiar ) || echo "⚠ subir terminó con fallos; el job igual ingiere lo que sí subió"

  # 5. ingesta en GCP (Cloud Run Job; --wait espera y devuelve el exit code del job)
  if [[ -z "${SIN_INGESTA:-}" ]]; then
    # gcloud no admite repetir --lote dentro de --args: ingestar acepta varios ids tras un solo --lote
    JOB_ARGS="--lote,$(IFS=,; echo "${LOTES[*]}")"
    gcloud run jobs execute vigia-ingest --region "$REGION" --args="$JOB_ARGS" --wait \
      || echo "⚠ vigia-ingest terminó con error; revisar: gcloud run jobs executions list --job vigia-ingest --region $REGION"
  fi
else
  echo "── nada que subir del SEACE"
fi

# 6. fuentes externas (Frente D). Desde el 2026-09-16, pnda_sancionados/pnda_visitas/pnda_dji/
#    jne_infogob YA NO corren aquí por defecto: tienen su propio Cloud Run Job + Cloud Scheduler
#    en GCP (host abierto, sin WAF — verificado con Cloud Build; ver backend/cloud_functions/README.md).
#    Repetirlos aquí sería redundante (datasets_cargas lo haría inofensivo igual, por sha256, pero
#    es trabajo de más) — quedan disponibles a mano con DATASETS=<fuentes> si hace falta forzar
#    una recarga fuera de agenda. Lo que SÍ sigue aquí es lo que el WAF/Cloudflare bloquea desde
#    IP de nube: ONPE Claridad (necesita navegador con ventana, ONPE=1, día 10 sugerido).
if [[ -n "${DATASETS:-}" || -n "${ONPE:-}" ]]; then
  export PGHOST="${PGHOST:-34.71.244.66}" PGSSLMODE="${PGSSLMODE:-require}" SCRAPER_GCS_BUCKET="${SCRAPER_GCS_BUCKET:-$BUCKET_BATCH}"
  if [[ -n "${DATASETS:-}" ]]; then
    IFS=, read -r -a HOY <<< "$DATASETS"
    echo "── $(date -Is) · datasets externos (forzado): ${HOY[*]}"
    "$PY" -m backend.scrapers.run_all --only "$(IFS=,; echo "${HOY[*]}")" || echo "⚠ algún dataset externo falló (ver arriba); el lote SEACE no se ve afectado"
  fi
  if [[ -n "${ONPE:-}" ]]; then
    echo "── $(date -Is) · onpe_claridad (navegador con ventana)"
    "$PY" -m backend.scrapers.onpe_claridad.pipeline --ifa || echo "⚠ onpe_claridad falló (¿Cloudflare? probar --channel chrome)"
    "$PY" -m backend.scrapers.onpe_claridad.pipeline --candidatos || echo "⚠ onpe_claridad --candidatos falló"
    "$PY" -m backend.scrapers.jne_infogob.pipeline || true   # vuelve a cruzar DNI con onpe_candidatos
  fi
fi

echo "── $(date -Is) · listo · lotes: ${LOTES[*]}"
