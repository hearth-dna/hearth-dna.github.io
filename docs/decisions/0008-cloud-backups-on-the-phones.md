# ADR 0008: Cloud backups on the phones — the system document picker, not cloud APIs

**Date:** 2026-09-21 · **Status:** Accepted · **Amends:** [0004](0004-files-are-the-sync-layer.md), [0006](0006-native-shells-around-the-pwa.md) · **Amended by:** [0009](0009-cloud-drive-buttons.md) (Drive, Dropbox and iCloud buttons; the picker stays for everything else)

## Context

On a computer the backup folder (ADR 0004) is how data reaches Google Drive, Dropbox, OneDrive or
iCloud Drive: the user picks a folder that the provider's desktop client syncs. On the phones there
was no such route. The directory picker is a Chromium desktop API; neither the Android WebView nor
WKWebView has it, so the app only offered manual export there. A phone is where a family keeps
adding health-log entries, and where losing the device is most likely.

Both phone platforms already have what the desktop client provides: a system document picker,
backed by every installed provider (Android's Storage Access Framework, iOS's Files). A provider's
app syncs whatever another app writes through it. The catch is on Android: Google Drive and Dropbox
lend single documents to other apps, never folders (`ACTION_OPEN_DOCUMENT_TREE` does not offer
them). iOS lends folders from iCloud Drive and from most providers.

Considered and rejected: calling the Drive and Dropbox APIs from the shells with a native OAuth
flow. It works without the desktop-style picker, but it needs an OAuth client per deployment (an
account identifier this repository does not carry), Google's app verification, token storage, and
network calls outside `egress.ts` — a second egress path that the Vitest guard cannot see. And it
buys nothing the picker does not already give.

## Decision

The shells lend the page the system picker and a handful of file calls on what it returns, over a
message channel that only the app's own origin gets (a `WebViewCompat.addWebMessageListener` on
Android, a `WKScriptMessageHandlerWithReply` on iOS). The page's backup code does not change shape:
`frontend/src/backup/folder.ts` reads and writes through one small `Dir` interface, backed either
by a browser directory handle or by the native channel (`backup/native.ts`).

Two kinds of place:

- **A folder** — the same layout as on a computer: snapshot, three rotations, `README.txt`, the
  attachments sidecars. iCloud Drive and On My iPhone on iOS; local storage, SD cards and providers
  that support it on Android.
- **A single file** — for Google Drive and Dropbox on Android, or anywhere a user prefers it. It
  holds the snapshot and nothing else: no rotations (the provider's version history is the older
  copy), no conflict copy (a conflict stops and asks), and attached documents stay on the device.
  A second device opens the same file.

What the user picks is a grant, not a path: a persisted content URI on Android, a security-scoped
bookmark on iOS. Picks and grants are the whole native surface; the database, the snapshot, the
encryption and the conflict rule stay in `frontend/`.

## Consequences

- **Still no network path of ours.** The shells gain file I/O, not networking; `egress.ts`, the CSP
  and Android's single `INTERNET` permission are unchanged. The provider's own app, under its own
  terms, moves ciphertext.
- **The backup is as fresh as the provider makes it.** An autosave lands in the provider's local
  copy at once; when it reaches the cloud is up to that app. The header's generation and device
  fields still detect a second device writing in between.
- **Single-file places back up rows, not documents.** The Settings card says so. A folder is the
  route for families who attach many documents.
- **The shells are no longer free of data paths.** ADR 0006 said "no native sync"; this is not
  sync, but it is the first native code that touches a backup. It is small, has no model of the
  data, and sees only encrypted bytes unless the user ticked *store unencrypted*.
- **Not exercised on real providers in this commit.** Android builds and its unit tests pass; the
  iOS side was written without a Mac. Both need a manual run against iCloud Drive, Google Drive and
  Dropbox before a store release.
