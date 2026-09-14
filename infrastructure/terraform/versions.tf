terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
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
}
