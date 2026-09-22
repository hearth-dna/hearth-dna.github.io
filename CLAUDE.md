# CLAUDE.md

Guidance for Claude Code in this repository. Kept short; detail lives in `/docs`.

## Rules

- **Root stays clean:** only `README.md`, `CLAUDE.md`, `AGENTS.md`, `Makefile`, `.env.example`
  and dotfiles. Everything else goes under `frontend/`, `mobile/`, `kb/`, `landing/`, `docs/`.
- **There is no server.** Every network call in the frontend goes through
  `frontend/src/egress/egress.ts`; a Vitest test asserts nothing else calls `fetch`. The only
  destinations are our own origin for static assets, the provider the user brings a key for, and
  the cloud drive the user signs in to for backups (ADR 0009: provider API hosts only, checked there).
  Nothing server-side may be added back without a new ADR superseding 0007.
- **Never create a root `package.json`.** Frontend deps live in `frontend/`.
- No dead code, minimal deps, simple over clever.
- **Open-source ready, always.** Treat every commit as if the repo were public tomorrow. Nothing
  private or attack-useful is committed: no secrets, tokens, keys, account or project IDs, numeric
  GCP project numbers, zone IDs, bucket names that are not placeholders, real domains, emails,
  internal hostnames, IPs, or sample genomes. Real values live only in `.env` and GitHub secrets
  (gitignored or off-repo); committed files carry placeholders
  (`<domain>`, `hearth.example`, `*.tfvars.example`). Security must not depend on obscurity: a
  reader with full source and no secrets must gain nothing. Base design decisions on this.

## Build & run

`make help` is the source of truth. `make dev` runs the frontend in the background with a pidfile
under `.dev/`; `make dev-stop` stops it; `make test` runs the suite.

## Architecture (one screen)

- `frontend/src/db` — SQLite WASM (OPFS VFS, falls back to memory). Schema in `schema.ts`.
- `frontend/src/import` — one parser per provider (`providers.ts`), auto-detected by header.
- `frontend/src/kb` — bundled knowledge base (`public/kb.json`, built by `kb/build_kb.py`).
- `frontend/src/family` — Mendelian consistency, shared-genotype stats.
- `frontend/src/ask` — local retrieval, context packs, prompt templates (design §6.3).
- `frontend/src/export` — dump v1: JSON → gzip (CompressionStream) → optional AES-GCM.
- `frontend/src/consent` — consent records (design §13).
- `mobile/android`, `mobile/ios` — becoming native apps (Compose, SwiftUI), each with its own
  data layer, screen by screen beside the old web-view shell (ADR 0010, supersedes 0006 at
  parity). Spec: `docs/architecture/native-apps.md`. Backups are the contract: `mobile/fixtures/`
  golden files are opened by all three. Strings stay in `frontend/src/i18n` (`make mobile-i18n`).

## Conventions

TypeScript: Biome (single quotes, no semicolons, 2-space). Tests: Vitest, pure-logic suites in
`node` env, DOM suites opt in per file. Commits: imperative, lower-case.
