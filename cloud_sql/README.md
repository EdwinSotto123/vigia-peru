# cloud_sql: la base de datos de Vigía

Una sola base PostgreSQL 16 (`vigia`: postgis, pgvector, pg_trgm, unaccent, pg_stat_statements) en **AWS RDS**
(us-east-2), privada. Tenía ~40 GB y 115 tablas el 2026-10-25 (`docs/DATOS_Y_SENALES.md`). El nombre de la carpeta
quedó de cuando vivía en GCP Cloud SQL; esta carpeta la declara en Terraform y guarda lo necesario para moverla.

```
cloud_sql/
├── terraform/                 el destino se elige con una variable: -var proveedor=aws (hoy) | gcp (legado)
│   ├── modules/aws_rds/       RDS PostgreSQL 16.15, db.t4g.large por defecto, gp3 de 50 GB que crece hasta 200,
│   │                          TLS obligatorio, backups de 7 días
│   ├── modules/aws_proxy/     EC2 t4g.micro con PgBouncer y el túnel de Cloudflare, sin puertos de entrada
│   └── modules/gcp_cloudsql/  legado: la instancia de Cloud SQL
└── archivos/
    ├── esquema.sql            esquema sin datos (2026-10-12), seguro de versionar
    ├── crear_roles.py         crea los roles de servicio (migración 37) con sus contraseñas y ajustes
    ├── crear_rol_agentes.py   el rol vigia_agentes (migración 43)
    ├── crear_rol_ab.py        el rol de sólo lectura vigia_ab (migración 44)
    ├── preparar_proxy.sh      carga en SSM los secretos del proxy (lee de GCP: legado)
    ├── migrar.sh              gcp-a-aws | aws-a-gcp | verificar
    ├── verificar.py           compara filas por tabla entre dos bases
    └── datos/                 volcados con datos personales: GITIGNORED, nunca al repo (el repo es público)
```

## Estado actual

- La base **vive en AWS RDS** desde el 2026-10-12. La contraseña del admin está en SSM (`/vigia/vigia-db/password`).
- La instancia de **Cloud SQL fue borrada** tras verificar que las 58 tablas coincidían fila por fila.
- **Respaldos:** el snapshot de RDS `vigia-db-tras-migracion-20261012`, los backups automáticos de 7 días y un volcado
  completo con su esquema en un bucket privado de S3, cifrado y versionado.
- **Quién se conecta y cómo:**
  - Los Workers (API, MCP, dispatcher y scrapers): Hyperdrive, túnel de Cloudflare y **PgBouncer** en el proxy de AWS.
  - Las Lambdas de agentes: directo a RDS por la VPC, con TLS verificado y el rol `vigia_agentes`.
  - Las tareas de GitLab CI y los scripts de la PC: un túnel de Session Manager por el proxy
    (`infrastructure/aws/tunel_rds.py`). El CI entra como `vigia_ci`, miembro de `vigia_jobs`.
- Los Workers que consultan la base corren con `placement` `aws:us-east-2`: ~17 ms por consulta
  (`infrastructure/deploy/cloudflare/base.sh`).

## Levantar la base

```bash
cd cloud_sql/terraform
cp terraform.tfvars.example terraform.tfvars      # proveedor = "aws"
export AWS_PROFILE=<tu perfil de AWS>
terraform init && terraform apply -var proveedor=aws
```

- La contraseña del admin la genera Terraform y queda en **SSM Parameter Store** (`/vigia/vigia-db/password`). No se
  imprime.
- `deletion_protection = true` y snapshot final obligatorio: para destruir hay que quitarla a propósito.
- El estado de Terraform vive en un bucket privado de S3, cifrado y versionado (backend en `terraform/versions.tf`),
  desde el 2026-10-21. Antes era un archivo local con la contraseña adentro.

### Tamaño y costo (AWS, us-east-2)

| Clase | RAM | Costo | Para qué |
|---|---|---|---|
| `db.t4g.micro` | 1 GB | ~US$ 12 al mes | pruebas; es la de `vigia-db-dev` |
| `db.t4g.small` | 2 GB | ~US$ 25 al mes | con la historia desde 2015, las consultas en frío tardaban 3 a 9 s |
| **`db.t4g.large`** (por defecto) | 8 GB | ~US$ 0,13 por hora | producción, desde el 2026-10-20 |

Más el disco gp3 (50 GB que crece solo hasta 200). Se cambia con `-var aws_clase=...`.

## Mover los datos

```bash
bash cloud_sql/archivos/migrar.sh gcp-a-aws     # roles + pg_dump de Cloud SQL + pg_restore en RDS (VACÍA el destino)
bash cloud_sql/archivos/migrar.sh verificar     # filas por tabla, ambos lados (con escrituras paradas deben ser IGUALES)
bash cloud_sql/archivos/migrar.sh aws-a-gcp     # el camino inverso, si algún día se vuelve a GCP
```

Usa Docker (`postgres:16`) para pg_dump/pg_restore; no hace falta instalar el cliente de Postgres.

## Corte (cutover): el orden

Así se hizo el 2026-10-12, de Cloud SQL a RDS. Queda de referencia: menciona piezas de GCP que ya no existen.

1. **Parar escrituras:** pausar el cron del dispatcher (`backend/dispatcher-worker`: `"crons": []`) y esperar a que
   `procesamientos` no tenga filas `procesando`. Pausar los Cloud Scheduler de scrapers.
2. `migrar.sh gcp-a-aws` y `migrar.sh verificar`: debe decir **IGUALES**.
3. **Apuntar los consumidores a la nueva base** (el host de RDS, `PGSSLMODE=require`):
   - **PgBouncer** (VM `vigia-pgbouncer`): cambiar el upstream de `127.0.0.1:5432` (cloud-sql-proxy) al host de RDS.
     Con esto la API, el MCP y los Workers (por Hyperdrive, el túnel y PgBouncer) siguen sin cambios.
   - **Agentes** (4 servicios Cloud Run) y **API Cloud Run**: `PGHOST=<host RDS>`, `PGSSLMODE=require`,
     y quitar `--add-cloudsql-instances`. `tools/_core.py` ya acepta `PGSSLMODE=require` (cifra sin verificar CA).
   - **Jobs y scrapers** (`vigia-ingest`, `vigia-batch`, `scraper-*`): mismas variables.
   - Scripts locales: `PGHOST`, `PGSSLMODE=require`, contraseña de SSM.
4. Probar: `/app`, un contrato analizado, `/admin`, un análisis nuevo de punta a punta.
5. **Snapshot final y apagado de Cloud SQL:** copia on-demand (`gcloud sql backups create`) y luego borrar la
   instancia. El backup on-demand sobrevive al borrado y restaura con `gcloud sql backups restore`.
6. Reanudar dispatcher y scrapers.

Vuelta atrás antes del paso 5: re-apuntar las variables a Cloud SQL; la base de GCP no se tocó.

## Seguridad

```
Workers (API, MCP, dispatcher, scrapers) ─► Hyperdrive ─► túnel ──┐
                                                                  ▼   (sin puertos de entrada, sólo SSM)
                                               EC2 proxy t4g.micro: PgBouncer ──TLS verificado──► RDS
Lambdas de agentes (en la VPC) ─────────────────────────────────────TLS verificado──────────────► RDS
PC y GitLab CI ── Session Manager por el proxy (tunel_rds.py) ─────────────────────────────────► RDS
```

- **Red (desde el 2026-10-21):** la base NO es pública (`publicly_accessible = false`, `cidrs_permitidos = []`). El grupo
  de seguridad permite 5432 sólo al proxy y a las Lambdas (por grupo de seguridad). Para administrar desde una PC:
  `python infrastructure/aws/tunel_rds.py prod` (Session Manager por el proxy, sin IPs ni llaves SSH). Si algo vuelve a
  correr en GCP (GCP_USE), su salida fija va en `cidrs_permitidos` y la base vuelve a ser pública sólo para esas IPs.
- **Cifrado:** disco cifrado, `rds.force_ssl=1`, y TLS **verificado** contra la CA de RDS (`certs/rds-global-bundle.pem`)
  en PgBouncer y en los agentes (`PGSSLMODE=verify-full`). Por el túnel se usa `require`: el nombre del certificado no
  coincide con 127.0.0.1, y el tráfico ya va cifrado dentro de la sesión de SSM.
- **Mínimo privilegio:** los agentes no son `postgres`: usan `vigia_agentes` (migración 43; sólo SELECT/INSERT/UPDATE/DELETE,
  sin DDL ni TRUNCATE). La API, el MCP, el dispatcher y los scrapers tienen su rol propio (migración 37); el CI, `vigia_ci`.
- **Proxy sin SSH:** acceso sólo por AWS Systems Manager, IMDSv2 obligatorio, secretos en SSM Parameter Store (no en Terraform).
- **Auditoría:** `pgaudit` (DDL y roles), `log_connections/log_disconnections`, logs a CloudWatch; borrado protegido y snapshot final.
- **Pendiente / límites conocidos:**
  - Administración: siempre por `infrastructure/aws/tunel_rds.py` (ya no hay IP de administración en el grupo de seguridad).
  - El proxy ignora cambios de AMI (`lifecycle`): actualizarlo es un `terraform apply -replace=module.proxy[0].aws_instance.proxy`
    a propósito, nunca un efecto de otro apply.
  - Contraseñas: rotarlas (admin, vigia_*) con `terraform apply -replace=random_password.db` + `crear_roles.py` es un paso manual.
  - El repo es público: los volcados (`datos/`, `*.dump`) están en `.gitignore`.

## Modelos de IA

No dependen de la base: son sólo modelos abiertos de Workers AI (DeepSeek V4.1 Flash y GLM 5.3), servidos por el Worker
`vigia-llm` (`backend/llm-worker/README.md`).
