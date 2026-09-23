# Publishing the mobile apps

Both apps can be published to Google Play and the App Store under your own developer account
without a single credential entering this repository. Everything a release needs arrives from the
environment: the gitignored root `.env` locally, GitHub secrets in CI. A reader with the full
source and none of your secrets can build and run the apps, and can publish nothing.

`make mobile-secrets` prints which inputs are set, by name and status only — never a value.

## What lives where

| Input | What it is | Where it lives | Never |
| --- | --- | --- | --- |
| `HEARTH_APPLICATION_ID` | the published id, reverse-DNS of a domain you own | `.env` / CI secret | in git — the committed default is `example.hearth.app` |
| Upload keystore | the Play signing key | `~/.hearth/hearth-upload.jks` + an offline backup | in git; `*.jks` is gitignored as a backstop |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | keystore credentials | `.env` / CI secrets | on a command line (`ps` is world-readable; `make` passes them through the environment) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API credentials | a file outside the repo | in git |
| `APPLE_TEAM_ID` | your Apple developer team | `.env` / CI secret | in git — `ExportOptions.plist` is generated from the `.example` at export time |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` | App Store Connect API key (`.p8`) | `.env` + a file outside the repo | in git |

## Before the first upload

The app identifier is the one decision that cannot be undone. Play fixes the package name and
Apple fixes the bundle id permanently at the first upload; after that they can only be replaced by
a new listing with no installs, reviews or upgrade path. Set `HEARTH_APPLICATION_ID` to the
reverse-DNS of a domain you own, check it in both consoles, and only then upload. Every publish
target refuses the `example.` placeholder outright.

Second: the keystore. `make android-keystore` creates it once, outside the repo, and refuses to
overwrite an existing one. Back it up somewhere you will still have in ten years — losing it means
the published app can never be updated again.

## Android

```bash
cp .env.example .env            # fill in HEARTH_APPLICATION_ID and the ANDROID_* values
make android-keystore           # once, ever
make android-bundle             # copies the strings and kb, builds the signed AAB, verifies it
make android-publish            # → Play internal track
make android-publish TRACK=production ROLLOUT=0.1
```

`android-verify` runs inside `android-bundle` and refuses an AAB that is unsigned or still carries
the placeholder id. `android-publish` uploads the binary only: the store listing, screenshots and
description are never touched by a build push, so a routine release cannot overwrite them.

Play publishing needs a service account: Play Console → Users and permissions → API access → create
a service account in the linked Google Cloud project, grant it release permissions, download the
JSON, and point `PLAY_SERVICE_ACCOUNT_JSON` at it. Keep that file outside the repository.

## App Store

Needs macOS with Xcode, plus `xcodegen` and `bundle install` in `mobile/`.

### Once, before the first build

1. **App ID.** Developer portal → Identifiers → register `HEARTH_APPLICATION_ID`, with the iCloud
   capability (CloudDocuments) when the iCloud Drive backup button is wanted (ADR 0009). No push,
   no app groups.
2. **App record.** App Store Connect → Apps → new app with that bundle id, primary language, SKU.
3. **API key.** Users and Access → Integrations → App Store Connect API → generate a key with the
   *App Manager* role. Download the `.p8` **once** — Apple never shows it again — keep it outside
   the repository, and put its path in `ASC_KEY_PATH`, its id in `ASC_KEY_ID` and the issuer id in
   `ASC_ISSUER_ID`. Never an Apple ID: 2FA makes that path unscriptable, and a key can be revoked
   without touching the account password.
4. **Distribution certificate.** Xcode → Settings → Accounts → Manage Certificates → Apple
   Distribution. `make ios-ipa` passes `-allowProvisioningUpdates` with the API key, so the
   provisioning profile is created for you on first use — no profile to download or commit.

### Every release

```bash
make ios-ipa          # assets → archive → export → verify
make ios-testflight   # upload (NOTES="what changed" sets the TestFlight note)
make ios-testflight-status   # has Apple finished processing it?
```

`ios-verify` runs inside `ios-ipa` and reads the *artifact*, not the variables: it refuses an
`.ipa` whose `CFBundleIdentifier` is not `HEARTH_APPLICATION_ID` (a stale build would otherwise be
uploaded to the wrong listing), one without the string catalogue or `kb.json` inside the bundle (that
build installs and shows raw string keys), one missing `PrivacyInfo.xcprivacy` (the upload is
accepted and then rejected by email hours later, ITMS-91053), one whose
`ITSAppUsesNonExemptEncryption` is not `false` (every build would then wait on the
export-compliance questionnaire), and one that is not validly signed.

Upload touches nothing but the build: no description, no screenshots, no keywords. Submitting for
review stays a decision made in the Console.

Two version rules Apple enforces silently: `CURRENT_PROJECT_VERSION` may not be reused within a
marketing version, and a build already uploaded cannot be replaced — only superseded.

## CI

`.github/workflows/android-release.yml` builds and optionally uploads the AAB on a tag or a manual
run. It reads the same names as `.env`, from repository secrets:

| Secret | Value |
| --- | --- |
| `HEARTH_APPLICATION_ID` | the published id |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ~/.hearth/hearth-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | keystore credentials |
| `PLAY_SERVICE_ACCOUNT_JSON` | the whole JSON document |

The keystore is written to a temporary file that exists for the length of the job. Without the
secrets the workflow builds nothing and says which one is missing, so a fork can never run it.

`.github/workflows/ios-release.yml` is the App Store counterpart, on a `macos-15` runner. It runs
only on a tag or by hand — a macOS minute costs about ten of an ubuntu one — and `upload` is an
explicit input, so a tag can build and verify without publishing anything.

| Secret | Value |
| --- | --- |
| `HEARTH_APPLICATION_ID`, `APPLE_TEAM_ID` | as in `.env` |
| `IOS_DIST_CERT_BASE64` | the Apple Distribution certificate and private key, exported from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `IOS_DIST_CERT_PASSWORD` | the password you set on that `.p12` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | as in `.env` |
| `ASC_KEY_BASE64` | `base64 -i AuthKey_XXXX.p8 \| pbcopy` |

The certificate is imported into a **throwaway keychain** created for the job and deleted in an
`always()` step, and the `.p8` is written to `$RUNNER_TEMP` and removed with it — neither touches
the runner's login keychain, the workspace, or the uploaded artifact.

## Version numbers

Android reads `mobile/android/version.properties` (`VERSION_NAME`, `VERSION_CODE`); iOS reads
`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `mobile/ios/project.yml`. Bump both in the
same commit as the release. Play refuses a `VERSION_CODE` it has seen before, and App Store Connect
refuses a reused `CURRENT_PROJECT_VERSION` within a marketing version.
