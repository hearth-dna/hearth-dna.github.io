# Hearth

Local-first family genome browser. A PWA that stores a whole family's raw DNA files, pedigree,
medical documents and notes **in the browser only**, answers questions against a bundled
knowledge base, and lets you build a context pack to paste into any chat assistant you already
trust. No account, no server-side copy of your data.

Design: [`docs/design.md`](docs/design.md) (the full proposal, ported from the `family_dna` repo).
Hosting: GitHub Pages, and nothing else — see
[ADR 0005](docs/decisions/0005-github-pages-hosting.md).

## Repository layout

```
hearth/
├── frontend/      React + TypeScript + Vite PWA; SQLite WASM on OPFS; all analysis runs here
├── mobile/        Android + iOS shells that run the same web build in a native window (ADR 0006)
├── kb/            knowledge-base source (reviewed SNP entries) and build script → frontend/public/kb.json
├── landing/       static privacy / terms pages, published beside the app
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
