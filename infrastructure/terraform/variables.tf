variable "project_id" {
  description = "ID del proyecto GCP."
  type        = string
}

variable "project_number" {
  description = "Número del proyecto GCP (para la service account por defecto de Compute)."
  type        = string
}

variable "region" {
  description = "Región principal de Cloud Run y Cloud SQL."
  type        = string
  default     = "us-central1"
}

variable "sql_instance_name" {
  type    = string
  default = "vigia-db"
}

variable "sql_tier" {
  description = "Tier de Cloud SQL. Hoy corre db-custom-2-7680 (2 vCPU / 7.5 GB, ~US$100/mes); db-custom-1-3840 (~US$50) alcanza para la carga actual."
  type        = string
  default     = "db-custom-1-3840"
}

variable "bucket_documentos" {
  type    = string
  default = "vigia-peru-documentos"
}

variable "bucket_reportes" {
  type    = string
  default = "vigia-peru-reportes"
}

variable "bucket_rag" {
  description = "Bucket con el Parquet de embeddings de opiniones OECE (RAG legal)."
  type        = string
  default     = "hacklatam-rag-leyes"
}

variable "firebase_project_id" {
  description = "Proyecto Firebase usado para Auth (puede ser distinto al de GCP)."
  type        = string
  default     = "simplia-project"
}

variable "agent_max_instances" {
  type    = number
  default = 5
}

variable "placeholder_image" {
  description = "Imagen inicial de los servicios Cloud Run. El código real se despliega con infrastructure/deploy/*.sh (gcloud run deploy --source); Terraform ignora cambios de imagen."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
