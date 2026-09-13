# Terraform Variables for Hearth GCP + Cloudflare infrastructure

variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "hearth-production"
}

variable "region" {
  description = "GCP region. europe-west1 keeps the only personal-data-touching component in the EEA (docs/design.md §11.5); verify the Cloud Run free allowance applies there at setup time."
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name — used for resource labels"
  type        = string
  default     = "production"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

# ---------------------------------------------------------------------------------------------
# Cloudflare edge (see ../docs/design.md §12.4)
# ---------------------------------------------------------------------------------------------

variable "enable_cloudflare" {
  description = "Manage the Cloudflare edge (DNS, Worker, rate limit, Pages, R2). Defaults to false so the GCP half can be applied before a domain exists."
  type        = bool
  default     = false
}

variable "domain" {
  description = "Apex domain served by Cloudflare. The zone must already exist. app.<domain> = PWA, api.<domain> = helper backend, kb.<domain> = knowledge base on R2, apex = landing."
  type        = string
  default     = ""
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the zone, the Pages projects and the R2 bucket."
  type        = string
  default     = ""
}

variable "web_origin" {
  description = "Exact origin of the deployed PWA for the backend's CORS allow-list. Leave empty to derive https://app.<domain>."
  type        = string
  default     = ""
}

variable "gsc_verification_txt" {
  description = "Google Search Console DNS verification token (the part after google-site-verification=). Empty publishes no record."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------------------------
# contact@<domain> (email.tf) — optional, on top of enable_cloudflare
# ---------------------------------------------------------------------------------------------

variable "enable_email" {
  description = "Manage contact@<domain>: Cloudflare Email Routing plus a Mailgun sending subdomain. Needs a mailgun-api-key secret."
  type        = bool
  default     = false
}

variable "forwarding_email" {
  description = "Mailbox that contact@<domain> forwards to. Cloudflare mails it a verification link on first apply."
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------------------------
# Cost guardrails and alerting
# ---------------------------------------------------------------------------------------------

variable "billing_account_id" {
  description = "Billing account ID the budget alert is attached to. Empty skips the budget."
  type        = string
  default     = ""
}

variable "budget_amount_usd" {
  description = "Monthly budget tripwire in USD (alerts at 50/90/100%). The deployment is designed for ~$0-1/month."
  type        = number
  default     = 2
}

variable "alert_email" {
  description = "Receives budget and Cloud Run alerts. Empty skips the notification channel and every policy."
  type        = string
  default     = ""
}
