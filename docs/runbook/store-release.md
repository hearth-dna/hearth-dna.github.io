# Publishing the mobile apps

Both apps can be published to Google Play and the App Store under your own developer account
without a single credential entering this repository. Everything a release needs arrives from the
environment: the gitignored root `.env.local` locally, GitHub secrets in CI. A reader with the full
source and none of your secrets can build and run the apps, and can publish nothing.

`make mobile-secrets` prints which inputs are set, by name and status only — never a value.

## What lives where

| Input | What it is | Where it lives | Never |
| --- | --- | --- | --- |
| `HEARTH_APPLICATION_ID` | the published id, reverse-DNS of a domain you own | `.env.local` / CI secret | in git — the committed default is `example.hearth.app` |
| Upload keystore | the Play signing key | `~/.hearth/hearth-upload.jks` + an offline backup | in git; `*.jks` is gitignored as a backstop |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | keystore credentials | `.env.local` / CI secrets | on a command line (`ps` is world-readable; `make` passes them through the environment) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API credentials | a file outside the repo | in git |
| `APPLE_TEAM_ID` | your Apple developer team | `.env.local` / CI secret | in git — `ExportOptions.plist` is generated from the `.example` at export time |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` | App Store Connect API key (`.p8`) | `.env.local` + a file outside the repo | in git |
| `HEARTH_SOURCE_URL` | where the source is published; Settings links to it, as the AGPL-3.0 asks of whoever distributes the app | `.env.local`; CI uses the repository it runs in | in git. Store builds refuse to build without it |

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
cp .env.example .env.local      # fill in HEARTH_APPLICATION_ID and the ANDROID_* values
make android-keystore           # once, ever
make android-bundle             # copies the strings and kb, builds the signed AAB, verifies it
make android-publish            # → Play internal track
make android-publish TRACK=production ROLLOUT=0.1
```

`android-verify` runs inside `android-bundle` and refuses an AAB that is unsigned or still carries
the placeholder id. `android-publish` uploads the binary only: the store listing, screenshots and
description are never touched by a build push, so a routine release cannot overwrite them.

Play publishing needs the app to exist and a service account that may release it:

1. **App.** Play Console → Create app, with `HEARTH_APPLICATION_ID` as the package name. Once it
   exists, the first bundle can go up through the API like every later one.
2. **Service account.** In a Google Cloud project of your own, enable the Android Publisher API,
   create a service account and download a JSON key for it:

   ```bash
   gcloud services enable androidpublisher.googleapis.com --project <project>
   gcloud iam service-accounts create android-play-publisher --project <project>
   gcloud iam service-accounts keys create ~/.hearth/play-service-account.json \
     --iam-account android-play-publisher@<project>.iam.gserviceaccount.com
   ```

3. **Access.** Play Console → Users and permissions → Invite new users: the service account's
   email, this app only, with the two *Releases* permissions. It needs no Google Cloud role.

Point `PLAY_SERVICE_ACCOUNT_JSON` at the key file and keep it outside the repository.

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
   Distribution. On a Mac signed in to Xcode, `make ios-ipa` then signs automatically. With only
   an API key that works for an *Admin* key alone, because the export asks Apple for a
   cloud-managed certificate; with an App Manager key, create an *App Store* provisioning
   profile for the app id and set `IOS_EXPORT_PROFILE` to its name, which is what CI does.

   Without a Mac the same certificate is made with `openssl`, which is all CI needs: generate a
   key and a signing request, upload the request under Certificates → + → Apple Distribution (or
   `POST /v1/certificates` with the API key), download the `.cer`, and pack both into a `.p12`.
   The explicit algorithms matter: the `security` tool on the runner cannot read OpenSSL 3's
   default encryption.

   ```bash
   openssl genrsa -out dist.key 2048
   openssl req -new -key dist.key -subj "/CN=Hearth Distribution" -out dist.csr
   # ...upload dist.csr, download distribution.cer...
   openssl x509 -inform DER -in distribution.cer -out dist.pem
   openssl pkcs12 -export -inkey dist.key -in dist.pem -out dist.p12 \
     -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
   ```

### Every release

```bash
make ios-ipa          # assets → archive → export → verify
make ios-testflight   # upload (NOTES="what changed" sets the TestFlight note)
make ios-testflight-status   # has Apple finished processing it?
make ios-submit       # submit that build for App Store review (RELEASE=auto releases on approval)
```

`ios-submit` reads `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` from `project.yml`, so it
submits the build this checkout uploaded. It creates the App Store version in the Console if it is
missing, waits for Apple to finish processing the build, attaches it and submits. By default an
approved build waits for *Release* in the Console; `RELEASE=auto` releases it at once.

The **first** submission needs the listing filled in by hand in the Console: description,
screenshots, support and privacy policy URLs, the App Privacy answers, age rating, category and
price. `ios-submit` never uploads metadata, so until those exist Apple rejects the submission and
the error names what is missing. Later releases reuse them.

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
run. It reads the same names as `.env.local`, from repository secrets:

| Secret | Value |
| --- | --- |
| `HEARTH_APPLICATION_ID` | the published id |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ~/.hearth/hearth-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | keystore credentials |
| `PLAY_SERVICE_ACCOUNT_JSON` | the whole JSON document |

The keystore is written to a temporary file that exists for the length of the job. Without the
secrets the workflow builds nothing and says which one is missing, so a fork can never run it.

`.github/workflows/ios-release.yml` is the App Store counterpart, on a `macos-26` runner. It runs
only on a tag or by hand. Standard runners are free for a public repository; on a private one a
macOS minute is billed at ten times an ubuntu minute. The `publish` input picks how far a run goes:
`none` (build and verify, keep the `.ipa`), `testflight` (`make ios-testflight`) or `app-store`
(also `make ios-submit`, with the `release` input as `RELEASE`). A tag push has no inputs and
publishes nothing. Running the workflow by hand needs write access to the repository, and forks
never receive the secrets.

| Secret | Value |
| --- | --- |
| `HEARTH_APPLICATION_ID`, `APPLE_TEAM_ID` | as in `.env.local` |
| `IOS_DIST_CERT_BASE64` | the Apple Distribution certificate and private key, exported from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `IOS_DIST_CERT_PASSWORD` | the password you set on that `.p12` |
| `IOS_PROFILE_BASE64` | an *App Store* provisioning profile for the app id and that certificate (Profiles → +, or `POST /v1/profiles`), base64 of the `.mobileprovision` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | as in `.env.local` |
| `ASC_KEY_BASE64` | `base64 -i AuthKey_XXXX.p8 \| pbcopy` |
| `HEARTH_GOOGLE_IOS_CLIENT_ID`, `HEARTH_DROPBOX_APP_KEY` | optional; unset leaves that cloud backup button out |

The export signs manually with that certificate and profile. Xcode's automatic export signing
would ask Apple for a cloud-managed certificate instead, which needs an *Admin* API key; this way
the key stays at App Manager. Both expire after a year and are replaced together.

The certificate is imported into a **throwaway keychain** created for the job and deleted in an
`always()` step, and the `.p8` is written to `$RUNNER_TEMP` and removed with it — neither touches
the runner's login keychain or the workspace. The `.ipa` is not kept as an artifact: it embeds the
provisioning profile, which names the Apple team, and a public repository's artifacts are public.

## Version numbers

Android reads `mobile/android/version.properties` (`VERSION_NAME`, `VERSION_CODE`); iOS reads
`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `mobile/ios/project.yml`. Bump both in the
same commit as the release. Play refuses a `VERSION_CODE` it has seen before, and App Store Connect
refuses a reused `CURRENT_PROJECT_VERSION` within a marketing version.
