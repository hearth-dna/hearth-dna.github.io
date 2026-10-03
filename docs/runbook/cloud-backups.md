# Cloud backup buttons: setting them up

The phone apps show **Google Drive**, **Dropbox** and (iPhone) **iCloud Drive** buttons in
Settings → Backup only when the build was configured for them (ADR 0009). Everything below is
per deployment and lives in the gitignored root `.env`; nothing here is committed. `make
mobile-secrets` shows which are set.

## Google Drive

### The API, with gcloud

The **Google Drive API** (`drive.googleapis.com`) is the only API to enable. Google sign-in on
Android goes through Play services and on iOS through the OAuth endpoints, and neither needs an
API switched on. The project and account are yours; keep them out of the repository.

```bash
# The project behind an OAuth client: its id starts with the project *number*
# (<number>-<hash>.apps.googleusercontent.com). Find the project id for it, in whichever
# signed-in account owns it (`gcloud auth list`).
gcloud projects list --account=<you@example.com> \
  --filter="projectNumber=<number>" --format="value(projectId,name)"

# Enable the Drive API (idempotent), then check it.
gcloud services enable drive.googleapis.com --project=<project-id> --account=<you@example.com>
gcloud services list --enabled --project=<project-id> --account=<you@example.com> \
  --filter="config.name=drive.googleapis.com" --format="value(config.name,state)"
# → drive.googleapis.com  ENABLED
```

gcloud cannot do the rest: Android and iOS OAuth clients, the consent screen's scopes and its
test users exist only in the Console (APIs & Services → Credentials / OAuth consent screen, or
Google Auth Platform → Clients / Data access / Audience).

### The Console steps

1. Configure the OAuth consent screen (external, the `.../auth/drive` scope, a privacy policy URL
   on your domain).
   `drive` is a *restricted* scope (it lets the user choose any folder, ADR 0009): leave the app in
   **Testing** and add each person as a test user (up to 100; they see an "unverified app" warning).
   Publishing to everyone needs Google's verification plus a yearly security assessment (CASA).
2. **Android:** create an OAuth client of type *Android* for each package and signing certificate
   that should sign in — `<HEARTH_APPLICATION_ID>` with the upload/app-signing key's SHA-1, and
   `<HEARTH_APPLICATION_ID>.debug` (or `example.hearth.app.debug`) with the debug key's SHA-1
   (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android`). No id goes into the
   app; Google matches the package and certificate. Then set `HEARTH_GOOGLE_DRIVE=1`.
3. **iOS:** create an OAuth client of type *iOS* for the bundle id and set
   `HEARTH_GOOGLE_IOS_CLIENT_ID=<id>.apps.googleusercontent.com`.

Without step 2, the Android button answers "Google sign-in is not set up for this build".

## Dropbox

Create an app at dropbox.com/developers with **App folder** access and the `files.content.read`,
`files.content.write` and `account_info.read` permissions. Add the redirect URI
`db-<app key>://2/token`. Set `HEARTH_DROPBOX_APP_KEY=<app key>` (public by design; there is no
secret, sign-in is PKCE).

## iCloud Drive (iOS)

Enable **iCloud → iCloud Documents** on the App ID with the container `iCloud.<bundle id>`. The
entitlement and `NSUbiquitousContainers` are generated from `project.yml`; the button appears when
the device is signed in to iCloud with iCloud Drive on.

## Checking it

`make android` / `make ios`, then Settings → Backup: tap the button, sign in, enter a passphrase and
press *Back up now*. The backup appears as `Hearth/` in My Drive, `Apps/<app name>/` in Dropbox, or
`Hearth` in iCloud Drive — encrypted files only.
