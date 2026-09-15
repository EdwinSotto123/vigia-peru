# Los servicios de Cloud Run. Terraform fija la CONFIGURACIÓN (recursos, escala,
# variables, secretos, conexión SQL); la IMAGEN la actualiza cada deploy con
# `gcloud run deploy --source` (infrastructure/deploy/*.sh), por eso `ignore_changes`.
#
# Agentes: hay CUATRO servicios con el MISMO código (backend/agent) y distinto
# PIPELINE_PROFILE: agent-orchestrator-adk (bienes) + agente-servicios / agente-obras /
# agente-otros (for_each sobre local.agent_profiles). El spec VIVO de los tres nuevos lo
# gestiona `infrastructure/deploy/agentes.sh` (copia el spec del de bienes con
# `gcloud run services replace`: hereda ~40 variables operativas y secretos); acá se
# declaran con la misma forma para que `terraform plan` los conozca e ignore image/env.

locals {
  sql_connection = google_sql_database_instance.vigia.connection_name
  pg_env = {
    PGHOST     = "/cloudsql/${local.sql_connection}"
    PGUSER     = "postgres"
    PGDATABASE = "vigia"
  }
  # Modelos por tier (verificados 2026-09-15 en Vertex AI global; 3.6-pro/3.5-pro no existen).
  agent_model_env = {
    GEMINI_MODEL       = "gemini-3.6-flash"
    GEMINI_MODEL_SMART = "gemini-3.6-flash"
    GEMINI_MODEL_FAST  = "gemini-3.5-flash-lite"
    GEMINI_MODEL_JUDGE = "gemini-3.5-flash"
  }
  agent_common_env = merge(local.pg_env, local.agent_model_env, {
    GOOGLE_CLOUD_PROJECT      = var.project_id
    GOOGLE_CLOUD_LOCATION     = "global"
    GOOGLE_GENAI_USE_VERTEXAI = "true"
    DETERMINISTIC_PIPELINE    = "1"
    PARALLEL_RESEARCH         = "1"
    LEGAL_RAG_BACKEND         = "vertex"
    DOCAI_PROJECT             = var.project_id
    DOCAI_LOCATION            = "us"
  })
  agent_secrets = {
    PGPASSWORD       = google_secret_manager_secret.cloudsql_password.secret_id
    GOOGLE_API_KEY   = "google-api-key"
    PHOENIX_API_KEY  = "phoenix-api-key"
    PINECONE_API_KEY = "pinecone-api-key"
  }
  # Perfil → nombre del servicio (bienes es el histórico, recurso `agent` abajo).
  agent_profiles = {
    servicios = "agente-servicios"
    obras     = "agente-obras"
    otros     = "agente-otros"
  }
}

# ── Orquestador ADK (único servicio que escribe en la DB) ────────────────────
resource "google_cloud_run_v2_service" "agent" {
  name     = "agent-orchestrator-adk"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = local.runtime_sa
    timeout                          = "3600s"
    max_instance_request_concurrency = 1

    scaling {
      min_instance_count = 0
      max_instance_count = var.agent_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_connection]
      }
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "2"
          memory = "8Gi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = merge(local.agent_common_env, { PIPELINE_PROFILE = "bienes" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.agent_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # Las variables operativas (DOCAI_PROCESSOR_ID, LOCAL_DOWNLOADER_URL,
    # LEGAL_RAG_ENGINE, MARKET_*, PARSE_*) se ajustan con --update-env-vars.
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime_sql,
  ]
}

# ── Agentes por perfil: servicios / obras / otros (mismo código, PIPELINE_PROFILE distinto) ──
# El spec vivo (imagen + variables operativas) lo aplica infrastructure/deploy/agentes.sh;
# Terraform solo garantiza forma, recursos y secretos. Misma imagen que `agent`.
resource "google_cloud_run_v2_service" "agente_perfil" {
  for_each = local.agent_profiles

  name     = each.value
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  labels = { vigia-perfil = each.key }

  template {
    service_account                  = local.runtime_sa
    timeout                          = "3600s"
    max_instance_request_concurrency = 1

    scaling {
      min_instance_count = 0
      max_instance_count = var.agent_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_connection]
      }
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "2"
          memory = "8Gi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = merge(local.agent_common_env, { PIPELINE_PROFILE = each.key })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.agent_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime_sql,
  ]
}

# ── API de lectura (Hono) ────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = "vigia-peru-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.runtime_sa

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_connection]
      }
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = merge(local.pg_env, {
          FIREBASE_PROJECT_ID   = var.firebase_project_id
          GCS_PROJECT_ID        = var.project_id
          GCS_BUCKET_DOCUMENTOS = google_storage_bucket.documentos.name
          GCS_BUCKET_REPORTES   = google_storage_bucket.reportes.name
          ALLOWED_ORIGINS       = "http://localhost:3000"
        })
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cloudsql_password.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime_sql,
  ]
}

# ── Servidor MCP (read-only) ─────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "mcp" {
  name     = "vigia-mcp"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.runtime_sa

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_connection]
      }
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.pg_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cloudsql_password.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.runtime_sql,
  ]
}

# ── Frontend (Next.js) ───────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  name     = "vigia-peru-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.runtime_sa

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      dynamic "env" {
        for_each = {
          VIGIA_API_URL        = google_cloud_run_v2_service.api.uri
          VIGIA_AGENT_URL      = google_cloud_run_v2_service.agent.uri
          GOOGLE_CLOUD_PROJECT = var.project_id
          DOCS_BUCKET          = google_storage_bucket.documentos.name
          REPORTES_BUCKET      = google_storage_bucket.reportes.name
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.apis]
}

# Todos públicos (demo). Para producción: quitar y poner IAP / Cloud Armor delante.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = merge({
    agent    = google_cloud_run_v2_service.agent.name
    api      = google_cloud_run_v2_service.api.name
    mcp      = google_cloud_run_v2_service.mcp.name
    frontend = google_cloud_run_v2_service.frontend.name
  }, { for k, s in google_cloud_run_v2_service.agente_perfil : "agente_${k}" => s.name })
  name     = each.value
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
