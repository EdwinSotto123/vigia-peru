resource "google_storage_bucket" "documentos" {
  name                        = var.bucket_documentos
  location                    = var.region
  uniform_bucket_level_access = true

  lifecycle_rule {
    condition { age = 180 }
    action { type = "Delete" } # los PDFs se re-descargan del OECE si hacen falta
  }
}

resource "google_storage_bucket" "reportes" {
  name                        = var.bucket_reportes
  location                    = var.region
  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "rag" {
  name                        = var.bucket_rag
  location                    = var.region
  uniform_bucket_level_access = true
}
