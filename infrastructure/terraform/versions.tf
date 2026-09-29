terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = { # google_project_service_identity (agentes de servicio de Vertex)
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Estado remoto. Crear el bucket una sola vez:
  #   gcloud storage buckets create gs://<PROJECT_ID>-tfstate --location=us-central1 --uniform-bucket-level-access
  # y luego: terraform init -backend-config="bucket=<PROJECT_ID>-tfstate"
  backend "gcs" {
    prefix = "vigia-peru"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Vertex AI Search (Discovery Engine) exige proyecto de cuota con credenciales de usuario (ADC).
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
  # Vertex AI Search (Discovery Engine) exige proyecto de cuota con credenciales de usuario (ADC).
  user_project_override = true
  billing_project       = var.project_id
}
