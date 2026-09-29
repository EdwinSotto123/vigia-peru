# APIs necesarias. Habilitarlas acá evita el clásico "API not enabled" en el primer deploy.
locals {
  services = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com", # VM de PgBouncer + túnel de Cloudflare
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudscheduler.googleapis.com",  # scrapers
    "aiplatform.googleapis.com",      # Vertex AI (Gemini, embeddings, RAG Engine)
    "vectorsearch.googleapis.com",    # RAG Engine serverless
    "documentai.googleapis.com",      # OCR de expedientes
    "discoveryengine.googleapis.com", # Vertex AI Search (respaldo del RAG legal)
  ]

  # Cuenta por defecto de Compute: la usa Cloud Build (y los servicios declarados con gestionar_servicios
  # que no tienen cuenta propia).
  runtime_sa = "${var.project_number}-compute@developer.gserviceaccount.com"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# Imágenes de agentes, scrapers e ingesta.
resource "google_artifact_registry_repository" "run" {
  repository_id = "cloud-run-source-deploy"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}
