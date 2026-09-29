# Mudarse de proyecto = cambiar project_id y project_number en terraform.tfvars (ver README.md).
# Nada más en este directorio tiene un proyecto fijo.

variable "project_id" {
  description = "Proyecto de la plataforma: Cloud SQL, agentes, IA, PgBouncer, scrapers (PROJECT_ID de infrastructure/deploy/_common.sh)."
  type        = string
}

variable "project_number" {
  description = "Número del proyecto (gcloud projects describe <id> --format='value(projectNumber)'): agentes de servicio y nombres de buckets."
  type        = string
}

variable "region" {
  description = "Región principal de Cloud Run, Cloud SQL y RAG Engine."
  type        = string
  default     = "us-central1"
}

# ── Cloud SQL ───────────────────────────────────────────────────────────────────────────────────
variable "sql_instance_name" {
  type    = string
  default = "vigia-db"
}

variable "sql_tier" {
  description = "db-f1-micro (40 conexiones, ~US$9/mes) alcanza con PgBouncer delante. Para un import rápido o más carga: db-custom-2-7680."
  type        = string
  default     = "db-f1-micro"
}

variable "sql_disk_gb" {
  type    = number
  default = 10
}

variable "sql_authorized_networks" {
  description = "IPs (CIDR) que llegan a la IP pública de la base: la PC del batch nocturno y quien administre. Cloud Run y la VM usan el conector."
  type        = list(string)
  default     = []
}

variable "sql_pitr" {
  description = "Recuperación a un punto en el tiempo (guarda WAL: más disco)."
  type        = bool
  default     = false
}

variable "gestionar_password_sql" {
  description = "true en un proyecto nuevo: Terraform genera la clave de postgres y la guarda en cloudsql-password. false al mudarse: el secreto se copia del origen (migracion/herramientas.py secretos)."
  type        = bool
  default     = true
}

# ── Buckets ─────────────────────────────────────────────────────────────────────────────────────
variable "crear_buckets_documentos" {
  description = "Crear vigia-peru-documentos / -reportes en este proyecto. false mientras vivan en el proyecto viejo (BUCKETS_PROJECT_ID)."
  type        = bool
  default     = false
}

variable "bucket_documentos" {
  type    = string
  default = "vigia-peru-documentos"
}

variable "bucket_reportes" {
  type    = string
  default = "vigia-peru-reportes"
}

# ── Servicios ───────────────────────────────────────────────────────────────────────────────────
variable "gestionar_servicios" {
  description = "Declarar acá los servicios de Cloud Run (agentes, API, MCP, frontend). false: los despliegan los scripts (migracion/migrar-proyecto.sh agentes, api.sh, mcp.sh, frontend.sh) y Terraform no los toca."
  type        = bool
  default     = false
}

variable "invocadores_agentes" {
  description = "Cuentas (email) que llaman a los agentes: dispatcher y web de Cloudflare, frontend y API de la entrada."
  type        = list(string)
  default     = []
}

variable "firebase_project_id" {
  description = "Proyecto Firebase usado para Auth (puede ser distinto al de GCP)."
  type        = string
  default     = "simplia-project"
}

variable "agent_max_instances" {
  type    = number
  default = 2
}

variable "agents_public" {
  description = "Si los agentes aceptan invocaciones sin autenticar (allUsers). Solo con gestionar_servicios."
  type        = bool
  default     = false
}

variable "placeholder_image" {
  description = "Imagen inicial de los servicios de Cloud Run (solo con gestionar_servicios); la real la ponen los scripts."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
