# Local development

```bash
cp .env.example .env         # only needed for store uploads; nothing required locally
make frontend-install
make dev                     # Vite in the background, opens the app
make dev-stop
make test                    # Vitest
make lint
```

`make dev` uses port 5180. It is deliberately not Vite's default 5173, which `../sentio` holds —
a service worker's scope is per origin, so a shared port would serve sentio's cached shell instead
of Hearth. If something else already holds 5180, run `make dev FRONTEND_PORT=5190`; the port guard
never kills a process from another repo.

- Dev-only handles: `window.__hearth.db` exposes the database wrapper in the browser console.
- `?profile=<name>` opens a separate local database (OPFS directory `.hearth-<name>`). Handy for
  a sandbox; the default profile is what users get.
- Only one tab may hold a profile's database (OPFS access handles are exclusive). The newest tab
  always wins: it asks the owner to hand over and, if there is no answer within 1.5 s, steals the
  Web Lock. The old tab shows a "use it here instead" notice.
- No cross-origin-isolation headers anywhere: the OPFS SAH-pool VFS does not need them and nothing
  uses `SharedArrayBuffer` (ADR 0002). The CSP is a `<meta>` tag injected into `index.html` at build
  time by `vite.config.ts`, so it is absent in dev — check it on a built bundle, not on `make dev`.

## Deploy to GitHub Pages

The only deployment target (ADR 0005). `.github/workflows/pages.yml` builds `frontend/dist`, copies
the landing pages beside it, and publishes the artifact; Pages Source must be "GitHub Actions".

```bash
make frontend-build-pages     # dist/ + the 404.html SPA fallback
make frontend-preview-pages   # serve it on :5181 and click through the routes
make pages-deploy             # gh workflow run pages.yml
```

`vite preview` does SPA fallback and GitHub Pages does not, so to see the real behaviour of a deep
link on a cold load, serve `frontend/dist` with `python3 -m http.server` and open `/health-log/x`:
it must come back as `404.html` rendering the app. After a deploy, `curl -sI` the `.wasm`,
`manifest.webmanifest` and `sw.js` URLs and check their `content-type`.

## Testing with the family_dna samples

`frontend/src/import/parseFile.test.ts` parses the real exports from
`/home/admin/DEV/personal/family_dna/samples` when present and skips otherwise. For a browser
test, upload a `.zip`/`.gz` (the raw `.txt` files are 16–27 MB; gzip them first).

## Import performance

A 677k-row AncestryDNA file takes ~45 s end to end on a laptop: ~15 s unzip + parse + hash on the
main thread, ~10 s literal-SQL insert in the SQLite worker, the rest rebuilding the rsid index.
`docs/decisions/0002-sqlite-wasm-on-opfs.md` records what was measured and why binds were dropped.

## Backups and the portable archive

- `make frontend-build` builds the single-file archive template first (`frontend/dist-archive/archive.html`,
  copied to `frontend/public/hearth-archive.html`, both gitignored) and then the hosted bundle. In
  `make dev` the template is absent, so *Download portable archive* reports that until you build once.
- To try an archive from `file://`: export one from Settings and double-click it, or splice a dump into
  the template by hand (`archive/payload.ts` `splicePayload`). Chrome opens it directly; the worker is a
  classic Blob worker because Chrome refuses module workers from `blob:` on `file://` pages.
- The backup folder needs a Chromium browser and a real click on *Choose folder…*; use a temporary
  folder, then *Back up now*, and check `hearth-backup.hearth` plus `README.txt` appear. `?profile=x`
  changes the file name to `hearth-backup-x.hearth`.
