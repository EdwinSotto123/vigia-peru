# OCR abierto para Vigía (Docling: RapidOCR + estructura de tablas), servido en un Cloudflare Container (vigia-ocr).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/modelos/hf \
    OMP_NUM_THREADS=4

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# torch sólo CPU (los contenedores no tienen GPU): la imagen pesa la tercera parte que con CUDA.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY app.py calentar.py /app/
# Los modelos quedan dentro de la imagen.
RUN python calentar.py

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
