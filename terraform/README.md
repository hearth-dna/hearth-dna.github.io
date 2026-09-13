# Terraform Infrastructure

GCP + Cloudflare for Hearth, ported from `../sentio/terraform/`. Target cost **~$0-1/month plus
the domain**; see `../docs/decisions/0003-cloudflare-edge-gcp-free-tier.md` and
`../docs/design.md` §11-12.

```
                         ┌── app.<domain> ──▶ Cloudflare Pages (frontend/dist, SPA fallback, CSP)
                         ├── <domain>     ──▶ Cloudflare Pages (landing/)
Internet ──▶ Cloudflare ─┼── kb.<domain>  ──▶ R2 bucket hearth-kb (public knowledge base)
             TLS/CDN/WAF └── api.<domain> ──▶ Worker (Host rewrite + X-Hearth-Edge secret)
             rate limit                        └──▶ Cloud Run hearth-backend (min 0 / max 1, 512Mi, stateless)
                                                     ├── Secret Manager: edge-shared-secret, llm-api-key
                                                     └── Artifact Registry (backend:<tag>)
```

## Manual prerequisites

1. A GCP project with billing linked; `gcloud auth login` and `gcloud auth application-default login`.
2. A GCS bucket for state (`hearth-production-terraform-state`, private, versioned) — edit `main.tf` if named differently.
3. Secrets, created out of band and only read here:
   ```bash
   openssl rand -base64 32 | gcloud secrets create edge-shared-secret --data-file=-
   printf '' | gcloud secrets create llm-api-key --data-file=-          # empty = BYOK only
   printf '%s' "$CF_TOKEN" | gcloud secrets create cloudflare-api-token --data-file=-   # only for enable_cloudflare
   ```
4. For the Cloudflare half: a domain in the Cloudflare account (zone exists), and an API token
   scoped to DNS, Workers, Pages, R2 and (optionally) Email Routing.
5. After apply with Cloudflare: attach the custom domain `kb.<domain>` to the R2 bucket in the
   dashboard (the v4 provider has no resource for it).

## Apply

```bash
cp environments/production.tfvars.example environments/production.tfvars   # edit
terraform init
terraform plan  -var-file=environments/production.tfvars
terraform apply -var-file=environments/production.tfvars                    # GCP half first
cd .. && make backend-image && make backend-deploy
# later: set enable_cloudflare = true, apply again, make frontend-deploy, make landing-deploy
```

`terraform apply` is always manual. CI (`.github/workflows/deploy-*.yml`) ships images and Pages
uploads only.
