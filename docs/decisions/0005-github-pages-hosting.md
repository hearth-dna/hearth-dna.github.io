# ADR 0005: GitHub Pages is the whole deployment

**Date:** 2026-09-19 · **Status:** Accepted · **Supersedes:** [0003](0003-cloudflare-edge-gcp-free-tier.md) · **Amended by:** [0007](0007-no-backend.md)

## Context

ADR 0003 declared a Cloudflare edge over a GCP origin: two Pages projects, a Worker, R2, Cloud Run,
Secret Manager, a budget tripwire — ~1,260 lines of Terraform that were never applied to anything.
It presumed a custom domain and an operator willing to run infrastructure.

Hearth does not need any of it. Every byte of analysis runs in the browser (§2), the knowledge base
is a 24 KB static file, and the Go backend only serves the optional Ask "helper" tier — with BYOK,
the browser talks to the provider directly. What is left is a static site.

The usual reason a SQLite-WASM app cannot live on GitHub Pages is that Pages sends no custom
headers, so there is no `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` and no
cross-origin isolation. [ADR 0002](0002-sqlite-wasm-on-opfs.md) already chose the OPFS SAH-pool VFS,
which needs neither, and nothing in `frontend/src` touches `SharedArrayBuffer`. So the blocker does
not apply.

## Decision

The frontend is deployed to **GitHub Pages only**, from a dedicated free organisation whose repo is
named `<org>.github.io`, so the app is served at the **origin root**. `terraform/`, both Cloudflare
Pages projects, the Worker, R2 and the Cloud Run deploy are removed; `.github/workflows/pages.yml`
builds `frontend/dist` and publishes it with `actions/deploy-pages`. The backend source stays for
`make dev` and for anyone self-hosting, but nothing deploys it. *(ADR 0007 went further and deleted
it; `make dev` now starts the frontend alone.)*

A dedicated org, rather than a project page under a personal account, because **OPFS, localStorage
and service-worker scope are partitioned per origin**: every project page under `<user>.github.io`
would share the partition holding the family's genome database and the BYOK key. The root path is
also what spares the app any base-path plumbing in `routes.ts`, `kb.ts` and `egress.ts`.

Losing HTTP headers has three consequences, handled in the page itself:

| Was a header | Now |
| --- | --- |
| `Content-Security-Policy` in `public/_headers` | `<meta http-equiv>` injected at build time by the `hearth-csp-meta` plugin in `vite.config.ts`. Build only: the dev server needs the inline refresh preamble that `script-src 'self'` forbids. |
| `X-Frame-Options` / `frame-ancestors` | A top-frame guard in `src/main.tsx`. `frame-ancestors` is ignored in a meta CSP and has no other equivalent, and the app deletes profiles, exports backups and reveals the BYOK key. |
| `_redirects` SPA fallback | `dist/404.html`, a copy of `index.html`. Pages has no rewrite rules, so a deep link is served `404.html`, which boots the app and lets `routes.ts` resolve the URL. |
| `COOP` / `COEP` | Dropped, including from the dev server. Nothing needed them; the comment in `vite.config.ts` that claimed otherwise was wrong. |

The `connect-src` in the old `_headers` listed a placeholder API host and would have blocked
`api.anthropic.com` and `generativelanguage.googleapis.com` — that is, BYOK Ask and Gemini document
reading. The meta CSP names the two provider hosts and nothing else.

## Consequences

- **Free, with no account anywhere but GitHub.** Free orgs are unlimited, Pages is free, and Actions
  minutes are free and unlimited on public repositories. Limits: 1 GB per site, 100 GB/month soft
  bandwidth, 10 builds/hour — `dist` is ~4.5 MB.
- **The repo must be public** (Pages on a private repo needs Pro/Team), which the project intended
  anyway, and named `<org>.github.io`.
- The Ask **helper tier is dead in the hosted app**: `/api/v1/ask` hits the SPA fallback and returns
  `404.html`. BYOK is the only remote path. The settings UI should stop offering the tier when no
  backend is configured. *(Resolved by ADR 0007: the tier, its consent and its egress branch are
  gone. It turned out no UI ever offered it.)*
- No control over `X-Content-Type-Options` or `Referrer-Policy`. TLS is enforced and `github.io` is
  HSTS-preloaded.
- A deploy takes up to ~10 minutes to reach a browser with no service worker yet (Pages sends
  `Cache-Control: max-age=600` on HTML). Hashed assets are immutable and unaffected.
- Moving to a custom domain later is a repo setting plus DNS, not a code change — the app is already
  served from a root path.
