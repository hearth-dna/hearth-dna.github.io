# Cloudflare edge — TLS, CDN, WAF and rate limiting in front of Cloud Run.
#
# Everything here is on the free plan. It replaces the GCP pieces that would otherwise be needed
# to put a service behind a custom domain: a global load balancer (~$18/month) and a managed
# certificate. See docs/decisions/0047-cloudflare-edge-and-gcp-free-tier.md.
#
# Every resource is gated on var.enable_cloudflare so the GCP half can be applied first, before a
# domain exists.
#
# Like ../cot/terraform/, a Worker (cloudflare-worker-api.js, in this directory) rewrites the
# Host header for Cloud Run. An Origin Rule was tried first — declarative, no JavaScript — but
# its Host-header override turned out to be an Enterprise entitlement, so the Worker stays.

provider "cloudflare" {
  # Authenticated from Secret Manager rather than a CLOUDFLARE_API_TOKEN in the environment, so
  # GCP Application Default Credentials remain the only ambient credential this config needs.
  #
  # The placeholder is not decoration. Terraform configures a provider whenever its blocks appear
  # in the config, even when every resource using it is count = 0, and this provider rejects an
  # empty token at configure time with "must provide exactly one of api_key, api_token or
  # api_user_service_key" — which would fail `terraform plan` outright when enable_cloudflare is
  # false, defeating the whole point of the flag. A syntactically valid token that is never used
  # (no Cloudflare resource exists to call the API with it) keeps the GCP-only path working.
  api_token = local.cloudflare_api_token != "" ? local.cloudflare_api_token : "0000000000000000000000000000000000000000"
}

# The zone is created when the domain is registered (Cloudflare Registrar does this
# automatically) — Terraform reads it rather than owning it.
data "cloudflare_zone" "domain" {
  count = var.enable_cloudflare ? 1 : 0
  name  = var.domain
}

# ---------------------------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------------------------

# api.<domain> -> Cloud Run. Proxied, so Cloudflare terminates TLS and the WAF and rate limiter
# below actually see the traffic. Grey-clouding this record would silently disable both.
resource "cloudflare_record" "api" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "api"
  content = local.backend_host
  type    = "CNAME"
  proxied = true
  ttl     = 1 # must be 1 ("auto") while proxied
  comment = "Backend API - Cloud Run (Host rewritten by the api-proxy Worker below)"
}

# app.<domain> -> Cloudflare Pages (see cloudflare-pages.tf).
resource "cloudflare_record" "app" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "app"
  content = cloudflare_pages_project.frontend[0].subdomain
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Web export viewer - Cloudflare Pages"
}

# Apex -> the landing Pages project. Cloudflare flattens apex CNAMEs automatically.
resource "cloudflare_record" "root" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "@"
  content = cloudflare_pages_project.landing[0].subdomain
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Marketing landing + blog - Cloudflare Pages"
}

# www serves the same landing project (Pages accepts multiple custom domains), so no redirect
# rule is spent on it.
resource "cloudflare_record" "www" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "www"
  content = cloudflare_pages_project.landing[0].subdomain
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "www alias for the landing - Cloudflare Pages"
}

# kb.<domain> -> the R2 bucket's custom domain (cloudflare-r2.tf). Public knowledge-base files
# only; the custom domain itself is attached in the dashboard (no v4 provider resource).
resource "cloudflare_record" "kb" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "kb"
  content = "public.r2.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Knowledge base - R2 bucket hearth-kb (custom domain attached in the dashboard)"
}

# Google Search Console verification for the sc-domain property (scripts/seo-setup.sh).
#
# A domain property is verified by DNS only, and stays verified only while the record stays
# published — Google re-checks periodically and silently drops the property when it disappears,
# taking the API access with it. Which is the argument for it being here rather than hand-added:
# a record that must never be deleted should be one `terraform plan` would notice was gone.
resource "cloudflare_record" "gsc_verification" {
  count = var.enable_cloudflare && var.gsc_verification_txt != "" ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "@"
  content = "google-site-verification=${var.gsc_verification_txt}"
  type    = "TXT"
  ttl     = 3600
  comment = "Google Search Console domain-property verification"
}

# ---------------------------------------------------------------------------------------------
# API proxy Worker — the piece that makes the proxied CNAME actually work
# ---------------------------------------------------------------------------------------------

# Cloud Run routes requests by Host header. A proxied CNAME forwards the original Host
# (api.<domain>), which Cloud Run has never heard of, so it answers 404 for every path — a
# failure that looks like a broken deployment rather than a misrouted header.
#
# An earlier version used an Origin Rule with a Host-header override here — declarative, no
# JavaScript — but that override is an Enterprise entitlement (the free plan rejects it with
# "not entitled to use the HostHeader override"), discovered on the first real apply. So this
# is a Worker after all, the same approach as ../cot/cloudflare-worker-api.js. Free-tier
# Workers allow 100k requests/day, far above this backend's rate limit ceiling.
resource "cloudflare_workers_script" "api_proxy" {
  count = var.enable_cloudflare ? 1 : 0

  account_id = var.cloudflare_account_id
  name       = "hearth-api-proxy"
  content    = file("${path.module}/cloudflare-worker-api.js")

  plain_text_binding {
    name = "BACKEND_ORIGIN"
    text = module.backend.service_url
  }

  # The shared secret the Go middleware requires on every helper request (docs/design.md
  # §12.4). Anyone hitting the raw *.run.app origin without it gets 403, which is what keeps the
  # free LLM/OCR quotas behind the rate limiter below.
  secret_text_binding {
    name = "EDGE_SHARED_SECRET"
    text = local.edge_shared_secret
  }
}

resource "cloudflare_workers_route" "api" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id     = data.cloudflare_zone.domain[0].id
  pattern     = "${local.api_host}/*"
  script_name = cloudflare_workers_script.api_proxy[0].name
}

# ---------------------------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------------------------

# The backend runs at max_instances = 1 (SQLite has one writer, ADR 0005), so there is no
# horizontal escape valve: a single script can saturate the service and burn through the 2M
# request/month Cloud Run free tier. This is the cheapest thing standing between that and the
# billing account. The free plan allows one rate-limiting rule; it is spent here.
#
# The 429 body is shaped like a GraphQL error response so clients parse it with the same path
# they already use for every other failure, instead of choking on an HTML error page.
resource "cloudflare_ruleset" "api_rate_limit" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "hearth-api-rate-limit"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    action      = "block"
    description = "Rate limit the API per client IP"
    expression  = "(http.host eq \"${local.api_host}\")"
    enabled     = true

    action_parameters {
      response {
        status_code  = 429
        content_type = "application/json"
        content      = "{\"error\":\"rate limited — slow down and retry\"}"
      }
    }

    ratelimit {
      # Counted per edge colo rather than globally — the free-plan behaviour, and the reason the
      # effective limit is higher than the number below for a geographically spread attacker.
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 300
      mitigation_timeout  = 10
    }
  }
}

# ---------------------------------------------------------------------------------------------
# Zone settings
# ---------------------------------------------------------------------------------------------

resource "cloudflare_zone_settings_override" "domain" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = data.cloudflare_zone.domain[0].id

  settings {
    # "full" not "strict": Cloud Run serves a valid certificate for its own *.run.app name, but
    # the edge connects with the rewritten Host, so strict verification against api.<domain>
    # would fail.
    ssl                      = "full"
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    brotli                   = "on"
    security_level           = "medium"
    browser_check            = "on"

    # Static frontend assets only — the API sends its own Cache-Control and Cloudflare does not
    # cache non-GET or authenticated responses by default.
    browser_cache_ttl = 14400
  }
}
