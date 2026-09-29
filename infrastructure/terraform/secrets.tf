# Terraform crea los contenedores; el VALOR se carga fuera (no queda en el state):
#   · al mudarse: python infrastructure/deploy/migracion/herramientas.py secretos --origen <viejo> --destino <nuevo> <nombres>
#   · a mano: printf '%s' "$VALOR" | gcloud secrets versions add <nombre> --data-file=-
# Excepción: cloudsql-password la genera Terraform cuando gestionar_password_sql = true.
# Un servicio que referencia un secreto sin versiones no arranca ("secret version not found").
locals {
  secret_ids = [
    "cloudsql-password-api", "cloudsql-password-api-admin", "cloudsql-password-mcp",
    "cloudsql-password-dispatcher", "cloudsql-password-jobs",
    "google-api-key", "phoenix-api-key", "pinecone-api-key", "arize-api-key", "decolecta-api-key",
    "local-downloader-token", "cloudflare-tunnel-token",
  ]
  # La VM de PgBouncer lee solo lo suyo (el resto de las cuentas tiene secretAccessor a nivel proyecto).
  secretos_pgbouncer = ["cloudsql-password-api", "cloudsql-password-api-admin", "cloudsql-password-mcp",
  "cloudsql-password-dispatcher", "cloudflare-tunnel-token"]
}

resource "google_secret_manager_secret" "external" {
  for_each  = toset(local.secret_ids)
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "cloudsql_password" {
  secret_id = "cloudsql-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "cloudsql_password" {
  count       = var.gestionar_password_sql ? 1 : 0
  secret      = google_secret_manager_secret.cloudsql_password.id
  secret_data = random_password.sql[0].result
}

resource "google_secret_manager_secret_iam_member" "pgbouncer" {
  for_each  = toset(local.secretos_pgbouncer)
  secret_id = google_secret_manager_secret.external[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.pgbouncer.email}"
}
