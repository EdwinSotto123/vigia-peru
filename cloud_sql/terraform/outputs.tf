output "proveedor" { value = var.proveedor }

output "host" {
  value = var.proveedor == "aws" ? one(module.aws[*].host) : one(module.gcp[*].host)
}

output "puerto" { value = 5432 }

output "ubicacion_contrasena" {
  description = "Dónde leer la contraseña (no se imprime)."
  value       = var.proveedor == "aws" ? one(module.aws[*].ssm_parametro) : one(module.gcp[*].secreto)
}
