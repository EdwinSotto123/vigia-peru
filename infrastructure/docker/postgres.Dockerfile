# Postgres 14 + PostGIS + pgvector — misma combinación de extensiones que Cloud SQL (vigia-db).
# Usado solo para desarrollo local vía infrastructure/docker-compose.yml.
FROM postgis/postgis:14-3.4
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-14-pgvector \
    && rm -rf /var/lib/apt/lists/*
