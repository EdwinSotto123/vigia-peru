variable "proveedor" {
  description = "Dónde vive la base de datos: 'aws' (RDS) o 'gcp' (Cloud SQL)."
  type        = string
  default     = "aws"
  validation {
    condition     = contains(["aws", "gcp"], var.proveedor)
    error_message = "proveedor debe ser 'aws' o 'gcp'."
  }
}

variable "nombre" {
  type    = string
  default = "vigia-db"
}

variable "db_nombre" {
  type    = string
  default = "vigia"
}

variable "db_usuario" {
  type    = string
  default = "postgres"
}

variable "almacenamiento_gb" {
  description = "Disco inicial. La base pesa ~2,2 GB (2026-10)."
  type        = number
  default     = 20
}

# Quién puede llegar al puerto 5432 desde internet. SOLO IPs fijas (CIDR /32): nunca 0.0.0.0/0.
#   · 34.121.145.52/32  salida fija de Cloud Run (proyecto de agentes/jobs)  — infrastructure/deploy/egreso-fijo.sh
#   · 34.9.226.168/32   salida fija de Cloud Run (proyecto de la API/MCP de respaldo)
# El proxy de la VPC no necesita IP: entra por grupo de seguridad (con_proxy). Para administrar desde tu
# computadora agrega tu IP/32 (cambia: quítala al terminar).
variable "cidrs_permitidos" {
  type    = list(string)
  default = ["34.121.145.52/32", "34.9.226.168/32"]
  validation {
    condition     = !contains(var.cidrs_permitidos, "0.0.0.0/0")
    error_message = "No se permite 0.0.0.0/0: usa IPs fijas /32."
  }
}

variable "con_proxy" {
  description = "Crear el proxy (PgBouncer + túnel Cloudflare) en la VPC de AWS. Solo proveedor=aws."
  type        = bool
  default     = true
}

# ── AWS ──
variable "aws_region" {
  type    = string
  default = "us-east-2" # Ohio: la más cercana a us-central1 (Cloud Run / PgBouncer)
}
variable "aws_profile" {
  type    = string
  default = "founder.edwin"
}
variable "aws_clase" {
  description = "db.t4g.micro (1 GB, ~US$12/mes) solo para pruebas; db.t4g.small (2 GB) soporta ~50 usuarios con PgBouncer."
  type        = string
  default     = "db.t4g.small"
}

# ── GCP (solo si proveedor = gcp) ──
variable "gcp_project" {
  type    = string
  default = "project-a974c6e5-0cdf-4b11-a86"
}
variable "gcp_region" {
  type    = string
  default = "us-central1"
}
variable "gcp_tier" {
  type    = string
  default = "db-custom-1-3840"
}
