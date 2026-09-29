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

## Réplica en Cloudflare Workers

La misma app corre también como Worker (`vigia-api`, entrada `src/worker.ts`, Postgres por
Hyperdrive). Variables, secretos, desarrollo local y diferencias: [CLOUDFLARE.md](CLOUDFLARE.md).

## Auth con Firebase

El frontend manda en cada request:
```
Authorization: Bearer <ID token de firebase>
```

El middleware `requireAuth` lo valida vía Firebase Admin SDK (en Workers, con jose y los mismos
chequeos) contra el proyecto `simplia-project` (que es donde están los user-ids del login del demo).

## Cambiar de proyecto

**Cloud Run.** `bash infrastructure/deploy/api.sh` despliega en `ENTRADA_PROJECT_ID`, pero se conecta a la base de `PROJECT_ID`:

- `PGHOST=/cloudsql/<PROJECT_ID>:us-central1:vigia-db`. La cuenta `vigia-api@` necesita `roles/cloudsql.client` en `PROJECT_ID`.
- Las URLs de los agentes se arman con `AGENT_HOST_SUFFIX` (`<número de PROJECT_ID>.<región>.run.app`; `sufijo_run` en `_common.sh`).

**Worker de Cloudflare** (`wrangler.jsonc`):

- `AGENT_HOST_SUFFIX` y `GCS_PROJECT_ID` (el proyecto de los buckets).
- Secretos: `GCP_SA_KEY` (su cuenta necesita `run.invoker` en los agentes y lectura en los buckets) y `ADMIN_TOKEN`.
- La base llega por Hyperdrive y el túnel `vigia-db`, que siguen a la VM de PgBouncer: al mudarse no se tocan.

Guía completa: `infrastructure/deploy/migracion/README.md`.
