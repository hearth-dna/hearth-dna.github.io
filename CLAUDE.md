# CLAUDE.md

Guidance for Claude Code in this repository. Kept short; detail lives in `/docs`.

## Rules

- **Root stays clean:** only `README.md`, `CLAUDE.md`, `AGENTS.md`, `Makefile`, `.env.example`
  and dotfiles. Everything else goes under `frontend/`, `backend/`, `kb/`, `landing/`, `docs/`.
- **No personal data ever reaches the backend by default.** Every network call in the frontend goes
  through `frontend/src/egress/egress.ts`; a Vitest test asserts nothing else calls `fetch`. The
  backend has no table for genotypes or documents and must never gain one (`docs/design.md` §2, §13).
- **Never create a root `package.json`.** Frontend deps live in `frontend/`; the backend is Go.
- No dead code, minimal deps, simple over clever.
- **Open-source ready, always.** Treat every commit as if the repo were public tomorrow. Nothing
  private or attack-useful is committed: no secrets, tokens, keys, account or project IDs, numeric
  GCP project numbers, zone IDs, bucket names that are not placeholders, real domains, emails,
  internal hostnames, IPs, or sample genomes. Real values live only in `.env`, `terraform/*.tfvars`
  and GitHub secrets (all gitignored or off-repo); committed files carry placeholders
  (`<domain>`, `hearth.example`, `*.tfvars.example`). Security must not depend on obscurity: a
  reader with full source and no secrets must gain nothing. Base design decisions on this.

## Build & run

`make help` is the source of truth. `make dev` runs backend + frontend in the background with
pidfiles under `.dev/`; `make dev-stop` stops them; `make test` runs both suites.

## Architecture (one screen)

- `frontend/src/db` — SQLite WASM (OPFS VFS, falls back to memory). Schema in `schema.ts`.
- `frontend/src/import` — one parser per provider (`providers.ts`), auto-detected by header.
- `frontend/src/kb` — bundled knowledge base (`public/kb.json`, built by `kb/build_kb.py`).
- `frontend/src/family` — Mendelian consistency, shared-genotype stats.
- `frontend/src/ask` — local retrieval, context packs, prompt templates (design §6.3).
- `frontend/src/export` — dump v1: JSON → gzip (CompressionStream) → optional AES-GCM.
- `frontend/src/consent` — consent records (design §13).
- `backend/` — chi server, `/health`, `/v1/ask` (BYOK passthrough only unless `LLM_API_KEY` set).

## Conventions

TypeScript: Biome (single quotes, no semicolons, 2-space). Tests: Vitest, pure-logic suites in
`node` env, DOM suites opt in per file. Go: `gofmt`, table tests. Commits: imperative, lower-case.
