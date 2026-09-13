# Repository Guidelines

## Project Structure & Module Organization

Terraform manages Hearth's GCP **and Cloudflare** infrastructure. Root configuration is grouped by
feature: `main.tf` (APIs, registry, replica bucket, backend service account, Cloud Run), `secrets.tf`,
`cloudflare.tf`, `cloudflare-pages.tf`, `monitoring.tf`, plus `variables.tf` and `outputs.tf`. The only
reusable module is `modules/cloud-run/` (mirrors `../cot/terraform/modules/cloud-run/`, minus Cloud SQL
wiring this project doesn't use). Environment tfvars live in `environments/`.

Three structural facts that are easy to break:

- **The backend service account is declared at the root, not in the cloud-run module.** Cloud Run
  validates Secret Manager access when a revision starts, so the accessor grant must apply *before* the
  service. Moving the account back into the module reintroduces an ordering race that makes a
  from-scratch apply fail intermittently.
- **Every Cloudflare resource is `count`-gated on `var.enable_cloudflare`**, so the GCP half can be
  applied before a domain exists. Adding an ungated Cloudflare resource breaks that.
- **`EDGE_SHARED_SECRET`/`LLM_API_KEY` is read by Cloud Run, not by Terraform.** `secrets.tf` uses the *metadata* data
  source (`google_secret_manager_secret`) deliberately — switching it to `_version` would copy the signing
  key into the state file for no benefit. The two provider credentials are the exception: a provider
  needs its value at plan time, so the Cloudflare token and (with `enable_email`) the Mailgun API key
  unavoidably land in state.
- **`email.tf` is gated on `var.enable_cloudflare && var.enable_email`,** and its `mailgun` provider
  block carries the same placeholder-key trick as the Cloudflare one, for the same reason: Terraform
  configures a provider whose blocks appear in the config even when every resource using it is
  `count = 0`, and an empty key fails at configure time.

See `../docs/decisions/0047-cloudflare-edge-and-gcp-free-tier.md` for the cost model and the
database-size ceiling that sets Cloud Run's memory limit.

## Build, Test, and Development Commands

- `terraform fmt`: format changed `.tf` files.
- `terraform init`: initialize the provider and GCS backend state.
- `terraform validate`: check configuration syntax and provider schemas.
- `terraform plan -var-file=environments/production.tfvars`: review changes before apply.
- `terraform apply -var-file=environments/production.tfvars`: apply only after explicit review and
  approval.

## Coding Style & Naming Conventions

Group resources by provider/feature, matching the existing flat layout. Use descriptive lowercase
snake_case names for variables, locals, outputs, and resources. Prefer variables over hardcoded
project/region/image values. Keep `environments/*.tfvars.example` sanitized and committed; keep real
`.tfvars` out of git. The repo is open-source ready: no real project numbers, account IDs, zone IDs,
domains, emails or bucket names in `.tf`, `.md` or example files — placeholders only.

## Testing Guidelines

Run `terraform fmt` and `terraform validate` for every change. Include a plan summary in PRs, especially
for changes that create, replace, or delete resources.

## Security & Configuration Tips

Terraform can modify production infrastructure. Never commit state files or real `.tfvars`. Treat IAM
and storage-bucket resources as high-impact; confirm the target project (`project_id` in your local
`environments/production.tfvars`) before applying. There is no database and no bucket holding personal data: the helper is stateless by design (ADR 0001).

Secrets are created out of band with `gcloud secrets create` and only read here — never add a variable
that carries secret material, and never put one in `environments/*.tfvars`. The state bucket must stay
private and versioned, because the Cloudflare API token's value is in state.

`max_instances = 1` caps free-tier consumption; the edge shared secret (Worker binding → Go middleware)
is what keeps the raw `*.run.app` origin from bypassing the rate limiter.
