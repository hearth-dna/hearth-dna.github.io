# Outputs for Cloud Run Module

output "service_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.service.uri
}

output "service_name" {
  description = "Name of the Cloud Run service"
  value       = google_cloud_run_v2_service.service.name
}

output "service_account_email" {
  description = "Service account email for the Cloud Run service (passed in; see variables.tf)"
  value       = var.service_account_email
}
