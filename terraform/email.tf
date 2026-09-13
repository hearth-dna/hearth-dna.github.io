# contact@<domain> — receiving and sending, in two different services because no single free one
# does both.
#
#   Receiving  Cloudflare Email Routing forwards contact@<domain> (and, via the catch-all, anything
#              else at the domain) to var.forwarding_email. Free, and it reuses the zone the edge
#              already lives in.
#   Sending    A Mailgun sending subdomain, mg.<domain>, with its own SPF and DKIM. Nothing in
#              the product sends mail — this exists so Gmail's "Send mail as" can *reply* from
#              contact@<domain> over Mailgun SMTP, which Cloudflare Email Routing cannot do.
#
# Ported from ../cot/terraform/{email-routing,mailgun}.tf, with two corrections that project's
# files earned the hard way: one combined SPF record rather than two competing ones, and a DMARC
# record it still lacks.
#
# Three steps here are irreducibly manual — Cloudflare's destination-address verification link,
# the Mailgun SMTP credential, and the Gmail alias. docs/runbook/email-setup.md is the order.

locals {
  # enable_email rides on top of enable_cloudflare: everything below either lives in the zone or
  # writes DNS records into it.
  email_enabled = var.enable_cloudflare && var.enable_email ? 1 : 0
}

provider "mailgun" {
  # From Secret Manager, like the Cloudflare token (secrets.tf), so GCP Application Default
  # Credentials remain the only ambient credential this config needs.
  #
  # The placeholder is the same defensive trick as cloudflare.tf's, for the same reason:
  # Terraform configures a provider whenever its blocks appear in the config, even when every
  # resource using it is count = 0. An empty api_key here fails at configure time and would break
  # `terraform plan` for everyone running with enable_email = false.
  api_key = local.mailgun_api_key != "" ? local.mailgun_api_key : "placeholder-not-used"
}

# ---------------------------------------------------------------------------------------------
# Receiving — Cloudflare Email Routing
# ---------------------------------------------------------------------------------------------

# Enabling this is what provisions the apex MX records (route1/2/3.mx.cloudflare.net). They are
# deliberately *not* resources here: Cloudflare creates and owns them, and declaring them would
# fight the API for control of records Terraform didn't make. Expect them to appear in the zone
# after the first apply without ever showing up in a plan.
resource "cloudflare_email_routing_settings" "default" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  enabled = true
}

# The destination mailbox. Cloudflare emails it a verification link on creation and forwards
# nothing until that link is clicked — an apply that "succeeds" is only half the story.
resource "cloudflare_email_routing_address" "forwarding" {
  count = local.email_enabled

  account_id = var.cloudflare_account_id
  email      = var.forwarding_email
}

resource "cloudflare_email_routing_rule" "contact" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "Forward contact@ to the personal mailbox"
  enabled = true

  matcher {
    type  = "literal"
    field = "to"
    value = "contact@${var.domain}"
  }

  action {
    type  = "forward"
    value = [var.forwarding_email]
  }

  depends_on = [cloudflare_email_routing_address.forwarding]
}

# Catch-all, which is the only way to get plus-addressing (info+play@, info+support@): Cloudflare
# has no wildcard matcher, so a literal rule per variant would be the alternative. The spam cost
# is acceptable — the domain has never published an address, and both Cloudflare and Gmail filter
# before anything reaches the inbox.
resource "cloudflare_email_routing_catch_all" "default" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "Catch-all: forward everything else (plus-addressing)"
  enabled = true

  matcher {
    type = "all"
  }

  action {
    type  = "forward"
    value = [var.forwarding_email]
  }

  depends_on = [cloudflare_email_routing_address.forwarding]
}

# ---------------------------------------------------------------------------------------------
# Apex authentication records
# ---------------------------------------------------------------------------------------------

# One SPF record covering both halves. RFC 7208 permits exactly one per name, and publishing a
# second silently breaks the first — ../cot shipped Cloudflare's and Mailgun's separately and had
# to fix it (commit 9c1019ca). Cloudflare's include is for forwarded mail, Mailgun's for replies.
#
# Coexists with the apex CNAME in cloudflare.tf: Cloudflare flattens that CNAME to A records, so
# the apex is not a true CNAME as far as the DNS protocol is concerned and may carry other types.
#
# Watch for a *duplicate* after enabling Email Routing: alongside the apex MX, Cloudflare also adds
# its own "v=spf1 include:_spf.mx.cloudflare.net ~all" TXT, which it does not own afterwards and
# Terraform never sees. Observed on the 2026-08-09 apply. Two SPF records at one name is the exact
# RFC 7208 failure this combined record exists to prevent, so delete Cloudflare's:
#
#   curl -s -H "Authorization: Bearer $CF" \
#     "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=TXT&name=$DOMAIN"
#   curl -s -X DELETE -H "Authorization: Bearer $CF" \
#     "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/<the-one-without-a-comment>"
resource "cloudflare_record" "root_spf" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "@"
  type    = "TXT"
  content = "v=spf1 include:_spf.mx.cloudflare.net include:mailgun.org ~all"
  ttl     = 3600
  comment = "SPF - Cloudflare Email Routing (forwarding) + Mailgun (sending)"
}

# p=none is a deliberate ceiling, not a stepping stone we forgot to climb. Gmail sending through
# Mailgun uses a From of contact@<domain> while the envelope sender is mg.<domain>, so SPF does not
# align to the header From; DKIM does, which is what carries DMARC here. Tightening to quarantine
# without first confirming DKIM alignment in real mail would reject our own replies.
resource "cloudflare_record" "dmarc" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=none; rua=mailto:contact@${var.domain}; aspf=r; adkim=r"
  ttl     = 3600
  comment = "DMARC - monitoring only"
}

# ---------------------------------------------------------------------------------------------
# Sending — Mailgun on mg.<domain>
# ---------------------------------------------------------------------------------------------

# A subdomain, not the apex, so Mailgun's MX records for bounce handling don't collide with
# Cloudflare Email Routing's on the apex.
resource "mailgun_domain" "sending" {
  count = local.email_enabled

  name          = "mg.${var.domain}"
  spam_action   = "disabled"
  dkim_key_size = 1024
}

locals {
  # Mailgun generates the DKIM key, so its name and value can't be written down here — they come
  # out of the domain's record set, and only at apply time.
  #
  # Hence `count` on the record below rather than the `for_each` over record names that would read
  # more naturally (and that ../cot uses): for_each *keys* must be known during plan, and these
  # are not. cot gets away with it only because its mailgun_domain is already in state — a
  # from-scratch apply there would hit "Invalid for_each argument" exactly as this did.
  #
  # Exactly one record is expected, because use_automatic_sender_security is off; that is Mailgun's
  # rotating-key mode and the only thing that yields several. one() fails loudly if that changes,
  # rather than silently publishing the first of them.
  #
  # Reading the selector out of the response rather than assuming it is also load-bearing: the
  # 2026-08-09 apply came back with "mailo._domainkey", not the "k1._domainkey" every Mailgun doc
  # and ../cot's runbook shows.
  mailgun_dkim = local.email_enabled == 0 ? null : one([
    for record in mailgun_domain.sending[0].sending_records_set : record
    if can(regex("_domainkey", record.name))
  ])
}

# allow_overwrite on every Mailgun record below: Mailgun's own dashboard offers to create these,
# and a half-finished manual setup would otherwise make the apply fail on "record already exists"
# rather than converging.

resource "cloudflare_record" "mailgun_spf" {
  count = local.email_enabled

  zone_id         = data.cloudflare_zone.domain[0].id
  name            = "mg"
  type            = "TXT"
  content         = "v=spf1 include:mailgun.org ~all"
  ttl             = 3600
  allow_overwrite = true
  comment         = "Mailgun sending domain SPF"
}

resource "cloudflare_record" "mailgun_dkim" {
  count = local.email_enabled

  zone_id = data.cloudflare_zone.domain[0].id
  # "k1._domainkey.mg.<domain>" -> "k1._domainkey.mg": Cloudflare wants the name relative to the zone.
  name            = trimsuffix(local.mailgun_dkim.name, ".${var.domain}")
  type            = local.mailgun_dkim.record_type
  content         = local.mailgun_dkim.value
  ttl             = 3600
  allow_overwrite = true
  comment         = "Mailgun DKIM"
}

# Open/click tracking. Unproxied on purpose — Cloudflare's proxy would break the redirect.
resource "cloudflare_record" "mailgun_tracking" {
  count = local.email_enabled

  zone_id         = data.cloudflare_zone.domain[0].id
  name            = "email.mg"
  type            = "CNAME"
  content         = "mailgun.org"
  proxied         = false
  ttl             = 3600
  allow_overwrite = true
  comment         = "Mailgun tracking"
}

# Bounce handling for mg.<domain>. Separate from the apex MX that Email Routing owns.
resource "cloudflare_record" "mailgun_mx" {
  for_each = local.email_enabled == 0 ? {} : {
    a = "mxa.mailgun.org"
    b = "mxb.mailgun.org"
  }

  zone_id         = data.cloudflare_zone.domain[0].id
  name            = "mg"
  type            = "MX"
  content         = each.value
  priority        = 10
  ttl             = 3600
  allow_overwrite = true
  comment         = "Mailgun bounce handling"
}
