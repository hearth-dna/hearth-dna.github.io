# Google Drive and other cloud drives

## Chosen route: the provider's desktop client syncs a folder

The backup-folder design (`backup-folder.md`) already covers Google Drive, Dropbox, OneDrive,
iCloud Drive, Syncthing and any NAS mount: the user chooses the synced folder, the app writes an
encrypted snapshot, the provider moves the bytes. Properties:

- No provider code on our page, no new CSP origins, no OAuth client, nothing in `egress.ts`.
- The provider sees ciphertext only. Google's terms and scanning apply to a blob they cannot read.
- Restore on a second PC is "install Drive, open Hearth, choose the folder".
- Works identically for a USB stick, so one code path serves both.

On the phones the provider's app plays the desktop client's part: the shells open the system
document picker, and whatever the user picks there — an iCloud Drive folder, a Google Drive file —
is written to through the provider (ADR 0008). Same properties: no provider code, no OAuth, and
encryption decided by the passphrase, as for any folder.

Limitation: on a computer it needs the desktop sync client installed, and Chromium for the directory
picker.
On a locked-down or borrowed machine the user falls back to downloading the dump and uploading it
through Drive's web UI by hand, which also works and needs nothing from us.

## The phone apps: Drive and Dropbox APIs (ADR 0009)

The trade-offs below are the browser's. Inside the native shells they change: sign-in is an
installed-app OAuth flow with PKCE and no secret, the refresh token stays in the Keychain or the
app's private storage, and no provider script touches the page. So the phone apps have **Google
Drive** and **Dropbox** buttons (and **iCloud Drive** on iPhone): `frontend/src/backup/cloud.ts`
over `cloudRequest` in `egress.ts`, which accepts only the providers' API hosts and only encrypted
envelopes as file content, with the user choosing the Drive folder (full `drive` scope); `mobile/android/.../Cloud.kt` and `mobile/ios/Hearth/Cloud.swift` for
sign-in. Setup per deployment: `docs/runbook/cloud-backups.md`.

## Considered and deferred: Google Drive API from the browser

What it would take, for the record:

- **Auth.** Google's browser-only implicit grant is deprecated and closed to new integrations;
  the supported path is the Google Identity Services script (`accounts.google.com/gsi/client`)
  with the token model, or the authorization-code flow with a backend that holds the client
  secret. Either loads Google's script into our page or routes a Google token through our
  backend. Both cut against "nothing but our own origin" (design §13.2) and would need
  `script-src`/`connect-src`/`frame-src` additions for `accounts.google.com` and
  `www.googleapis.com`.
- **Client id.** An OAuth client id is public by Google's definition but is still an account
  identifier this repo does not commit (CLAUDE.md). It would be a build-time `VITE_*` variable
  from `.env`, with the placeholder in `.env.example`; a fork has to create its own Google Cloud
  project. Scopes: `drive.appdata` (hidden app folder) or `drive.file` (files the app created).
  Both are non-sensitive scopes today, so no verification audit, but the consent screen still
  needs a published privacy policy URL and a verified domain.
- **Tokens.** One-hour access tokens, no refresh token in the browser; re-consent each session
  or a silent re-prompt that third-party-cookie changes make unreliable. Autosave would fail
  quietly after an hour unless the UI re-prompts.
- **Egress.** One new function in `egress.ts` (`putBackup`, `getBackup`, `listBackups`) plus a
  consent kind `cloud_backup_gdrive` and sharing-log entries per upload. The payload would be the
  same encrypted dump v2 file, so Google still only sees ciphertext.

Cost: a Google Cloud project per deployment, a third-party script in the page, CSP changes, a
token-expiry UX, and a second code path that does what the folder already does. Benefit: works
without the desktop client, and on Firefox/Safari where the folder picker is missing. Decision:
not now. Reconsider if the folder route proves unusable for real users on machines they do not
control.

## Not considered further

- Dropbox/OneDrive/Box APIs: same trade-offs as Drive, same answer.
- Operator-run storage: design §11.4 (phase 5), unchanged; it would be the only route that gives
  automatic sync without any provider account, at the price of a bucket we run.
