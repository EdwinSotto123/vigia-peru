# oece_ocds: scraper autocontenido — todo lo que necesita vive en ESTA carpeta.
# vendor/ es una copia de backend/scrapers (la fuente real del código; editar allá, nunca
# aquí) que refresca `python backend/cloud_functions/_vendor.py oece_ocds` — el cloudbuild.yaml
# de al lado ya lo hace como primer paso, así que nunca se construye con código viejo.
# 403 confirmado desde IP de nube (WAF del OECE): esta imagen NO se agenda con Cloud
# Scheduler (ver cloudbuild.yaml) — sirve para `docker run` en el VPS de Lima o la laptop.
FROM python:3.12-slim
WORKDIR /app
COPY vendor/backend/scrapers/requirements.txt backend/scrapers/requirements.txt
RUN pip install --no-cache-dir -r backend/scrapers/requirements.txt
COPY vendor/backend ./backend
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PYTHONUTF8=1
ENTRYPOINT ["python", "-m", "backend.scrapers.oece_ocds.pipeline"]
