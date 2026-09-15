# Cloud Run Job `vigia-ingest`: lee los manifiestos de gs://vigia-peru-batch y hace el upsert en Cloud SQL.
#
# El contexto de build NO es esta carpeta sino un directorio armado por
# infrastructure/deploy/ingest-job.sh con SOLO los paquetes que importa ingestar.py:
#   backend/batch, backend/scrapers/_core, backend/scrapers/oece_ocds, backend/core (si existe)
# (así no se sube dataset/ ni node_modules y `-m backend.batch.ingestar` resuelve los imports relativos).
FROM python:3.12-slim
WORKDIR /app
COPY backend/batch/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "-m", "backend.batch.ingestar"]
