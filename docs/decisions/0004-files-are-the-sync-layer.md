# ADR 0004: Files are the sync layer — backup folder and portable archive, no cloud API

**Date:** 2026-09-14 · **Status:** Accepted, implemented (design in `docs/architecture/storage/`)

## Context

With no server-side storage (ADR 0001) the user must be able to keep and move their data
without care and feeding. Candidates: a user-chosen folder via the File System Access API, a
single self-contained HTML archive, a Google Drive API integration, a native launcher, or the
operator-run encrypted sync sketched in design §11.4.

## Decision

The app writes encrypted snapshots to a folder the user picks (USB stick or any provider-synced
folder) and can emit one HTML file that contains the app and the data. It does not integrate
any cloud storage API: Google's browser-only OAuth flow is deprecated, the supported flows load
Google's script into our page or route tokens through our backend, and the synced-folder route
already gives Drive/Dropbox/OneDrive users the result with zero new trust surface. The dump
container moves to v2 (zip with a readable header and per-genome original files) so autosave is
cheap and concurrent writers are detected.

## Consequences

- `egress.ts` and the CSP are unchanged by all of this.
- The folder picker is Chromium-only; Firefox and Safari keep manual export/import until they
  ship the picker. The HTML archive is verified in Chrome from `file://`; Firefox and Safari
  are still to be checked.
- Conflicts between two PCs are surfaced, not merged. Merging remains a design §11.4 problem.
- Dump v1 files stay importable indefinitely.
