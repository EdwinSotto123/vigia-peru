# Roles de la service account de runtime. Hoy los 4 servicios comparten la SA por
# defecto de Compute; el siguiente paso de hardening es una SA por servicio.
locals {
  runtime_roles = [
    "roles/cloudsql.client",
    "roles/aiplatform.user",
    "roles/documentai.apiUser",
    "roles/discoveryengine.viewer",
    "roles/storage.objectAdmin",
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
  ]
}

resource "google_project_iam_member" "runtime" {
  for_each = toset(local.runtime_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${local.runtime_sa}"
}

# Service account del relay residencial (VPS Lima): solo escribe PDFs en el bucket de documentos.
resource "google_service_account" "relay" {
  account_id   = "vigia-relay"
  display_name = "Vigía relay (VPS Lima) — sube documentos a GCS"
}

resource "google_storage_bucket_iam_member" "relay_writer" {
  bucket = google_storage_bucket.documentos.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.relay.email}"
}
