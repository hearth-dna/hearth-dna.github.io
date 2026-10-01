# mobile/ — the Android and iOS apps

Two native apps: Kotlin with Jetpack Compose and Material 3 on Android, Swift with SwiftUI on iOS.
Each has its own data layer, with the web's SQLite schema verbatim in an app-private database. The
reasoning is [ADR 0010](../docs/decisions/0010-native-apps.md); the screens and the formats they
must match are specified in [native-apps.md](../docs/architecture/native-apps.md). Read both before
changing anything structural here.

## The rules that keep three apps one

- **The web app is the reference for behaviour.** Each Kotlin and Swift module ports one
  `frontend/src` module, names it at the top, and has a test that mirrors the web's test.
- **Backups are the contract.** A backup written by any of the three opens in the other two.
  `fixtures/` holds golden files written by each writer, and every restore test opens them.
- **One string catalogue.** Text is written and translated only in `frontend/src/i18n/`;
  `make mobile-assets` copies it (and the knowledge base) into both apps.
- **One door to the network.** Every connection goes through `Egress.kt` / `Egress.swift`, to the
  model provider the user brings a key for and the cloud drive they sign in to, nothing else; a test
  in each app fails if any other file opens a connection.

| | `android/app/src/main/kotlin/com/hearth/` | `ios/Hearth/Native/` |
| --- | --- | --- |
| Database, repository | `data/` | `Data/` |
| Genome import | `genome/` | `Genome/` |
| Knowledge base, family, ask | `kb/`, `family/`, `ask/` | `Kb/`, `Family/`, `Ask/` |
| Documents, attachments | `documents/`, `attachments/` | `Documents/`, `Attachments/` |
| Dump v2 (and v1), backups | `backup/` | `Backup/` |
| Open formats | `export/` | `Export/` |
| Screens | `ui/` | `UI/` |
| Network | `Egress.kt`, cloud sign-in in `Cloud.kt` | `Egress.swift`, `Cloud.swift` |

## Build and run

```bash
make mobile-assets    # copy the strings and kb.json into both apps (the build targets do it too)
make android          # build + install the debug APK on a connected device or emulator
make android-test     # unit tests (JVM, no device), including the fixtures and the egress check
make android-logs     # follow the app's logs
make ios              # build and run on a simulator (macOS + Xcode + xcodegen)
make ios-test         # unit tests on a simulator
```

The copied assets (`app/src/main/assets/i18n/`, `app/src/main/assets/kb.json`, `Hearth/I18n/`,
`Hearth/Resources/kb.json`) are not in git, nor is `Hearth.xcodeproj`, generated from
`ios/project.yml` by `make ios-generate`.

## Publishing

Full procedure: [docs/runbook/store-release.md](../docs/runbook/store-release.md). The short form:

```bash
make mobile-secrets   # which publishing inputs are set (names and status only, never values)
make android-keystore # once, ever — creates the upload key outside the repo
make android-bundle   # signed AAB, verified against the id inside the artifact
make android-publish  # → Play internal track (TRACK=production ROLLOUT=0.1 to stage)
make ios-ipa          # macOS: archive, export, verify the .ipa
make ios-testflight   # upload; make ios-testflight-status asks Apple how it is going
```

Nothing in this directory holds a key, a password, a team identifier, an account id or even the
published app id. `example.hearth.app` is a placeholder — `.example` is the reserved TLD, so it can
never collide with a real listing — and the real identity arrives in `HEARTH_APPLICATION_ID` from
the gitignored root `.env` or a CI secret, like every other publishing input. Every publish target
refuses the placeholder.

Set the real id **before the first upload to either store**: Play and App Store Connect fix the
identifier permanently at that point, and a published app can only be replaced by a new listing
with no installs, reviews or upgrade path.

## What the apps deliberately do not have

No account, no server of ours, no push notifications, no background work beyond a debounced backup
while the app is open, no analytics, no crash reporter, and no third-party SDK beyond Play services'
sign-in client (ADR 0009). Android asks for exactly one permission (`INTERNET`, for reading a
document with the user's own key and for cloud backups) and turns off `allowBackup`; iOS keeps the
database out of iCloud and device backups. The only copy that leaves the phone is the backup the
user sets up, encrypted with their passphrase unless they choose otherwise.
