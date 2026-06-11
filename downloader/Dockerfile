FROM python:3.12-slim

WORKDIR /app

# Deps primero (mejor cache de capas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8080

# 1 worker + threadpool de FastAPI alcanza para descargas concurrentes I/O-bound.
# Sube --workers si quieres más paralelismo de CPU (no es el cuello aquí).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "75"]
