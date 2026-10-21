# cloud_sql — la base de datos de Vigía Perú, en AWS o en GCP

Una sola base PostgreSQL 16 (`vigia`: postgis, pgvector, pg_trgm, unaccent, pg_stat_statements; ~2,2 GB
en 2026-10, 54 tablas, 5 roles de servicio). Esta carpeta deja todo lo necesario para tenerla en **AWS RDS**
(hoy, por créditos) o en **GCP Cloud SQL** (si aprueban créditos), y para pasarla de uno a otro.

```
cloud_sql/
├── terraform/            elige el destino con una variable:  -var proveedor=aws | gcp
│   ├── modules/aws_rds/       RDS PostgreSQL 16.15 · db.t4g.small · gp3 20 GB · TLS obligatorio · backups 7 días
│   └── modules/gcp_cloudsql/  réplica de la instancia vigia-db de GCP (db-custom-1-3840, 10 GB)
└── archivos/
    ├── esquema.sql        esquema sin datos (2026-10-12) — seguro de versionar
    ├── crear_roles.py     crea los 5 roles (migración 37) con las mismas contraseñas y ajustes
    ├── migrar.sh          gcp-a-aws | aws-a-gcp | verificar
    ├── verificar.py       compara filas por tabla entre dos bases
    └── datos/             volcados con datos personales — GITIGNORED, nunca al repo (el repo es público)
```

## Estado actual (2026-10-12)

- La base **vive en AWS RDS**: `vigia-db.c58yci0sglx8.us-east-2.rds.amazonaws.com` (cuenta 416689419419, perfil `founder.edwin`).
  Contraseña del admin: SSM `/vigia/vigia-db/password`; copia en GCP Secret Manager como `rds-password` (la que montan los agentes).
- La instancia **Cloud SQL `vigia-db` fue borrada** tras verificar que las 58 tablas coincidían fila por fila.
- **Respaldos conservados:**
  - Snapshot de RDS `vigia-db-tras-migracion-20261012` (y backups automáticos de 7 días).
  - Volcado completo + esquema en S3 privado, cifrado y versionado: `s3://vigia-db-respaldos-416689419419/gcp-cloudsql/`.
  - Copia local del volcado: `cloud_sql/archivos/datos/vigia.dump` (gitignored).
  - Copias on-demand de Cloud SQL (IDs `1791784083922` y `1791788578996`, 2026-10-12): Google las retiene al borrar la
    instancia, pero **no pude listarlas después del borrado** (la API da 403); no contar con ellas sin probar un restore.
- Quién se conecta y cómo: Workers (API, MCP, dispatcher y, desde 2026-10-14, los scrapers con el rol `vigia_jobs`) →
  Hyperdrive → túnel → **PgBouncer** en el proxy EC2 de AWS (módulo `aws_proxy`; la VM de GCP quedó apagada).
  Agentes y jobs de Cloud Run → RDS directo
  (`PGHOST`, `PGSSLMODE=require`; en servicios Node `no-verify`). Los scripts de `infrastructure/deploy/` ya usan `DB_HOST`.
- Único error al restaurar (inofensivo): `role "cloudsqlsuperuser" does not exist` (rol propio de Google).

## Levantar la base

```bash
cd cloud_sql/terraform
cp terraform.tfvars.example terraform.tfvars      # proveedor = "aws" | "gcp"
export AWS_PROFILE=founder.edwin                  # cuenta founder.edwin@simplia.store
terraform init && terraform apply -var proveedor=aws
```

- La contraseña del admin la genera Terraform y queda en **SSM Parameter Store** (`/vigia/vigia-db/password`,
  AWS) o **Secret Manager** (`cloudsql-password`, GCP). No se imprime.
- `deletion_protection = true` y snapshot final obligatorio: para destruir hay que quitarla a propósito.
- El estado de Terraform vive en S3 (`vigia-terraform-estado-416689419419`, privado, cifrado, versionado; backend en
  `terraform/versions.tf`) desde el 2026-10-21. Antes era un archivo local con la contraseña adentro.

### Tamaño y costo (AWS, us-east-2)

| Clase | RAM | ≈ US$/mes | Para qué |
|---|---|---|---|
| `db.t4g.micro` | 1 GB | ~12 | pruebas; la base (2,2 GB) no cabe en caché |
| **`db.t4g.small`** (por defecto) | 2 GB | ~25 | ~50 usuarios con PgBouncer delante (la API usa ≤ 40 conexiones) |
| `db.t4g.medium` | 4 GB | ~50 | si hay varios análisis de agentes a la vez + picos |

+ disco gp3 20 GB (~US$2,5) + backups gratis hasta el tamaño del disco. Se cambia con `-var aws_clase=...`.
Ohio (us-east-2) es la región AWS más cercana a us-central1 (donde corren los agentes y PgBouncer): ~15 ms.

## Mover los datos

```bash
bash cloud_sql/archivos/migrar.sh gcp-a-aws     # roles + pg_dump de Cloud SQL + pg_restore en RDS (VACÍA el destino)
bash cloud_sql/archivos/migrar.sh verificar     # filas por tabla, ambos lados (con escrituras paradas deben ser IGUALES)
bash cloud_sql/archivos/migrar.sh aws-a-gcp     # el camino inverso, si GCP aprueba créditos
```

Usa Docker (`postgres:16`) para pg_dump/pg_restore; no hace falta instalar el cliente de Postgres.

## Corte (cutover) — orden

1. **Parar escrituras:** pausar el cron del dispatcher (`backend/dispatcher-worker`: `"crons": []`) y esperar a que
   `procesamientos` no tenga filas `procesando`. Pausar los Cloud Scheduler de scrapers.
2. `migrar.sh gcp-a-aws` y `migrar.sh verificar` → debe decir **IGUALES**.
3. **Apuntar los consumidores a la nueva base** (host `vigia-db.…us-east-2.rds.amazonaws.com`, `PGSSLMODE=require`):
   - **PgBouncer** (VM `vigia-pgbouncer`): cambiar el upstream de `127.0.0.1:5432` (cloud-sql-proxy) al host de RDS.
     Con esto la API, el MCP y los Workers (Hyperdrive → túnel → PgBouncer) siguen sin cambios.
   - **Agentes** (4 servicios Cloud Run) y **API Cloud Run**: `PGHOST=<host RDS>`, `PGSSLMODE=require`,
     y quitar `--add-cloudsql-instances`. `tools/_core.py` ya acepta `PGSSLMODE=require` (cifra sin verificar CA).
   - **Jobs y scrapers** (`vigia-ingest`, `vigia-batch`, `scraper-*`): mismas variables.
   - Scripts locales: `PGHOST`, `PGSSLMODE=require`, contraseña de SSM.
4. Probar: `/app`, un contrato analizado, `/admin`, un análisis nuevo de punta a punta.
5. **Snapshot final y apagado de Cloud SQL:** copia on-demand (`gcloud sql backups create`) y luego borrar la
   instancia. El backup on-demand sobrevive al borrado y restaura con `gcloud sql backups restore`.
6. Reanudar dispatcher y scrapers.

Vuelta atrás antes del paso 5: re-apuntar las variables a Cloud SQL; la base de GCP no se tocó.

## Seguridad (estado 2026-10-12)

```
Workers (API, MCP, dispatcher, scrapers) → Hyperdrive → túnel ──┐
                                                                 ▼   (sin puertos de entrada, solo SSM)
                                              EC2 proxy t4g.micro: PgBouncer ──TLS verificado──► RDS
Cloud Run (agentes, jobs, API/MCP de respaldo) ── salida por IP FIJA (Cloud NAT) ──TLS──────────► RDS
```

- **Red (desde el 2026-10-21):** la base NO es pública (`publicly_accessible = false`, `cidrs_permitidos = []`). El grupo
  de seguridad permite 5432 solo al proxy y a las Lambdas (por grupo de seguridad). Para administrar desde una PC:
  `python infrastructure/aws/tunel_rds.py prod` (Session Manager por el proxy, sin IPs ni llaves SSH). Si algo vuelve a
  correr en GCP (GCP_USE), su salida fija va en `cidrs_permitidos` y la base vuelve a ser pública solo para esas IPs.
- **Cifrado:** disco cifrado, `rds.force_ssl=1`, y TLS **verificado** contra la CA de RDS (`certs/rds-global-bundle.pem`) en
  PgBouncer, agentes (`PGSSLMODE=verify-full`) y API de respaldo. El MCP de respaldo y los jobs usan `require`/`no-verify`.
- **Mínimo privilegio:** los agentes ya no son `postgres`: usan `vigia_agentes` (migración 43; solo SELECT/INSERT/UPDATE/DELETE,
  sin DDL ni TRUNCATE). API, MCP, dispatcher y jobs ya tenían su rol propio (migración 37).
- **Proxy sin SSH:** acceso solo por AWS Systems Manager, IMDSv2 obligatorio, secretos en SSM Parameter Store (no en Terraform).
- **Auditoría:** `pgaudit` (DDL y roles), `log_connections/log_disconnections`, logs a CloudWatch; borrado protegido y snapshot final.
- **Pendiente / límites conocidos:**
  - Administración: siempre por `infrastructure/aws/tunel_rds.py` (ya no hay IP de administración en el SG).
  - El proxy ignora cambios de AMI (`lifecycle`): actualizarlo es un `terraform apply -replace=module.proxy[0].aws_instance.proxy`
    a propósito, nunca un efecto de otro apply.
  - La primera petición de la API de respaldo tras un arranque en frío puede tardar ~5 s (asignación de puertos de Cloud NAT).
  - Contraseñas: rotarlas (admin, vigia_*) con `terraform apply -replace=random_password.db` + `crear_roles.py` es un paso manual.
  - La VM `vigia-pgbouncer` de GCP quedó **apagada** (no borrada) por si hay que volver atrás; ya nadie la usa.
  - El repo es público: los volcados (`datos/`, `*.dump`) están en `.gitignore`.

## Modelos de IA (independiente de dónde esté la base)

Los modelos siguen en GCP (Gemini en Vertex) y Cloudflare Workers AI se enciende con interruptores
(`backend/agent/agents/_shared/models.py`): ver `backend/llm-worker/README.md`.
