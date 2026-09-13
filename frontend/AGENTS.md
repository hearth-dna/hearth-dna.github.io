# frontend/ — the Hearth PWA

Read the root `AGENTS.md`/`CLAUDE.md` first and `../docs/design.md` for the product. React 19 +
TypeScript + Vite 8, Biome, Vitest. Runtime deps: `react`, `react-dom`, `fflate` (zip/gz in the
browser), `@sqlite.org/sqlite-wasm`. No router (page state in `App.tsx`), no state library.

```bash
make frontend-install / frontend-run / frontend-test / frontend-build / frontend-lint
```

## Where things live

| Dir | What |
|---|---|
| `src/db/` | `db.worker.ts` owns the one SQLite connection (OPFS SAH-pool VFS, memory fallback); `db.ts` is the main-thread handle (singleton, Web Lock per profile, `pagehide` terminates the worker); `schema.ts`; `repo.ts` = every query the UI uses |
| `src/import/` | `providers.ts` (detection + one line parser per provider), `unpack.ts` (zip/gz/sha256), `parseFile.ts`, `importFile.ts` (unpack→parse→store pipeline shared by `ImportDialog` and `BatchImportDialog`, which creates one person per file named after it) |
| `src/kb/` | loads `public/kb.json`, computes findings, text search |
| `src/family/` | Mendelian check reference implementation (the SQL version is in `repo.ts`); `inheritance.ts` phases a child's alleles to parents and lays out the pedigree for `InheritanceTree.tsx` |
| `src/ask/` | `retrieve.ts` (question → kb rsids), `contextPack.ts` (deterministic pack), `prompts.ts` |
| `src/export/` | dump v1: compact genotype strings, gzip, AES-GCM |
| `src/consent/` | consent texts (`kinds.ts`) and records; revoke = delete the record and what it covered |
| `src/components/HealthLog.tsx` | per-person dated text entries (labs, diagnoses, meds, letters) in `health_log`; gated by `import_document`; offered to the Ask pack |
| `src/egress/` | **the only module that may call `fetch`** — `egress.test.ts` enforces it; `readDocumentWithGemini` is the tier 3 BYOK document reader |
| `src/documents/` | `draft.ts`: transcription prompt, Gemini response schema, JSON → health-log draft |
| `src/components/` | one file per page plus `ConsentForm`, `ImportDialog` |

## Rules that tests enforce

The source is open-source ready: no real API endpoints, keys, account IDs or personal sample data
in `src/`, `public/` or tests. Fixtures are synthetic; the family_dna samples referenced below are
gitignored local files, never committed. Backend origin comes from the Vite proxy / build env.

- No `fetch`/XHR/WebSocket/sendBeacon outside `src/egress/egress.ts`.
- `sendContext` refuses to send without a confirmation token from the UI.
- Context packs are snapshot-tested: the preview is what gets copied.
- Every provider parser yields the same `Call` for the same SNP (`providers.test.ts`).
- `parseFile.test.ts` runs against the real family_dna samples when present.

## Performance notes (measured 2026-09-13, laptop Chrome)

- sqlite-wasm `bind()` costs ~9 µs per value → ~18k rows/s. Literal-value multi-row SQL text is
  ~90k rows/s. `db.worker.ts` therefore builds SQL text for bulk inserts; values are escaped by
  doubling quotes. Don't "clean this up" back to prepared statements without re-measuring.
- Never pull a whole genome to the main thread for a report: `personCallsFor(db, id, rsids)`
  and `mendelianSql` keep the work in the worker. `personCalls` exists for the dump only.
- A 677k-row AncestryDNA file: ~45 s end to end (parse ~15 s on the main thread — a worker is
  the next step — insert ~10 s, index rebuild the rest).

## Gotchas

- The worker falls back to a memory database only after ~3 s of OPFS retries, and `App.tsx` then
  blocks on a "Storage is not available" screen until the user explicitly continues; a red banner
  stays up for the session. Never make memory mode silent again — that is how a user lost an import.

- OPFS SAH pool allows one connection per VFS name. `?profile=x` selects another directory.
- React StrictMode double-runs effects in dev; `Database.open()` is a singleton for that reason.
- Chrome's back-forward cache would keep a parked page's worker (and its OPFS handles) alive;
  `pagehide` → `worker.terminate()` releases them.
- `dialog` elements use `showModal()`; the browser-automation `form_input` tool does not fire
  React's `onChange` for checkboxes — click them.
