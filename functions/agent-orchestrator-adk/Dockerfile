# Dockerfile custom para soportar extracción de RAR.
# Reemplaza el buildpack Python por defecto. Cloud Run detecta el Dockerfile
# y lo usa en lugar de buildpacks cuando se hace `gcloud run deploy --source`.

FROM python:3.12-slim

# Instalar binarios del sistema:
#  · unar (The Unarchiver): extractor libre en debian main que SÍ abre RAR5
#    (a diferencia de unrar-free, limitado a RAR<=3). `rarfile` lo autodetecta.
#  · libarchive-tools (bsdtar): backend RAR de respaldo para `rarfile`.
#  · libreoffice no se instala — DOCX se convierte a PDF con python-docx.
# Limpiamos apt cache para mantener la imagen liviana.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unar libarchive-tools \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cachear dependencias primero
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .

# Cloud Run setea PORT en runtime
ENV PORT=8080
EXPOSE 8080

# Mismo entry que el Procfile original
CMD exec functions-framework --target=orchestrate --port=$PORT --host=0.0.0.0
