terraform {
  required_version = ">= 1.5"
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
