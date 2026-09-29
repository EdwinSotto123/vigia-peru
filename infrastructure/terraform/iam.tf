# Cuentas propias por componente (nada con la cuenta de Compute con `editor`) y los agentes de servicio
# de Google que un proyecto nuevo no trae. Lo mismo que hace migracion/migrar-proyecto.sh identidades.

# ── Agentes de servicio de Google ───────────────────────────────────────────────────────────────
# Sin ellos, RAG Engine serverless falla con "vectorsearch.collections.create denied".
# El de RAG Engine (service-N@gcp-sa-vertex-rag) lo crea Google la primera vez que se usa RAG Engine
# (python -m backend.rag.corpus config): su rol lo da la fase `ia` del script, no Terraform.
locals {
  agentes_de_servicio = {
    "aiplatform.googleapis.com"      = { cuenta = "gcp-sa-aiplatform", rol = "roles/aiplatform.serviceAgent" }
    "vectorsearch.googleapis.com"    = { cuenta = "gcp-sa-vectorsearch", rol = "roles/vectorsearch.serviceAgent" }
    "discoveryengine.googleapis.com" = { cuenta = "gcp-sa-discoveryengine", rol = "roles/discoveryengine.serviceAgent" }
  }
}

resource "google_project_service_identity" "agentes" {
  provider   = google-beta
  for_each   = local.agentes_de_servicio
  service    = each.key
  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "agentes_de_servicio" {
  for_each   = local.agentes_de_servicio
  project    = var.project_id
  role       = each.value.rol
  member     = "serviceAccount:service-${var.project_number}@${each.value.cuenta}.iam.gserviceaccount.com"
  depends_on = [google_project_service_identity.agentes]
}

# ── Cuentas de Vigía ────────────────────────────────────────────────────────────────────────────
resource "google_service_account" "agentes" {
  account_id   = "vigia-agentes"
  display_name = "Vigía agentes"
}

resource "google_service_account" "jobs" {
  account_id   = "vigia-jobs"
  display_name = "Vigía: scrapers e ingesta"
}

resource "google_service_account" "pgbouncer" {
  account_id   = "vigia-pgbouncer"
  display_name = "Vigía: PgBouncer"
}

locals {
  roles_por_cuenta = {
    agentes = {
      email = google_service_account.agentes.email
      roles = ["roles/aiplatform.user", "roles/cloudsql.client", "roles/documentai.apiUser", "roles/discoveryengine.user",
        "roles/secretmanager.secretAccessor", "roles/logging.logWriter", "roles/cloudtrace.agent",
      "roles/monitoring.metricWriter", "roles/storage.objectViewer"]
    }
    jobs = {
      email = google_service_account.jobs.email
      # run.invoker: los Cloud Scheduler de los scrapers disparan el Job con esta cuenta.
      roles = ["roles/cloudsql.client", "roles/secretmanager.secretAccessor", "roles/logging.logWriter", "roles/run.invoker"]
    }
    pgbouncer = {
      email = google_service_account.pgbouncer.email
      roles = ["roles/cloudsql.client", "roles/logging.logWriter"]
    }
    # Cloud Build (cuenta de Compute): en organizaciones nuevas no tiene roles por defecto.
    build = {
      email = local.runtime_sa
      roles = ["roles/cloudbuild.builds.builder", "roles/run.admin", "roles/cloudscheduler.admin"]
    }
  }
  bindings = merge([for k, c in local.roles_por_cuenta : { for r in c.roles : "${k}:${r}" => { email = c.email, rol = r } }]...)
}

resource "google_project_iam_member" "cuentas" {
  for_each = local.bindings
  project  = var.project_id
  role     = each.value.rol
  member   = "serviceAccount:${each.value.email}"
}

# Cloud Build crea los Jobs y Schedulers de los scrapers a nombre de vigia-jobs.
resource "google_service_account_iam_member" "build_usa_jobs" {
  service_account_id = google_service_account.jobs.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.runtime_sa}"
}
