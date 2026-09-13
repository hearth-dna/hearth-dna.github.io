# Cost guardrails and the two alerts that actually matter here.
#
# Deliberately small. ../cot/terraform/monitoring.tf is ~940 lines of log-based metrics and
# percentile alerting; at this traffic level percentile alerts on a wide histogram fire on a
# single slow request, so this config alerts on counts and on the one resource that can take the
# service down. Everything here is inside the always-free Cloud Monitoring allowance.
#
# The budget is the piece ../cot leaves out of Terraform and handles with a script — the whole
# point of a free-tier deployment is finding out before the bill, not after.

resource "google_project_service" "monitoring" {
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------------------------
# Notification channel
# ---------------------------------------------------------------------------------------------

resource "google_monitoring_notification_channel" "email" {
  count = var.alert_email != "" ? 1 : 0

  display_name = "Hearth alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring]
}

# ---------------------------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------------------------

# Counts, not percentiles: at this traffic level a single request landing in a wide histogram
# bucket moves p95 far enough to page falsely.
resource "google_monitoring_alert_policy" "backend_5xx" {
  count = var.alert_email != "" ? 1 : 0

  display_name = "Hearth backend — 5xx responses"
  combiner     = "OR"

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      The backend is returning server errors. Most likely causes, in order of how often they bite:

      1. `EDGE_SHARED_SECRET` missing — `config.Load()` fails closed and the container
         crash-loops. Verify with
         `gcloud run services describe ${module.backend.service_name} --region ${var.region}`.
      2. The LLM provider is returning errors (502 from /v1/ask); check the revision logs.
    EOT
  }

  conditions {
    display_name = "More than 10 5xx responses in 5 minutes"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${module.backend.service_name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring]
}

# Free-tier burn signal. 2M requests/month is roughly 46 per minute sustained; 500 per 5 minutes
# is an order of magnitude above anything this app's manual-sync usage produces, so it means
# either the rate limiter is being bypassed (the *.run.app origin is still directly reachable) or
# a client is stuck in a retry loop.
resource "google_monitoring_alert_policy" "backend_request_spike" {
  count = var.alert_email != "" ? 1 : 0

  display_name = "Hearth backend — request volume spike"
  combiner     = "OR"

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      Request volume is far above the expected baseline for manual, user-initiated sync.

      Check whether traffic is arriving at the Cloud Run origin directly, bypassing the
      Cloudflare rate limit — the service is `INGRESS_TRAFFIC_ALL`, so its *.run.app URL is
      publicly reachable by design (ADR 0047 records this trade-off).
    EOT
  }

  conditions {
    display_name = "More than 500 requests in 5 minutes"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${module.backend.service_name}\" AND metric.type = \"run.googleapis.com/request_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = 500
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring]
}

# ---------------------------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------------------------

# This deployment is designed to cost ~$0-1/month, so the budget is not a spending plan — it is a
# tripwire. Crossing 50% of even $5 means something is structurally wrong (the free tier lapsed,
# an instance is pinned warm, someone is driving the LLM proxy), and the alert should
# read as "go look", not "you are over budget".
#
# Requires the caller to hold billing.budgets.create on the billing account, which is separate
# from project IAM — leave var.billing_account_id empty to skip.
resource "google_project_service" "billingbudgets" {
  count = var.billing_account_id != "" ? 1 : 0

  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

resource "google_billing_budget" "monthly" {
  count = var.billing_account_id != "" ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "Hearth ${var.environment} monthly budget"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  dynamic "all_updates_rule" {
    for_each = var.alert_email != "" ? [1] : []
    content {
      monitoring_notification_channels = [google_monitoring_notification_channel.email[0].id]
      disable_default_iam_recipients   = false
    }
  }

  depends_on = [google_project_service.billingbudgets]
}
