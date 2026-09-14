# Portable archive: the app and the data in one file

## Goal

"Save my data together with the app, so I can open it from the archive itself and browse." The
answer is **one HTML file**, `hearth-<date>.html` (or `.enc.html`), that contains the whole
frontend and the dump v2 payload. Double-clicking it in any desktop browser opens Hearth in
*archive mode* with that data loaded. No server, no install, no network. It works from a USB
stick, an email attachment, or a folder in Google Drive opened on a machine that has never seen
Hearth. Precedent: TiddlyWiki has shipped as a self-modifying single HTML file for twenty years.

A zip with a separate `index.html` and data file was considered and rejected: a page opened from
`file://` may not `fetch` its sibling files (Chromium treats each file as an opaque origin), so
the data has to be either embedded or picked by hand. Embedding is simpler for the user.

## File layout

```html
<!doctype html>
<title>Hearth archive 2026-09-14</title>
<script type="application/x-hearth-archive" id="hearth-data">
  <base64 of the dump v2 file, 4 KB per line>
</script>
<style>…all css…</style>
<script type="module">…the whole app, sqlite3.wasm inlined as base64, worker inlined…</script>
```

Sizes for this family: app ~2.5 MB (React, sqlite-wasm ~1 MB, kb.json ~1 MB), data ~5 MB
gzipped, base64 adds a third: ≈ 10 MB per archive. Fine for a stick or a drive; not for email
without encryption, which is the default anyway.

The data block comes first so the passphrase prompt can appear before the app has parsed the
big script, and so a truncated file fails loudly (the app checks the payload length recorded in
the header).

## Archive mode in the app

Detected at boot: `document.getElementById('hearth-data')` exists **or** `location.protocol ===
'file:'`. Consequences:

- The database opens as `:memory:` explicitly; the worker's OPFS attempt is skipped (no retry
  loop, no lock, no BroadcastChannel). The existing "not persistent" reason string is replaced by
  a banner: *Archive opened read-only in memory. Changes are kept only if you save a new archive.*
- Import uses the embedded payload: decrypt if needed (passphrase dialog before anything else),
  then the same `importDump` path as Settings.
- Settings shows *Save archive…* (downloads a new `hearth-<date>.html`, re-embedding the current
  state) and *Export dump* as today. *Backup folder* is hidden (no persistence to back up and the
  picker is not available on `file://` in all browsers).
- Ask tier 3 and the document reader stay available: the user's key is entered for the session;
  `egress.ts` is unchanged. There is no CSP on `file://`; that is acceptable because there is no
  third-party code in the file to be constrained.
- Service worker registration is skipped (unavailable on `file://`).

Hosted mode gains one button in Settings, *Download portable archive*, next to *Export dump*.

## Build

A second Vite build target, `frontend/vite.archive.config.ts`, producing
`frontend/dist-archive/hearth.html`:

- `vite-plugin-singlefile` inlines JS and CSS. Module scripts inline fine; only *imports* of
  sibling files break on `file://`, and after inlining there are none.
- The SQLite worker: Vite emits `db.worker.ts` as a separate file, which `file://` cannot load.
  `archive/worker.ts` imports it with `?worker&inline` (classic format, Blob URL) and
  `sqlite3.wasm?url` as a data: URL; the worker decodes the bytes and passes them as `wasmBinary`.
- `kb.json` is bundled as a JSON module behind the `__HEARTH_ARCHIVE__` define (the Vitest fetch
  rule still holds since no new `fetch` appears).
- The build emits a template with a placeholder comment where the data block goes. At runtime,
  "Download portable archive" fetches the template from our own origin (`fetchOwnAsset('/hearth-
  archive.html')`), splices the payload in, and triggers the download. So the hosted deployment
  ships the template as a static asset, ~2.5 MB, cached by the service worker like everything
  else.

Makefile: `make frontend-build` builds the template first (`npm run build:archive`, also
`make frontend-build-archive`) and copies it to `public/hearth-archive.html` (gitignored), so the
hosted build ships it as a static asset that the service worker precaches.

## Spike results (Chrome 2026-09, headless over the DevTools protocol, `file://`)

- A **module** worker from a `blob:` URL is refused on a `file://` page (silent error event);
  a **classic** worker from a `blob:` URL works, as does a module worker from a `data:` URL. The
  archive build therefore uses `worker.format: 'iife'` and Vite's `?worker&inline`.
- sqlite-wasm's own fetch of the wasm never resolves inside that worker; handing the decoded bytes
  to the Emscripten loader as `wasmBinary` works. `db.worker.ts` does that when the URL is `data:`.
- `crypto.subtle`, `crypto.randomUUID` and `isSecureContext` are all available on `file://`.
- Plaintext and encrypted sample archives open, restore and render; the passphrase gate works.
- Firefox and Safari: not yet run. The checklist below is what to record.

## Spike checklist

Run a saved archive from `file://` in Firefox and Safari and record:

1. Blob-URL module worker starts and can instantiate wasm from a Blob URL.
2. `crypto.subtle` is present (file: is a potentially trustworthy origin per spec; Chrome and
   Firefox expose it, Safari to be checked).
3. `CompressionStream`/`DecompressionStream` available (all three, yes since 2023).
4. `<a download>` works for a 10 MB Blob from `file://` (Chrome yes; Safari may open it instead
   of saving; fallback is a "right-click, save as" hint).
5. Memory: 5M genotype rows in an in-memory SQLite inside a worker ≈ 300 MB. If Safari or a
   low-RAM machine struggles, archive mode loads genotypes lazily per person on first view;
   the dump v2 per-genome blobs make that a cheap change.

If Safari fails 1 or 4, ship archive mode as "Chrome, Edge or Firefox" and say so in the file's
`<noscript>`/unsupported banner. The archive remains a valid dump v2 carrier either way: the
hosted app can import a `.html` archive by extracting the data block.

## Security

- Encrypted by default; the passphrase dialog is the first thing rendered. The plaintext option
  carries the design §13.1 warning and names the file `hearth-<date>-plaintext.html` so it is
  obvious in a folder listing.
- The file is exactly the code the hosted site serves, plus the data. The build is reproducible
  from source; the archive embeds `app_version` and the git commit so a reader can rebuild and
  diff. No obscurity is relied upon.
- Opening a `.html` from an untrusted source is the user's usual browser risk; the archive does
  nothing a normal web page cannot, and having no network access in practice (no CSP but also no
  reason to fetch) is stated in the banner.

## As built

- `archive/payload.ts` (pure, tested): base64 lines, extract and splice the data block.
- `archive/mode.ts`: payload detection (decoded once), memory-only database via the inlined
  worker, *Save archive…* (this page's pristine HTML plus data) and *Download portable archive*
  (the hosted template plus data). `App.tsx` shows the passphrase gate and the memory banner.
- `db.worker.ts` `open` takes `memory: true` (no lock, no OPFS, no BroadcastChannel) and `wasmUrl`.
- `export/restore.ts` accepts `.html` archives, so the hosted app can import one.
