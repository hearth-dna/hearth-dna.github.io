# ADR 0003: Cloudflare at the edge, GCP free tier at the origin

**Date:** 2026-09-13 · **Status:** Superseded by [0005](0005-github-pages-hosting.md)

Never applied. The Terraform that declared it was deleted with 0005, which replaced the whole
topology with GitHub Pages and no backend. Kept as a record of what was considered.

Port of sentio ADR 0047 with three deliberate differences (design §12.4):

1. **The raw `*.run.app` origin is closed.** The Worker adds `X-Hearth-Edge: <secret>` and the
   Go middleware rejects requests without it, because the free LLM/OCR quotas are what an
   abuser would drain. The secret lives in Secret Manager and is bound into the Worker.
2. **No keep-warm.** There is no Litestream restore on cold start; a helper call may pay one.
3. **R2, not GCS, for public files.** The knowledge base is served from `kb.<domain>` with zero
   egress fees and no region restriction.

Everything else is sentio's shape: Pages for `app.` and the apex, a Worker for the Host
rewrite, one rate-limiting rule on `api.`, `enable_cloudflare` gating, secrets read from Secret
Manager, a budget tripwire at $2, deploy via Workload Identity Federation on merge to main,
`terraform apply` by hand only.
