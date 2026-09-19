# ADR 0007: No backend — the Go helper service is removed

**Date:** 2026-09-19 · **Status:** Accepted · **Amends:** [0001](0001-local-first-no-personal-data-on-the-server.md), [0005](0005-github-pages-hosting.md)

## Context

`backend/` held a small chi server: `/health` and `/v1/ask`, a BYOK passthrough that became an
operator-key LLM proxy when `LLM_API_KEY` was set. It was the "tier 3 helper" of design §6.3 and the
first of the Always Free jobs sketched in §11.

ADR 0005 stopped deploying it and said the source would stay "for `make dev` and for anyone
self-hosting". Three things were true when we looked again:

- **Nothing reachable ever called it.** `sendContext` is not called from any component, no component
  constructs `kind: 'helper'`, and the `helper_backend` consent was never requested. The tier existed
  only in `egress.ts` and `consent/kinds.ts` — it was never wired into a screen.
- **It could not work where the app is served.** On GitHub Pages `/api/v1/ask` hits the SPA fallback
  and returns `404.html`, as ADR 0005 recorded.
- **It was not free.** Every push paid for a Go toolchain, `gofmt`, `go vet` and `go test` in CI, and
  `make dev` built and booted a server before the frontend could start.

CLAUDE.md forbids dead code. This was 12 files of it, plus the Makefile, CI and frontend surface that
kept it alive.

## Decision

Delete it. `backend/` and `backend/AGENTS.md` are gone; so are the `backend-*` Makefile targets, the
Go steps and change-detection in `ci.yml`, the `/api` dev proxy in `vite.config.ts`, and the
`PORT` / `LLM_API_KEY` / `EDGE_SHARED_SECRET` / `WEB_ORIGINS` variables in `.env.example`.

In the frontend the helper tier goes with it: `AskTarget` loses `kind` and now requires a
`byokKey`, the `/api/v1/ask` branch of `sendContext` is gone, the `helper_backend` consent kind is
gone, and its three i18n keys are removed from `en/consent.json` and all nineteen locale files.

`make test` and `make lint` are the Vitest suite and Biome. `make dev` starts the frontend alone.

The reasoning is kept, not the code: design §11 stands as the record of the hosted design, marked
historical, and ADR 0001's consequences still explain why no server of ours may hold this data.

## Consequences

- **The "no personal data on a server" rule is now unconditional** rather than a promise about how a
  server behaves. There is no server. `egress.ts` has exactly two kinds of destination: our own
  origin for static assets, and the provider the user brings a key for.
- **Ask is BYOK or copy-out, and nothing else.** Tiers 0–2 were always fully local and are
  unaffected; tier 3 is browser → provider directly. No user-visible behaviour changes, because the
  helper tier had no UI.
- **CI is Node-only** and does less work per push.
- Anyone who wants a helper service back writes a new ADR and builds it; design §11 says what it
  would have to be. Git history has the deleted source if it is ever the starting point.
- The repo is one language again — TypeScript, plus Kotlin and Swift in `mobile/`. The Go module
  path, which named a personal GitHub account, goes away with it.
