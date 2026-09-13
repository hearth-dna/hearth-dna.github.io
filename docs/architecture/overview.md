# Architecture overview

See `../design.md` for the full proposal. One screen:

```
Browser (PWA)                                   Static hosting          Optional helper
┌──────────────────────────────┐                ┌──────────────┐        ┌──────────────────┐
│ React UI                     │ ── kb.json ──▶ │ Pages / R2   │        │ Cloud Run (Go)   │
│  People · Report · Family    │                └──────────────┘        │ /v1/ask (BYOK or │
│  Ask · Settings/export       │                                        │  operator key)   │
│ egress.ts (only fetch site)  │ ── previewed context, per-request ───▶ │ no DB, no logs   │
│ db.ts ⇄ db.worker.ts         │      confirmation, opt-in consent      └──────────────────┘
│   SQLite WASM on OPFS        │
│ import/ kb/ family/ ask/     │   Copy-out: clipboard → any assistant the user trusts
│ export/ consent/             │
└──────────────────────────────┘
```

Data flow for an import: file → `unpack.ts` (zip/gz) → `providers.ts` (detect + parse) →
`repo.importCalls` → worker bulk insert (literal SQL, sorted, index rebuilt) → OPFS.

Data flow for Ask: question → `retrieve.ts` (kb rsids) → `personCallsFor` per selected person →
`computeFindings` → `buildContextPack` (pseudonymised, deterministic) → preview → user copies
(logged) or, with tier-3 consent, `egress.sendContext` after a confirmation dialog.
