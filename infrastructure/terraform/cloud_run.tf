# SOLO con var.gestionar_servicios = true (por defecto false): hoy los servicios los despliegan los
# scripts (migracion/migrar-proyecto.sh agentes con herramientas.py agentes-yaml, api.sh, mcp.sh,
# frontend.sh) y Terraform se ocupa de la base de la plataforma. Esto queda para un proyecto único
# donde se quiera que Terraform también conozca los servicios.
#
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
    GEMINI_MODEL_JUDGE = "gemini-3.5-flash-lite"
    GEMINI_FLEX        = "1"
  }
  agent_common_env = merge(local.pg_env, local.agent_model_env, {
    GOOGLE_CLOUD_PROJECT      = var.project_id
    GOOGLE_CLOUD_LOCATION     = "global"
    GOOGLE_GENAI_USE_VERTEXAI = "true"
    DETERMINISTIC_PIPELINE    = "1"
    PARALLEL_RESEARCH         = "1"
    VERTEX_PROJECT            = var.project_id
    LEGAL_RAG_BACKEND         = "rag_engine"
    RAG_LOCATION              = var.region
    RAG_BUCKET                = google_storage_bucket.rag.name
    DOCAI_LOCATION            = "us"
    DOCAI_PROCESSOR_ID        = reverse(split("/", google_document_ai_processor.ocr.name))[0]
  })
  agent_secrets = {
    PGPASSWORD             = google_secret_manager_secret.cloudsql_password.secret_id
    ARIZE_API_KEY          = "arize-api-key"
    LOCAL_DOWNLOADER_TOKEN = "local-downloader-token"
    GOOGLE_API_KEY         = "google-api-key"
    PHOENIX_API_KEY        = "phoenix-api-key"
    PINECONE_API_KEY       = "pinecone-api-key"
    DECOLECTA_API_KEY      = "decolecta-api-key" # SUNAT (decolecta); antes texto plano en el servicio
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
  count    = var.gestionar_servicios ? 1 : 0
  name     = "agent-orchestrator-adk"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.agentes.email
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
    google_project_iam_member.cuentas,
  ]
}

# ── Agentes por perfil: servicios / obras / otros (mismo código, PIPELINE_PROFILE distinto) ──
# El spec vivo (imagen + variables operativas) lo aplica infrastructure/deploy/agentes.sh;
# Terraform solo garantiza forma, recursos y secretos. Misma imagen que `agent`.
resource "google_cloud_run_v2_service" "agente_perfil" {
  for_each = var.gestionar_servicios ? local.agent_profiles : {}

  name     = each.value
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  labels = { vigia-perfil = each.key }

  template {
    service_account                  = google_service_account.agentes.email
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
    google_project_iam_member.cuentas,
  ]
}

# ── API de lectura (Hono) ────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  count    = var.gestionar_servicios ? 1 : 0
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
          GCS_BUCKET_DOCUMENTOS = var.bucket_documentos
          GCS_BUCKET_REPORTES   = var.bucket_reportes
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
    google_project_iam_member.cuentas,
  ]
}

# ── Servidor MCP (read-only) ─────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "mcp" {
  count    = var.gestionar_servicios ? 1 : 0
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
    google_project_iam_member.cuentas,
  ]
}

# ── Frontend (Next.js) ───────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  count    = var.gestionar_servicios ? 1 : 0
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
          VIGIA_API_URL        = google_cloud_run_v2_service.api[0].uri
          VIGIA_AGENT_URL      = google_cloud_run_v2_service.agent[0].uri
          GOOGLE_CLOUD_PROJECT = var.project_id
          DOCS_BUCKET          = var.bucket_documentos
          REPORTES_BUCKET      = var.bucket_reportes
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

locals {
  # Los 4 servicios de agentes (cada corrida cuesta): IAM-only cuando var.agents_public = false.
  agent_services = var.gestionar_servicios ? merge(
    { agent = google_cloud_run_v2_service.agent[0].name },
    { for k, s in google_cloud_run_v2_service.agente_perfil : "agente_${k}" => s.name },
  ) : {}
}

# API, MCP y frontend son públicos por diseño. Los agentes, solo mientras var.agents_public = true.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = var.gestionar_servicios ? merge({
    api      = google_cloud_run_v2_service.api[0].name
    mcp      = google_cloud_run_v2_service.mcp[0].name
    frontend = google_cloud_run_v2_service.frontend[0].name
  }, { for k, v in local.agent_services : k => v if var.agents_public }) : {}
  name     = each.value
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Quién invoca a los agentes con ID token (var.invocadores_agentes: dispatcher y web de Cloudflare,
# frontend y API de la entrada).
resource "google_cloud_run_v2_service_iam_member" "agent_invoker" {
  for_each = { for par in setproduct(keys(local.agent_services), var.invocadores_agentes) : "${par[0]}:${par[1]}" => par }
  name     = local.agent_services[each.value[0]]
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${each.value[1]}"
}
