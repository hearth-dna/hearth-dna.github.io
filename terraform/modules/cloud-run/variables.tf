# Variables for Cloud Run Module

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "service_name" {
  description = "Name of the Cloud Run service"
  type        = string
}

variable "image" {
  description = "Docker image to deploy"
  type        = string
}

variable "service_account_email" {
  description = <<-EOT
    Runtime service account for the service. Created by the caller rather than by this module so
    that the role grants it needs — Secret Manager accessor for EDGE_SHARED_SECRET and LLM_API_KEY — can be applied *before* the service is created. Cloud Run validates
    secret access when a revision starts, so a service created in the same apply as its own IAM
    grants is a coin flip on ordering.
  EOT
  type        = string
}

variable "env_vars" {
  description = "Environment variables for the service"
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = "Secret Manager environment variables for the service. Map of env name to {secret, version}."
  type = map(object({
    secret  = string
    version = string
  }))
  default = {}
}

variable "memory" {
  description = <<-EOT
    Container memory limit. Sized against the *database*, not the process: Cloud Run's writable
    filesystem is memory-backed, so the SQLite file at DB_PATH, its WAL, and SQLite's page cache all
    count against this limit alongside the Go heap. Practical headroom is roughly a third of this
    value in database bytes. See docs/decisions/0047-cloudflare-edge-and-gcp-free-tier.md for the
    sizing math and the migration trigger.
  EOT
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum number of instances (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances. 1 caps free-tier consumption; the helper is stateless."
  type        = number
  default     = 1
}

variable "environment" {
  description = "Environment name (production, staging, etc.)"
  type        = string
  default     = "production"
}
