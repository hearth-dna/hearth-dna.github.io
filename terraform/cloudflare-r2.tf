# R2 bucket for the public knowledge base (kb.json / kb-<version>.db).
#
# Free tier: 10 GB stored, 10M class B reads per month, zero egress fees, no region restriction —
# which is why the kb lives here rather than in the GCS bucket the design first considered
# (docs/design.md §11.2). Contents are public data (no genotypes); `make kb-publish` uploads.
# A custom domain on the bucket is configured in the dashboard (the v4 provider has no resource
# for R2 custom domains); kb.<domain> below is the CNAME that domain expects.

resource "cloudflare_r2_bucket" "kb" {
  count = var.enable_cloudflare ? 1 : 0

  account_id = var.cloudflare_account_id
  name       = "hearth-kb"
  location   = "WEUR"
}
