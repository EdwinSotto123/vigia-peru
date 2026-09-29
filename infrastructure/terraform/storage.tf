# Buckets de la plataforma. Los nombres llevan el número de proyecto para no chocar con los de otro
# proyecto (los nombres de bucket son globales).

# RAG normativo: fuentes + catalogo.json + corpus.json (backend/rag). El agente de RAG Engine necesita
# escribir en _import/ (lo da la fase `ia` de migracion/migrar-proyecto.sh).
resource "google_storage_bucket" "rag" {
  name                        = "vigia-rag-${var.project_number}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# Exportaciones de Cloud SQL (snapshots y mudanzas). Contienen datos personales: nunca públicos.
resource "google_storage_bucket" "migracion" {
  name                        = "vigia-migracion-${var.project_number}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# Documentos y reportes: hoy viven en el proyecto viejo (BUCKETS_PROJECT_ID) y la base guarda sus URLs.
resource "google_storage_bucket" "documentos" {
  count                       = var.crear_buckets_documentos ? 1 : 0
  name                        = var.bucket_documentos
  location                    = var.region
  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "reportes" {
  count                       = var.crear_buckets_documentos ? 1 : 0
  name                        = var.bucket_reportes
  location                    = var.region
  uniform_bucket_level_access = true
}
