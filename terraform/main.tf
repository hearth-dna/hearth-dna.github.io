# Hearth production Terraform configuration
# Ported from ../sentio/terraform/ (docs/design.md §12). Differences: no Litestream replica
# bucket (the helper backend is stateless), no OAuth client IDs, an R2 bucket for the public
# knowledge base, and an edge shared secret so the raw *.run.app origin cannot drain the free
# LLM/OCR quotas.
#
# Infrastructure:
#   - Cloud Run helper backend (free tier: 2M requests/month, scale-to-zero, stateless)
#   - Artifact Registry (Docker image storage)
#   - Secret Manager reads: llm-api-key, edge-shared-secret, cloudflare-api-token
#   - Cloudflare (gated on enable_cloudflare): DNS, Worker Host rewrite, rate limit, two Pages
#     projects, R2 bucket for kb.db
#
# Total estimated monthly cost: $0-1/month at low traffic (within free tier) plus the domain.

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    # v4 deliberately, matching ../sentio. v5 renamed nearly every resource used here.
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    mailgun = {
      source  = "wgebis/mailgun"
      version = "~> 0.7"
    }
  }

  backend "gcs" {
    bucket = "hearth-production-terraform-state"
    prefix = "production"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  api_host = var.enable_cloudflare ? "api.${var.domain}" : ""
  app_host = var.enable_cloudflare ? "app.${var.domain}" : ""
  kb_host  = var.enable_cloudflare ? "kb.${var.domain}" : ""

  web_origin = var.web_origin != "" ? var.web_origin : (var.enable_cloudflare ? "https://app.${var.domain}" : "")

  # The Cloud Run service's own *.run.app hostname, what the Worker rewrites Host to.
  backend_host = replace(module.backend.service_url, "https://", "")
}

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifact_registry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "hearth_registry" {
  repository_id = "hearth-registry"
  location      = var.region
  format        = "DOCKER"
  description   = "Hearth helper backend container images"

  # Always-free Artifact Registry is 0.5 GB; keep 3 versions for rollback by digest.
  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old-versions"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.artifact_registry]
}

# Runtime identity, declared at the root so the Secret Manager grants in secrets.tf apply before
# the service is created (Cloud Run validates secret access when a revision starts).
resource "google_service_account" "backend" {
  account_id   = "hearth-backend-sa"
  display_name = "Service Account for hearth-backend"
  description  = "Runtime identity for the stateless Cloud Run helper"

  depends_on = [google_project_service.iam]
}

module "backend" {
  source = "./modules/cloud-run"

  project_id            = var.project_id
  region                = var.region
  service_name          = "hearth-backend"
  environment           = var.environment
  service_account_email = google_service_account.backend.email

  image = "${var.region}-docker.pkg.dev/${var.project_id}/hearth-registry/backend:${var.image_tag}"

  # max 1 is a quota guard, not a correctness requirement: the service is stateless.
  min_instances = 0
  max_instances = 1
  memory        = "512Mi"

  secret_env_vars = {
    # Both are read by Cloud Run itself; Terraform only confirms they exist (secrets.tf).
    EDGE_SHARED_SECRET = {
      secret  = "edge-shared-secret"
      version = "latest"
    }
    LLM_API_KEY = {
      secret  = "llm-api-key"
      version = "latest"
    }
  }

  env_vars = {
    ENVIRONMENT = var.environment
    WEB_ORIGINS = local.web_origin
  }

  depends_on = [
    google_project_service.run,
    google_artifact_registry_repository.hearth_registry,
    google_secret_manager_secret_iam_member.backend_edge_shared_secret,
    google_secret_manager_secret_iam_member.backend_llm_api_key,
  ]
}
