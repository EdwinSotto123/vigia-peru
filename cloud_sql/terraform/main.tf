# Una sola base, dos destinos posibles. `terraform apply -var proveedor=aws|gcp`.
# La contraseña se genera aquí, se guarda cifrada (SSM en AWS / Secret Manager en GCP) y NO se imprime.
resource "random_password" "db" {
  length  = 40
  special = false
}

module "aws" {
  count             = var.proveedor == "aws" ? 1 : 0
  source            = "./modules/aws_rds"
  nombre            = var.nombre
  db_nombre         = var.db_nombre
  db_usuario        = var.db_usuario
  password          = random_password.db.result
  clase             = var.aws_clase
  almacenamiento_gb = var.almacenamiento_gb
  cidrs_permitidos  = var.cidrs_permitidos
}

module "gcp" {
  count             = var.proveedor == "gcp" ? 1 : 0
  source            = "./modules/gcp_cloudsql"
  nombre            = var.nombre
  db_nombre         = var.db_nombre
  db_usuario        = var.db_usuario
  password          = random_password.db.result
  tier              = var.gcp_tier
  almacenamiento_gb = var.almacenamiento_gb
  cidrs_permitidos  = var.cidrs_permitidos
  region            = var.gcp_region
  proyecto          = var.gcp_project
}

# ── Proxy en la VPC (solo AWS): PgBouncer + túnel Cloudflare, sin puertos de entrada ──
module "proxy" {
  count    = var.proveedor == "aws" && var.con_proxy ? 1 : 0
  source   = "./modules/aws_proxy"
  nombre   = var.nombre
  rds_host = one(module.aws[*].host)
}

# RDS acepta al proxy por grupo de seguridad (no por IP).
resource "aws_security_group_rule" "rds_desde_proxy" {
  count                    = var.proveedor == "aws" && var.con_proxy ? 1 : 0
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = one(module.aws[*].sg_id)
  source_security_group_id = one(module.proxy[*].sg_id)
  description              = "proxy de la VPC (PgBouncer + tunel Cloudflare)"
}
