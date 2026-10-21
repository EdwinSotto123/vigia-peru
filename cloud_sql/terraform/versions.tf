terraform {
  required_version = ">= 1.10"

  # Estado en S3 (privado, cifrado, versionado, sólo TLS), desde el 2026-10-21: antes era un archivo en una sola laptop
  # con la clave maestra de RDS adentro. use_lockfile: bloqueo nativo de S3 (Terraform >= 1.10), sin DynamoDB.
  backend "s3" {
    bucket       = "vigia-terraform-estado-416689419419"
    key          = "vigia/aws.tfstate"
    region       = "us-east-2"
    profile      = "founder.edwin"
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

# Ambos proveedores se declaran siempre; solo se usa el del módulo elegido en `proveedor`.
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}
