# ADR 0002: SQLite WASM on OPFS, in a dedicated worker

**Date:** 2026-09-13 · **Status:** Accepted

## Context

The family_dna repository already has the schema, the `family_all` view and dozens of SQL
queries. Seven genomes are ~5M rows. IndexedDB would mean rewriting every analysis.

## Decision

The official `@sqlite.org/sqlite-wasm` build runs in `db.worker.ts` with the **OPFS SAH-pool
VFS** (`installOpfsSAHPoolVfs`). The default `opfs` VFS was tried first and never installed
under Vite's bundled worker because it cannot locate its async-proxy helper script; the SAH
pool needs no helper, no cross-origin isolation, and is faster. The main thread talks to the
worker through a small request/response protocol (`db.ts`).

Measured on 2026-09-13: prepared-statement `bind()` ≈ 18k rows/s in memory or OPFS alike (the
per-value JS→WASM call dominates); literal-value multi-row `INSERT … VALUES (…),(…)` text ≈ 90k
rows/s. Bulk inserts therefore generate SQL text (quote-doubled), sort rows by primary key, drop
and rebuild the rsid index around the load, and run with `synchronous=OFF` inside one transaction.

## Consequences

- One connection per profile: a Web Lock makes a second tab fail loudly instead of running in
  memory. `?profile=<name>` opens a separate database.
- Reports never pull a whole genome to the main thread; findings query only kb rsids and the
  Mendelian check is a SQL join in the worker.
- `pagehide` terminates the worker so back-forward-cached pages release OPFS handles.
- Next: move parsing into the same worker so the UI stays responsive during import.
