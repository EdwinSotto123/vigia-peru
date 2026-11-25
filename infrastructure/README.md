# infrastructure/

Todo lo que no es código de aplicación: el despliegue, las cuentas, el correo, el entorno local y la publicación del
espejo en GitHub. La base de datos se declara aparte, en `cloud_sql/`.

```
infrastructure/
├── deploy/               scripts de despliegue (deploy/README.md)
│   ├── desplegar.sh      producción desde la PC, según proveedores.env
│   ├── dev.sh            el entorno DEV (docs/DEV.md)
│   ├── cloudflare/       los Workers, la web y la portada gobserva.cloud
│   ├── aws/              las Lambdas de agentes, el acceso de GitLab a AWS y el relay de Lima
│   └── gcp/              legado: Cloud Run y compañía
├── aws/                  túnel a RDS, cuentas de Cognito y correo por SES
├── dev/                  dev.py, lo que usa dev.sh
├── github/               la publicación del espejo público
├── docker/               imagen de Postgres 16 con PostGIS y pgvector
├── docker-compose.yml    esa base en 127.0.0.1:5432
├── proveedores.env       qué corre dónde (docs/PROVEEDORES.md)
├── terraform/            legado: la plataforma en GCP
└── hosting/              legado: Firebase Hosting
```

## Dónde corre cada cosa

| Pieza | Dónde |
|---|---|
| La web (`frontend`, Worker `vigia-web`) | Cloudflare Workers con OpenNext, en `vigia.gobserva.cloud`. Los productos de Gobserva (empleo, licitaciones, obras, salud y car `.gobserva.cloud`) son rutas del mismo sitio |
| La portada de `gobserva.cloud` | El Worker `gobserva-redirect` (`deploy/cloudflare/gobserva-redirect/`) |
| La API (`backend/api`) | Hono en Cloudflare Workers, con Hyperdrive hacia la base |
| El MCP (`backend/mcp-worker`) | Cloudflare Workers |
| La captura de datos (`backend/scrapers-worker`) | Workflows de Cloudflare |
| Los modelos (`backend/llm-worker`) | Sólo modelos abiertos de Workers AI: DeepSeek V4.1 Flash y GLM 5.3 |
| El OCR (`backend/ocr-worker`) | Docling en Cloudflare Containers |
| Los agentes (`backend/agent`) | Python en AWS Lambda, una función por red de contrato |
| La base | PostgreSQL en AWS RDS, privada (`cloud_sql/README.md`) |
| Los archivos | Cloudflare R2 |
| Las cuentas | Firebase Auth para Vigía; AWS Cognito para cada app de Gobserva (`aws/cognito_gobserva.py`) |

GCP está sin facturación: lo que queda de él en este repo es legado (`docs/PROVEEDORES.md`).

## Entorno local

```bash
docker compose -f infrastructure/docker-compose.yml up -d
export PGPASSWORD=vigia           # PGHOST=127.0.0.1, PGUSER=postgres, PGDATABASE=vigia son los defaults
python backend/db/apply_all.py    # extensiones y migraciones
```

La web se corre con `npx next dev -p 3100` en `frontend/`; para verla con los datos de producción hace falta el
encabezado del build (`frontend/README.md`). La API, con `npm run dev` en `backend/api`.

Para tareas contra la base de producción o DEV: `python infrastructure/aws/tunel_rds.py prod|dev` abre un puerto local
que llega a RDS por Session Manager.

## CI/CD en GitLab

El repo de trabajo está en GitLab (privado). `.gitlab-ci.yml`:

| Job | Cuándo | Qué hace |
|---|---|---|
| `verificar:web`, `verificar:api` | Solo, con cada push a `main` o `dev` que toque su carpeta | Tipos, pruebas y, en la web, las guardias de estilo |
| `deploy:api:dev`, `deploy:web:dev` | Solo, con cada push a `dev` | Despliega `vigia-api-dev` y `vigia-web-dev` |
| `deploy:api:prod`, `deploy:web:prod` | Manual (▶) en `main` | Despliega `vigia-api` y `vigia-web` |
| `build:agente`, `deploy:agentes:prod` | El build, solo si un push a `main` cambia `backend/agent`; el despliegue, manual | Arma la imagen en ECR y la pone en las cinco Lambdas |
| `tarea:*` | Manual en `main` o por horario | Tareas pesadas contra la base, por el túnel de Session Manager |

- Los despliegues son manuales a propósito, para no soltar a producción sin querer.
- Variables del proyecto, enmascaradas: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `VIGIA_BUILD_TOKEN` (con él, el
  build de la web prerenderiza con datos). AWS no guarda llaves: los jobs piden un token OIDC y asumen el rol
  `vigia-gitlab-agentes` (`deploy/aws/gitlab_oidc.sh`), sólo desde `main`.
- Desde el 22 de noviembre de 2026 los pipelines corren en un runner propio, en una PC (detalle en `deploy/README.md`).
- Fuera del CI, desde la PC: las migraciones de la base (`deploy/dev.sh migrar` en DEV, por el túnel en producción) y los
  Workers secundarios (`bash infrastructure/deploy/desplegar.sh <componente>`), que sólo salen de lo commiteado.

## El espejo público en GitHub

`main` se publica en GitHub (Gobserva-Cloud/vigia-peru) con `bash infrastructure/github/publicar_github.sh`:

- Quita lo que no puede ser público (archivos con datos de personas y la operación de los scrapers). La copia se
  reescribe igual cada vez, así cada publicación sigue a la anterior sin forzar el push.
- Antes de empujar, `github/escanear_publicacion.py` busca secretos y DNI en lo que se publicaría; si encuentra algo, no
  publica.
- El push directo del repo de trabajo a GitHub está desactivado a propósito.
- En GitHub, `main` está protegida: sólo la actualiza el espejo. Cómo colaborar: `CONTRIBUTING.md`.

## Correo

La API manda los avisos por Resend si tiene el secreto `RESEND_API_KEY` (lo pone `deploy/correo_resend.py` después de
verificar el dominio); si no, por la Lambda de SES (`aws/correo_gobserva/README.md`).

## Legado

- `deploy/gcp/`: los scripts de Cloud Run, Cloud Run Jobs, PgBouncer en GCP y Firebase Hosting. `desplegar.sh` los usa
  sólo con `GCP_USE=true` en `proveedores.env`.
- `terraform/`: la plataforma en GCP (Cloud Run, Cloud SQL, Vertex, Document AI).
- `hosting/`: Firebase Hosting delante de Cloud Run.
- `deploy/gcp/migracion/`: la mudanza entre proyectos de GCP.
