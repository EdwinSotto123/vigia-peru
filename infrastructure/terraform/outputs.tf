output "sql_connection_name" {
  description = "Para PGHOST=/cloudsql/<esto> (agentes, jobs) y el proxy de la VM de PgBouncer."
  value       = google_sql_database_instance.vigia.connection_name
}

output "sql_public_ip" {
  description = "Para el batch nocturno local (PGHOST) y restauraciones (backend/db/snapshot)."
  value       = google_sql_database_instance.vigia.public_ip_address
}

output "docai_processor_id" {
  description = "DOCAI_PROCESSOR_ID de los agentes."
  value       = reverse(split("/", google_document_ai_processor.ocr.name))[0]
}

output "rag_bucket" {
  description = "RAG_BUCKET de los agentes y de backend/rag."
  value       = google_storage_bucket.rag.name
}

output "cuentas" {
  value = {
    agentes   = google_service_account.agentes.email
    jobs      = google_service_account.jobs.email
    pgbouncer = google_service_account.pgbouncer.email
  }
}

output "agent_host_suffix" {
  description = "AGENT_HOST_SUFFIX de la API y sufijo de las URLs de los agentes: <servicio>-<esto>."
  value       = "${var.project_number}.${var.region}.run.app"
}

output "servicios" {
  description = "URLs de los servicios, solo con gestionar_servicios = true."
  value = var.gestionar_servicios ? {
    agent    = google_cloud_run_v2_service.agent[0].uri
    api      = google_cloud_run_v2_service.api[0].uri
    mcp      = "${google_cloud_run_v2_service.mcp[0].uri}/mcp"
    frontend = google_cloud_run_v2_service.frontend[0].uri
    agentes  = { for k, s in google_cloud_run_v2_service.agente_perfil : k => s.uri }
  } : null
}
