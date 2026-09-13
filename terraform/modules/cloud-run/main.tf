# Cloud Run Service Module (free-tier optimized). Ported from ../sentio; the Hearth helper is
# stateless, so max_instances = 1 is a quota guard rather than a single-writer constraint.

resource "google_cloud_run_v2_service" "service" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    # max_instances = 1 caps free-tier burn; the service is stateless so it is not load-bearing.
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    timeout = "300s"

    service_account = var.service_account_email

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = var.memory
        }
        cpu_idle = true # CPU only allocated during request processing (cheaper)
      }

      # Plain environment variables
      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret Manager-backed environment variables. The secret itself is created
      # out of band (`gcloud secrets create`) and only *read* here, so no secret
      # material ever lands in the Terraform state or in a tfvars file — see
      # ../../secrets.tf.
      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }

      # Plain Go binary; starts in well under a second.
      startup_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 5

        http_get {
          path = "/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 30
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  # Allow unauthenticated access at the Cloud Run layer — auth is enforced by the
  # app itself, not IAM: `/auth/login` verifies a Google ID token and mints the
  # backend's own access/refresh pair, and every protected route then checks the
  # bearer access token (backend/internal/middleware/auth.go).
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image, # updated out-of-band by `make backend-deploy`
    ]
  }

  labels = {
    environment = var.environment
    managed-by  = "terraform"
  }
}

# IAM binding to allow public access (see auth note above)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  name     = google_cloud_run_v2_service.service.name
  location = google_cloud_run_v2_service.service.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
