# IA de la plataforma que se puede declarar: el OCR y el respaldo del RAG legal.
# Gemini no se declara (se paga por uso en el proyecto de GOOGLE_CLOUD_PROJECT de los agentes) y los
# 4 corpus de RAG Engine se crean y cargan con backend/rag/corpus.py (fase `ia` del script).

# OCR de expedientes escaneados. Su id va en DOCAI_PROCESSOR_ID de los agentes (output docai_processor_id).
resource "google_document_ai_processor" "ocr" {
  location     = "us"
  display_name = "vigia-ocr"
  type         = "OCR_PROCESSOR"
  depends_on   = [google_project_service.apis]
}

# Vertex AI Search: respaldo del RAG legal (tools/legal.py, LEGAL_RAG_DATASTORE / LEGAL_RAG_ENGINE).
# Los documentos se copian con migracion/herramientas.py vertex-search.
resource "google_discovery_engine_data_store" "oece" {
  location          = "global"
  data_store_id     = "vigia-oece"
  display_name      = "vigia-oece"
  industry_vertical = "GENERIC"
  content_config    = "NO_CONTENT"
  solution_types    = ["SOLUTION_TYPE_SEARCH"]
  depends_on        = [google_project_service.apis]
}

resource "google_discovery_engine_search_engine" "oece" {
  engine_id         = "vigia-oece-search"
  collection_id     = "default_collection"
  location          = "global"
  display_name      = "vigia-oece-search"
  data_store_ids    = [google_discovery_engine_data_store.oece.data_store_id]
  industry_vertical = "GENERIC"
  search_engine_config {
    search_tier = "SEARCH_TIER_STANDARD"
  }
  lifecycle {
    # El motor creado por API (herramientas.py vertex-search) vuelve sin industry_vertical al importarlo:
    # sin esto, adoptarlo en Terraform lo borraría y recrearía.
    ignore_changes = [industry_vertical, search_engine_config[0].search_add_ons]
  }
}
