# Los 4 secretos que consumen los servicios vía --set-secrets. Terraform crea el
# contenedor; el VALOR se carga fuera de Terraform (no queda en el state):
#   printf '%s' "$VALUE" | gcloud secrets versions add google-api-key --data-file=-
# Excepción: cloudsql-password sí se genera y carga acá porque Terraform crea el usuario.
locals {
  secret_ids = ["google-api-key", "phoenix-api-key", "pinecone-api-key"]
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
  secret      = google_secret_manager_secret.cloudsql_password.id
  secret_data = random_password.sql.result
}

# El accessor se otorga POR SECRETO (no a nivel proyecto). Si agregás un secreto
# nuevo y olvidás este binding, el servicio no arranca.
resource "google_secret_manager_secret_iam_member" "runtime_external" {
  for_each  = google_secret_manager_secret.external
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa}"
}

resource "google_secret_manager_secret_iam_member" "runtime_sql" {
  secret_id = google_secret_manager_secret.cloudsql_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa}"
}
