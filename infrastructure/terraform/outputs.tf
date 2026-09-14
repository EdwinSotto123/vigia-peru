output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "agent_url" {
  value = google_cloud_run_v2_service.agent.uri
}

output "mcp_url" {
  value = "${google_cloud_run_v2_service.mcp.uri}/mcp"
}

output "sql_connection_name" {
  value = google_sql_database_instance.vigia.connection_name
}

output "sql_public_ip" {
  value = google_sql_database_instance.vigia.public_ip_address
}

output "relay_service_account" {
  value = google_service_account.relay.email
}
