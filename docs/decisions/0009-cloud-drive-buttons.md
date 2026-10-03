# ADR 0009: Cloud drive buttons — Hearth signs in to Google Drive and Dropbox itself

**Date:** 2026-09-21 · **Status:** Accepted; amended by [0010](0010-native-apps.md) · **Supersedes:** the "no cloud storage API" part of [0004](0004-files-are-the-sync-layer.md) · **Amends:** [0008](0008-cloud-backups-on-the-phones.md)

## Context

ADR 0008 put the phones' backups behind the system document picker. It works, but not the way
people expect: on Android the picker opens on Downloads, Google Drive and Dropbox appear only for
single files and only behind its ☰ menu, and the folder picker never lists them at all. No app can
open the picker on a given provider: Android lets nobody enumerate another provider's roots. Apps
that show a "Google Drive" button talk to Drive themselves.

ADR 0004 declined exactly that for the browser, for reasons that do not hold inside the shells:
Google's browser-only flow needs its script on our page, and a backend held the secret. A native
app is an OAuth "installed application": PKCE, no secret, no script on the page, and the refresh
token stays in the platform's own storage.

## Decision

The phone apps offer **Google Drive**, **Dropbox** and, on iPhone, **iCloud Drive** buttons above
the picker, which stays for everything else (a USB drive, OneDrive, a local folder).

- **Credentials live in the shell, data goes through `egress.ts`.** The shell signs in and keeps
  the long-lived grant (Play services for Google on Android; PKCE in `ASWebAuthenticationSession`
  for Google on iOS; PKCE in the browser for Dropbox on both; refresh tokens in the Keychain or the
  app's private preferences). The page asks it for short-lived access tokens and nothing else. The
  shell's only network calls are those token requests.
- **`cloudRequest` in `egress.ts` is the one door.** It accepts only `www.googleapis.com`,
  `api.dropboxapi.com` and `content.dropboxapi.com` (the CSP says the same).
- **Encryption as for a folder: the passphrase decides.** The first cut refused anything but
  ciphertext. It could never sync for a family whose existing backup has no passphrase, which is
  the first real case, so a cloud place now has the same *store unencrypted* choice and warning as a
  folder, and **follows the folder**: with no passphrase set and an unencrypted backup already
  there, Hearth keeps writing it unencrypted instead of stopping. A passphrase encrypts it.
- **The user chooses the Drive folder.** After signing in, an in-app browser lists the Drive's
  folders (and can make one); backups go there, not to a fixed folder. Listing folders the app did
  not create needs the full `drive` scope, so Hearth *can* see the whole Drive; it reads and writes
  only in the chosen folder. The narrower
  `drive.file` was the first cut, rejected because it cannot show existing folders; Google's own
  Picker keeps `drive.file` but does not run inside the app. Dropbox keeps an app folder. iCloud
  goes through the app's own ubiquity container, shown in iCloud Drive as `Hearth` — plain file
  I/O, no API.
- **Consent `cloud_backup`** (version 3: whole-Drive access, and unencrypted unless a passphrase is
  set). Separate from `backup_folder`, because here Hearth itself sends the copy to the account
  chosen, with *Forget* signing out (and revoking where the provider allows it).
- **Configured per deployment, off by default.** A clean checkout builds with no buttons. A
  publisher enables each with values in the gitignored `.env` (`docs/runbook/cloud-backups.md`);
  nothing account-specific is committed.

## Consequences

- **A third egress destination.** CLAUDE.md's rule now reads "own origin, the model provider the
  user brings a key for, and the cloud drive the user signs in to"; the Vitest guard still proves
  that `egress.ts` is the only caller of `fetch`, and a new test proves the host check.
- **One non-AndroidX dependency** in the Android shell: `play-services-auth`, because Google no
  longer accepts custom-scheme redirects for Android clients.
- **Publisher setup:** a Google Cloud project with the Drive API, an Android OAuth client per
  package and signing certificate, an iOS OAuth client; a Dropbox app with an app folder; iCloud
  on the App ID. Google's consent screen needs a privacy policy URL.
- **`drive` is a restricted scope.** While the Google project is in *Testing*, up to 100 listed
  test users can sign in (after an "unverified app" warning). A public release needs Google's app
  verification and a yearly third-party security assessment (CASA) for restricted scopes.
- **Real-provider checks are manual.** The request shapes are tested against in-memory fakes of
  both APIs; sign-in needs real credentials and a device, and was not exercised in this commit.

## Update (2026-09-23): native apps

With the shells gone (ADR 0010) there is no page asking a shell for tokens: the native app signs
in, keeps the grant and talks to the drive itself. What changes:

- **The one door is `Egress.kt` / `Egress.swift`,** not `cloudRequest` in `egress.ts`. Each
  refuses any host outside its list and anything but HTTPS, and a test in each app fails if any
  other source file opens a connection. The web app keeps no cloud code: a browser never had the
  buttons, and it backs up to a folder (ADR 0004).
- **Hosts:** `www.googleapis.com`, `api.dropboxapi.com` and `content.dropboxapi.com` as before, the
  Gemini host for reading documents, and on iOS `oauth2.googleapis.com` too: iOS signs in to Google
  with PKCE and exchanges and refreshes the grant there, where Android uses Play services.
- Consent `cloud_backup`, the folder choice, *store unencrypted* and *Forget* are unchanged.
