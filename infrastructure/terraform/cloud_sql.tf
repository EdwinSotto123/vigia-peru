# La instancia tal cual corre en producción (29/09/2026). El contenido (esquema y datos) no es de
# Terraform: se restaura con backend/db/snapshot/README.md o se crea con backend/db/apply_all.py.

resource "random_password" "sql" {
  count   = var.gestionar_password_sql ? 1 : 0
  length  = 32
  special = false
}

resource "google_sql_database_instance" "vigia" {
  name             = var.sql_instance_name
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE" # Enterprise Plus no admite tiers de núcleo compartido (f1-micro)
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.sql_disk_gb
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled = true # Cloud Run y la VM usan el conector; la IP pública es para el batch local
      ssl_mode     = "ENCRYPTED_ONLY"
      dynamic "authorized_networks" {
        for_each = var.sql_authorized_networks
        content {
          value = authorized_networks.value
        }
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      point_in_time_recovery_enabled = var.sql_pitr
    }

    insights_config {
      query_insights_enabled = true
    }

    # max_connections: PgBouncer reparte 4 roles × (4 + 2 de reserva). Consultas lentas al log desde 500 ms.
    database_flags {
      name  = "max_connections"
      value = "40"
    }
    database_flags {
      name  = "log_min_duration_statement"
      value = "500"
    }
    database_flags {
      name  = "track_io_timing"
      value = "on"
    }
  }

  deletion_protection = true
  depends_on          = [google_project_service.apis]
}

resource "google_sql_database" "vigia" {
  name     = "vigia"
  instance = google_sql_database_instance.vigia.name
}

resource "google_sql_user" "postgres" {
  count    = var.gestionar_password_sql ? 1 : 0
  name     = "postgres"
  instance = google_sql_database_instance.vigia.name
  password = random_password.sql[0].result
}

# Los roles vigia_api, vigia_api_admin, vigia_mcp, vigia_dispatcher y vigia_jobs, las extensiones y
# los permisos los crea la migración 37 (backend/db/migrations) o el -pre.sql/-post.sql de un snapshot.
# Sus contraseñas: gcloud sql users set-password desde los secretos cloudsql-password-*.
