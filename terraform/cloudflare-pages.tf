# Cloudflare Pages — hosting for the read-only web export viewer (frontend/).
#
# Free, with unlimited bandwidth, and it serves index.html for unmatched routes by default, which
# is exactly the SPA history-API fallback frontend/AGENTS.md flags as a deploy-time TODO. The
# alternative — a public GCS bucket behind the edge, as ../cot does — costs egress and needs the
# fallback wired by hand.
#
# Direct-upload project, not a git integration: uploads stay a deliberate `make frontend-deploy`
# step rather than firing on every push to main. Terraform owns the project and the custom
# domain; it does not own the contents.

resource "cloudflare_pages_project" "frontend" {
  count = var.enable_cloudflare ? 1 : 0

  account_id        = var.cloudflare_account_id
  name              = "hearth-frontend"
  production_branch = "main"
}

resource "cloudflare_pages_domain" "frontend" {
  count = var.enable_cloudflare ? 1 : 0

  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.frontend[0].name
  domain       = local.app_host

  # The CNAME has to exist before Cloudflare will validate the custom domain.
  depends_on = [cloudflare_record.app]
}

# The marketing landing on the apex (landing/ — static HTML plus the blog, deployed with
# `make landing-deploy`). Same shape as the frontend project above.
resource "cloudflare_pages_project" "landing" {
  count = var.enable_cloudflare ? 1 : 0

  account_id        = var.cloudflare_account_id
  name              = "hearth-landing"
  production_branch = "main"
}

resource "cloudflare_pages_domain" "landing" {
  count = var.enable_cloudflare ? 1 : 0

  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.landing[0].name
  domain       = var.domain

  depends_on = [cloudflare_record.root]
}

resource "cloudflare_pages_domain" "landing_www" {
  count = var.enable_cloudflare ? 1 : 0

  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.landing[0].name
  domain       = "www.${var.domain}"

  depends_on = [cloudflare_record.www]
}
