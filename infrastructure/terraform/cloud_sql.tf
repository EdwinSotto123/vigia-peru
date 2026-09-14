resource "random_password" "sql" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "vigia" {
  name             = var.sql_instance_name
  database_version = "POSTGRES_14"
  region           = var.region

  settings {
    tier              = var.sql_tier
    availability_type = "ZONAL"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled = true # Cloud Run conecta por Unix socket (Cloud SQL connector); la IP pública es para el proxy local
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    database_flags {
      name  = "cloudsql.enable_pgvector"
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
  name     = "postgres"
  instance = google_sql_database_instance.vigia.name
  password = random_password.sql.result
}

# Las extensiones (postgis, pg_trgm, unaccent, vector) y el esquema se aplican con
#   python backend/db/apply_all.py
