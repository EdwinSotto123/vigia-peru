# vigia-peru-api

CRUD y endpoints para Vigía Perú. Corre en **Cloud Run** + Postgres en Cloud
SQL + buckets GCS para uploads.

## Rutas

```
GET    /                       health
GET    /health                 health + ping postgres

GET    /alertas?region=&estado=&scoreMin=&limit=&offset=
GET    /alertas/:id            (uuid o codigo)
POST   /alertas                crear alerta + banderas (auth servicio)

GET    /entidades?q=&region=&tipo=&limit=
GET    /entidades/:ruc         perfil entidad + cache MEF + alertas

GET    /reportes?region=&categoria=&bbox=...
GET    /reportes/:id

POST   /upload/sign            (auth) → {uploadUrl, blobUrl}
```

## Dev local

```bash
cd api
npm install
cp .env.example .env
# editá .env con el password de Cloud SQL

# Necesitás el Cloud SQL Auth Proxy corriendo aparte:
# https://cloud.google.com/sql/docs/postgres/connect-auth-proxy
cloud-sql-proxy --port 5432 vivid-spot-480905-a4:us-central1:vigia-db

# y en otra terminal:
npm run dev
```

## Deploy a Cloud Run

```bash
# Build + push + deploy en un solo comando (Cloud Build hace lo demás)
gcloud run deploy vigia-peru-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances vivid-spot-480905-a4:us-central1:vigia-db \
  --set-env-vars "PGHOST=/cloudsql/vivid-spot-480905-a4:us-central1:vigia-db,PGUSER=postgres,PGDATABASE=vigia,FIREBASE_PROJECT_ID=simplia-project,GCS_PROJECT_ID=vivid-spot-480905-a4,GCS_BUCKET_DOCUMENTOS=vigia-peru-documentos,GCS_BUCKET_REPORTES=vigia-peru-reportes,ALLOWED_ORIGINS=http://localhost:3000" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest"
```

Antes de deployar, crear el secret:
```bash
gcloud secrets create cloudsql-password --data-file=.cloudsql-password
```

## Auth con Firebase

El frontend manda en cada request:
```
Authorization: Bearer <ID token de firebase>
```

El middleware `requireAuth` lo valida vía Firebase Admin SDK contra el proyecto
`simplia-project` (que es donde están los user-ids del login del demo).
