# APIs necesarias. Habilitarlas acá evita el clásico "API not enabled" en el primer deploy.
locals {
  services = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "aiplatform.googleapis.com",      # Vertex AI (Gemini, embeddings)
    "documentai.googleapis.com",      # OCR de expedientes
    "discoveryengine.googleapis.com", # Vertex AI Search (RAG legal)
    "cloudfunctions.googleapis.com",
    "iam.googleapis.com",
  ]

  # Service account por defecto de Compute: es la identidad que hoy usan los 4 servicios.
  runtime_sa = "${var.project_number}-compute@developer.gserviceaccount.com"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}
