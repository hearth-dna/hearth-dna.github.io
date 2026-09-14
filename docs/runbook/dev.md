# Local development

```bash
cp .env.example .env         # PORT, WEB_ORIGINS; no secrets needed locally
make frontend-install
make dev                     # backend + Vite in the background, opens the app
make dev-stop
make test                    # Go + Vitest
make lint
```

`make dev` uses ports 8080 (backend) and 5173 (frontend). If another checkout holds them
(`../sentio` does by default), set `PORT=8090` in `.env` and run `make dev FRONTEND_PORT=5180`
— the port guard never kills a process from another repo.

- Dev-only handles: `window.__hearth.db` exposes the database wrapper in the browser console.
- `?profile=<name>` opens a separate local database (OPFS directory `.hearth-<name>`). Handy for
  a sandbox; the default profile is what users get.
- Only one tab may hold a profile's database (OPFS access handles are exclusive). The newest tab
  always wins: it asks the owner to hand over and, if there is no answer within 1.5 s, steals the
  Web Lock. The old tab shows a "use it here instead" notice.
- Vite serves `Cross-Origin-Opener-Policy`/`Embedder-Policy` headers; in production
  `frontend/public/_headers` does the same on Cloudflare Pages.

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
