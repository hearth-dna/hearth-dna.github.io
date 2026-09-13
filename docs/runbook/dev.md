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
- Only one tab may hold a profile's database (OPFS access handles are exclusive). A second tab
  gets a clear "already open in another tab" error instead of silently running in memory.
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
