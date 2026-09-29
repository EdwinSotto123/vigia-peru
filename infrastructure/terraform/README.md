# Terraform de la plataforma

Declara la base de la plataforma en un proyecto de GCP:

- APIs, agentes de servicio de Vertex y cuentas propias (`vigia-agentes`, `vigia-jobs`, `vigia-pgbouncer`) con sus roles;
- Cloud SQL tal como corre en producción;
- buckets del RAG y de exportaciones;
- contenedores de secretos y Artifact Registry;
- Document AI y Vertex AI Search.

**Cambiar de proyecto = cambiar `project_id` y `project_number` en `terraform.tfvars`.** Nada más acá tiene un proyecto fijo.

Terraform no maneja:

| Qué | Cómo se hace |
|---|---|
| Los datos (base, 4 corpus del RAG, documentos de Vertex AI Search) | `infrastructure/deploy/migracion/` o `backend/db/snapshot/` |
| Los servicios de Cloud Run | Por defecto los despliegan los scripts. Con `gestionar_servicios = true` también se declaran acá (`cloud_run.tf`) |
| La VM de PgBouncer y el túnel | `infrastructure/deploy/pgbouncer.sh crear` genera el script de arranque |
| Cloudflare | `wrangler.jsonc` de cada Worker |

## Proyecto nuevo

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars   # project_id, project_number, IP autorizada; gestionar_password_sql = true
gcloud storage buckets create gs://<project_id>-tfstate --location us-central1 --uniform-bucket-level-access
terraform init -backend-config="bucket=<project_id>-tfstate"
terraform apply
terraform output   # sql_connection_name, docai_processor_id, rag_bucket, agent_host_suffix, cuentas
```

Después, las fases de datos y servicios: `infrastructure/deploy/migracion/README.md`.

## Adoptar lo que ya existe (lo que creó migrar-proyecto.sh)

```bash
cp imports.tf.example imports.tf      # ajustar el id del procesador de Document AI
terraform plan                        # debe decir "N to import ... 0 to destroy"
terraform apply && rm imports.tf
```

Probado contra `project-a974c6e5-0cdf-4b11-a86` el 29/09/2026:

| Escenario | Plan |
|---|---|
| Proyecto vacío | 68 recursos a crear |
| Adoptar lo que ya existe | 24 importados, 44 a agregar (roles y APIs que ya estaban: no cambian nada), 1 cambio en el lugar, 0 a destruir |

El cambio en el lugar es de Query Insights (largo de consulta 0 → 1024) y no reinicia la base.

## Notas

- **Proveedores.** Con credenciales de usuario (ADC), Vertex AI Search exige proyecto de cuota: `user_project_override` y `billing_project` en `versions.tf`.
- **El motor de Vertex AI Search.** Si se creó por API, vuelve sin `industry_vertical` al importarlo. Tiene `ignore_changes` para que adoptarlo no lo recree.
- **La clave de `postgres`.** Con `gestionar_password_sql = true`, Terraform la genera y la guarda en `cloudsql-password`. Al mudarse va en `false`, porque el secreto se copia del origen y los servicios ya lo usan.
- **Buckets `vigia-peru-*`.** Siguen en el proyecto viejo mientras `crear_buckets_documentos = false`: la base guarda sus URLs.
