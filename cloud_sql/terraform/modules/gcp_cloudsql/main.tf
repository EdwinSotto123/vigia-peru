# Réplica de la instancia `vigia-db` tal como estaba el 2026-10-12 (PostgreSQL 16, 1 vCPU, 3,75 GB).
variable "nombre" { type = string }
variable "db_nombre" { type = string }
variable "db_usuario" { type = string }
variable "password" {
  type      = string
  sensitive = true
}
variable "tier" { type = string }
variable "almacenamiento_gb" { type = number }
variable "cidrs_permitidos" { type = list(string) }
variable "region" { type = string }
variable "proyecto" { type = string }

resource "google_sql_database_instance" "esta" {
  name                = var.nombre
  project             = var.proyecto
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = var.tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = var.almacenamiento_gb
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings { retained_backups = 7 }
    }
    database_flags {
      name  = "max_connections"
      value = "100"
    }
    database_flags {
      name  = "log_min_duration_statement"
      value = "500"
    }
    database_flags {
      name  = "track_io_timing"
      value = "on"
    }
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
      dynamic "authorized_networks" {
        for_each = var.cidrs_permitidos
        content {
          name  = "acceso-${authorized_networks.key}"
          value = authorized_networks.value
        }
      }
    }
  }
}

resource "google_sql_database" "vigia" {
  name     = var.db_nombre
  instance = google_sql_database_instance.esta.name
  project  = var.proyecto
}

resource "google_sql_user" "admin" {
  name     = var.db_usuario
  instance = google_sql_database_instance.esta.name
  password = var.password
  project  = var.proyecto
}

resource "google_secret_manager_secret" "password" {
  secret_id = "cloudsql-password"
  project   = var.proyecto
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "password" {
  secret      = google_secret_manager_secret.password.id
  secret_data = var.password
}

output "host" { value = google_sql_database_instance.esta.public_ip_address }
output "secreto" { value = google_secret_manager_secret.password.secret_id }
