# Imagen base compartida por los Cloud Run Jobs de backend/cloud_functions/<fuente>/ que NO
# necesitan navegador (todos menos onpe_claridad, que tiene la suya con Playwright + Xvfb).
# Contiene el código de backend/scrapers y backend/scripts (los loaders que invoca
# `run_loader()`/`_core/pipeline.py`) más sus dependencias — nada de dataset/ ni node_modules.
#
# Build context: la raíz del repo (lo arma infrastructure/deploy/cloud-scrapers.sh).
# Las imágenes de cada fuente son un `FROM` de una línea sobre esta (ver p. ej.
# backend/cloud_functions/pnda_sancionados/Dockerfile).
FROM python:3.12-slim
WORKDIR /app

COPY backend/scrapers/requirements.txt backend/scrapers/requirements.txt
RUN pip install --no-cache-dir -r backend/scrapers/requirements.txt

COPY backend/scrapers backend/scrapers
COPY backend/scripts backend/scripts
RUN find backend -type d \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} + \
    && rm -rf backend/scrapers/tests

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PYTHONUTF8=1
