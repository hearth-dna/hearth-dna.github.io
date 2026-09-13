# Secret Manager — credentials Terraform reads but never owns. Created out of band with
# `gcloud secrets create` (README.md); Terraform holds data sources only, so no secret material
# lands in state or tfvars. `trimspace()` on every read is load-bearing: `echo | gcloud secrets
# versions add` stores a trailing newline.

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Set by the Cloudflare Worker on every api.<domain> request and checked by the Go middleware.
# Metadata data source only: Cloud Run resolves the value through secret_key_ref.
data "google_secret_manager_secret" "edge_shared_secret" {
  secret_id = "edge-shared-secret"
  project   = var.project_id

  depends_on = [google_project_service.secretmanager]
}

# Operator LLM key for /v1/ask. May be an empty version: the endpoint then accepts BYOK only.
data "google_secret_manager_secret" "llm_api_key" {
  secret_id = "llm-api-key"
  project   = var.project_id

  depends_on = [google_project_service.secretmanager]
}

# Provider credentials need their value at plan time, so these land in state — keep the state
# bucket private and versioned.
data "google_secret_manager_secret_version" "cloudflare_api_token" {
  count = var.enable_cloudflare ? 1 : 0

  secret  = "cloudflare-api-token"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "mailgun_api_key" {
  count = var.enable_email ? 1 : 0

  secret  = "mailgun-api-key"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

# The Worker needs the edge secret's value to send it; read as a version, gated on Cloudflare.
data "google_secret_manager_secret_version" "edge_shared_secret" {
  count = var.enable_cloudflare ? 1 : 0

  secret  = "edge-shared-secret"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

locals {
  cloudflare_api_token = var.enable_cloudflare ? trimspace(data.google_secret_manager_secret_version.cloudflare_api_token[0].secret_data) : ""
  mailgun_api_key      = var.enable_email ? trimspace(data.google_secret_manager_secret_version.mailgun_api_key[0].secret_data) : ""
  edge_shared_secret   = var.enable_cloudflare ? trimspace(data.google_secret_manager_secret_version.edge_shared_secret[0].secret_data) : ""
}

resource "google_secret_manager_secret_iam_member" "backend_edge_shared_secret" {
  project   = var.project_id
  secret_id = "edge-shared-secret"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_secret_manager_secret_iam_member" "backend_llm_api_key" {
  project   = var.project_id
  secret_id = "llm-api-key"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}
