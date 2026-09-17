# jne_infogob: scraper autocontenido — todo lo que necesita vive en ESTA carpeta.
# vendor/ es una copia de backend/scrapers (la fuente real del código; editar allá, nunca
# aquí) que refresca `python backend/cloud_functions/_vendor.py jne_infogob` — el cloudbuild.yaml
# de al lado ya lo hace como primer paso, así que nunca se construye con código viejo.
FROM python:3.12-slim
WORKDIR /app
COPY vendor/backend/scrapers/requirements.txt backend/scrapers/requirements.txt
RUN pip install --no-cache-dir -r backend/scrapers/requirements.txt
COPY vendor/backend ./backend
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PYTHONUTF8=1
ENTRYPOINT ["python", "-m", "backend.scrapers.jne_infogob.pipeline"]
