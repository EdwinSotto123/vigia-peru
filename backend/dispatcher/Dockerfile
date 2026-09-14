FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Build context = backend/dispatcher; se reproduce el paquete para que `-m backend.dispatcher.main` funcione.
COPY . ./backend/dispatcher
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1
CMD ["python", "-m", "backend.dispatcher.main"]
