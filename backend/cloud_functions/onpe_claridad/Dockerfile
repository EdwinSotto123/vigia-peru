# onpe_claridad: scraper autocontenido (imagen propia, con Playwright + Xvfb — 403 confirmado
# desde IP de nube por Cloudflare, además necesita Chromium CON VENTANA; pensado para
# `docker run` en el VPS de Lima o la laptop, no para Cloud Scheduler — ver cloudbuild.yaml).
# vendor/ es una copia de backend/scrapers (editar allá; refresca con
# `python backend/cloud_functions/_vendor.py onpe_claridad`).
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
COPY vendor/backend/scrapers/requirements.txt backend/scrapers/requirements.txt
RUN pip install --no-cache-dir -r backend/scrapers/requirements.txt playwright>=1.45
COPY vendor/backend ./backend
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PYTHONUTF8=1
ENTRYPOINT ["xvfb-run", "-a", "python", "-m", "backend.scrapers.onpe_claridad.pipeline"]
