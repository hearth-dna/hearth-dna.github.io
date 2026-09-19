# Architecture overview

See `../design.md` for the full proposal; `storage/` for backups, portable archives and dump v2;
`../decisions/0005-github-pages-hosting.md` for the deployment. One screen:

```
Browser (PWA)                                   Static hosting          The user's provider
┌──────────────────────────────┐                ┌──────────────┐        ┌──────────────────┐
│ React UI                     │ ── kb.json ──▶ │ GitHub Pages │        │ api.anthropic.com│
│  People · Report · Family    │                └──────────────┘        │ generativelang…  │
│  Ask · Health · Settings     │                                        │ reached with the │
│ egress.ts (only fetch site)  │ ── previewed context, per-request ───▶ │ user's own key   │
│ db.ts ⇄ db.worker.ts         │      confirmation, opt-in consent      └──────────────────┘
│   SQLite WASM on OPFS        │
│ import/ kb/ family/ ask/     │   Copy-out: clipboard → any assistant the user trusts
│ export/ consent/             │   No server of ours anywhere in this picture (ADR 0007).
└──────────────────────────────┘
```

Data flow for an import: file → `unpack.ts` (zip/gz) → `providers.ts` (detect + parse) →
`repo.importCalls` → worker bulk insert (literal SQL, sorted, index rebuilt) → OPFS.

Data flow for Ask: question → `retrieve.ts` (kb rsids) → `personCallsFor` per selected person →
`computeFindings` → `buildContextPack` (pseudonymised, deterministic) → preview → user copies
(logged) or, with tier-3 consent, `egress.sendContext` after a confirmation dialog.
