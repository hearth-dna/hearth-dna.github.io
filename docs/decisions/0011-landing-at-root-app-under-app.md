# ADR 0011: the landing page owns the site root, the app moves to /app/

**Date:** 2026-10-03 · **Status:** Accepted · **Amends:** [0005](0005-github-pages-hosting.md)

## Context

Since ADR 0005 the app shell answered the site root, so a first visit opened straight into an
empty app with no word on what Hearth is, why a family's DNA is safe in it, or that it is open
source. `landing/index.html` existed but was never published. A page people can read first — and
link to, and that search engines can index — needs the root.

## Decision

- `/` is `landing/index.html`: what Hearth does, the privacy model (browser storage only, no
  server, no account, nothing leaves unless the user acts), the AGPL-3.0 licence and a link to
  the repository. Privacy and terms sit beside it. Plain files, no build, no third-party requests.
- The app is built with `base: '/app/'`. Its service worker, manifest scope and start URL are
  `/app/`; routes are written under it (`/app/charts`) and the app's own assets are fetched under
  it. `404.html` at the root is the app shell, so a deep link at any depth opens the app, and an
  address from before the move (`/people`) is rewritten to `/app/people`.
- `landing/sw.js` replaces the old root service worker for browsers that ran the app at `/`: it
  deletes the root-scope caches and unregisters itself, so `/` shows the landing page.
  `landing/landing.js` sends an app installed before the move (opened at `/` in standalone mode)
  on to `/app/`.
- `make pages-site` assembles the site (landing at the root, `frontend/dist` as `app/`) for the
  Pages workflow and for `make frontend-preview-pages`. The repository URL is filled in by the
  workflow from `github.repository`; the committed pages carry a placeholder.

## Consequences

- User data is untouched: OPFS, IndexedDB and localStorage belong to the origin, not the path.
- The landing page is English only; the app keeps its twenty languages.
- The portable archive is unaffected (`base: './'`, routes in the hash).
