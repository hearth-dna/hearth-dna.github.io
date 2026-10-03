# Hearth

Local-first family genome browser. A PWA that stores a whole family's raw DNA files, pedigree,
medical documents and notes **in the browser only**, answers questions against a bundled
knowledge base, and lets you build a context pack to paste into any chat assistant you already
trust. No account, no server-side copy of your data.

Design: [`docs/design.md`](docs/design.md) (the full proposal, ported from the `family_dna` repo).
Hosting: GitHub Pages, and nothing else — see
[ADR 0005](docs/decisions/0005-github-pages-hosting.md). The site root is the landing page
(`landing/`); the app lives under `/app/` ([ADR 0011](docs/decisions/0011-landing-at-root-app-under-app.md)).

Licence: [GNU AGPL-3.0](LICENSE). The WHO growth tables in `kb/reviewed/growth/` are © World
Health Organization, reproduced with attribution for non-commercial use (`kb/README.md`).

## Repository layout

```
hearth/
├── frontend/      React + TypeScript + Vite PWA; SQLite WASM on OPFS; all analysis runs here
├── mobile/        native Android (Compose) and iOS (SwiftUI) apps with their own data layer (ADR 0010)
├── kb/            knowledge-base source (reviewed SNP entries) and build script → frontend/public/kb.json
├── landing/       the landing page at the site root, privacy and terms; the app is served under /app/
├── scripts/       dev helpers
└── docs/          architecture, decisions (ADRs), runbooks
```

## Getting started

```bash
make help              # every command with a one-line description
make frontend-install  # npm install
make dev               # Vite dev server in the background, opens the app
make dev-stop
make test              # Vitest
```

Supported raw-data formats: AncestryDNA, 23andMe, MyHeritage, FamilyTreeDNA, LivingDNA,
Genotek VCF, and any generic "rsid chromosome position genotype" text file. Compressed `.zip` /
`.gz` uploads are unpacked in the browser.
