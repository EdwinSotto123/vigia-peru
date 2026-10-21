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

# Quién puede llegar al puerto 5432 desde internet. SOLO IPs fijas (CIDR /32): nunca 0.0.0.0/0. Vacío (lo normal desde
# el 2026-10-21) = la base NO es pública: los Workers entran por el proxy (grupo de seguridad con_proxy), las Lambdas
# por la VPC, y para administrar desde una PC se usa infrastructure/aws/tunel_rds.py (Session Manager, sin IPs).
# Sólo si se vuelve a correr algo en GCP (GCP_USE, docs/PROVEEDORES.md) va aquí su salida fija de Cloud Run
# (infrastructure/deploy/egreso-fijo.sh): con alguna IP, la base pasa a publicly_accessible.
variable "cidrs_permitidos" {
  type    = list(string)
  default = []
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
  description = "db.t4g.micro (1 GB, ~US$12/mes) solo para pruebas; db.t4g.small (2 GB) soporta ~50 usuarios con PgBouncer, pero con la historia desde 2015 (828 mil contratos) las consultas en frío tardaban 3-9 s: desde el 2026-10-20, db.t4g.large (8 GB)."
  type        = string
  default     = "db.t4g.large"
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
