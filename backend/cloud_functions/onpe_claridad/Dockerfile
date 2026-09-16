# ONPE Claridad (aportantes/candidatos). 403 confirmado desde IP de nube (Cloudflare) + necesita
# Chromium CON ventana (`self.headed`, ver backend/scrapers/onpe_claridad/pipeline.py) — no usa la
# imagen base de scrapers-base (headless) ni se agenda con Cloud Scheduler (ver README.md).
# Pensada para `docker run` en el VPS de Lima o la laptop: Xvfb da la "ventana" virtual que
# Cloudflare necesita ver sin depender de una sesión gráfica real.
#
# Build context: la raíz del repo.
#   docker build -f backend/cloud_functions/onpe_claridad/Dockerfile -t onpe-claridad:local .
#   docker run --rm -e PGHOST=... -e PGPASSWORD=... onpe-claridad:local --ifa
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY backend/scrapers/requirements.txt backend/scrapers/requirements.txt
RUN pip install --no-cache-dir -r backend/scrapers/requirements.txt playwright>=1.45 google-cloud-storage>=2.10

COPY backend/scrapers backend/scrapers
COPY backend/scripts backend/scripts
RUN find backend -type d \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} + \
    && rm -rf backend/scrapers/tests

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PYTHONUTF8=1
ENTRYPOINT ["xvfb-run", "-a", "python", "-m", "backend.scrapers.onpe_claridad.pipeline"]
