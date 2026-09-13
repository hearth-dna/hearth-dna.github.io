output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "backend_url" {
  description = "Cloud Run helper URL (raw origin; the edge secret guards it)"
  value       = module.backend.service_url
}

output "backend_service_account_email" {
  value = module.backend.service_account_email
}

output "artifact_registry_repository" {
  description = "Artifact Registry path for pushing backend images (append :<tag>)"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.hearth_registry.repository_id}/backend"
}

output "api_url" {
  description = "Public API origin behind Cloudflare. What the frontend's CSP connect-src and VITE_HEARTH_API_URL must use."
  value       = var.enable_cloudflare ? "https://${local.api_host}" : module.backend.service_url
}

output "app_url" {
  value = var.enable_cloudflare ? "https://${local.app_host}" : ""
}

output "kb_url" {
  description = "Public knowledge-base origin (R2 behind Cloudflare). Empty until enable_cloudflare is true."
  value       = var.enable_cloudflare ? "https://${local.kb_host}" : ""
}

output "landing_url" {
  value = var.enable_cloudflare ? "https://${var.domain}" : ""
}

output "secrets_wired" {
  value = {
    edge_shared_secret = data.google_secret_manager_secret.edge_shared_secret.secret_id
    llm_api_key        = data.google_secret_manager_secret.llm_api_key.secret_id
    cloudflare_api_token = (
      var.enable_cloudflare
      ? (local.cloudflare_api_token != "" ? "secret-manager" : "MISSING")
      : "not-required (enable_cloudflare = false)"
    )
  }
}
