# mobile/ — the Android and iOS apps

Both apps are the same PWA in a native window: one `WebView` on Android, one `WKWebView` on iOS,
each serving `frontend/dist/` from inside the app over a real, network-less origin. There is no
native model layer on either side, and there must not be one — the genome, the pedigree, the health
log and every analysis live in the web app's SQLite database, inside the web engine's own storage.
The reasoning is [ADR 0006](../docs/decisions/0006-native-shells-around-the-pwa.md); read it before
changing anything structural here.

## The one structural rule

> **If it touches the family's data, it belongs in `frontend/`, not here.**

What is left for a shell is small, and each piece has a reason it cannot be done in the page:

| | `android/` | `ios/` |
| --- | --- | --- |
| Serving the app | `WebViewAssetLoader`, `https://appassets.androidplatform.net/` | `LocalWebServer.swift`, `http://127.0.0.1:17800/` |
| Picking a file to import | `WebChromeClient.onShowFileChooser` | nothing — WKWebView does it |
| Saving an export | `Downloads.kt` → MediaStore | `WKDownload` → the share sheet |
| Backup place | `Files.kt` → Storage Access Framework (folder or single file) | `NativeFiles.swift` → Files picker, security-scoped bookmarks, the iCloud container |
| Cloud sign-in | `Cloud.kt` → Play services (Google), PKCE in the browser (Dropbox) | `Cloud.swift` → PKCE in `ASWebAuthenticationSession`, Keychain |
| Screen fit | edge to edge; insets (bars, cutout, keyboard) pad the container, painted in the web app's bar colour | edge to edge; the page pads itself with `env(safe-area-inset-*)` |
| Links off-origin | `shouldOverrideUrlLoading` → browser | `decidePolicyFor` → Safari |

## Look and feel

The native feel is web work, in `frontend/src/styles.css` (the phone layer at ≤ 640px): a compact
top bar, a bottom tab bar (`components/TabBar.tsx`), 44pt/48dp touch targets, dialogs as bottom
sheets. `app/platform.ts` puts `data-platform="ios|android"` on `<html>`, so the same build draws a
translucent iOS tab bar on an iPhone and a Material 3 navigation bar on Android. The shells' only
part is to get out of the way: draw edge to edge, and match the bars and launch colours.

## Build and run

```bash
make mobile-web       # build the PWA and copy it into both app bundles — nothing builds without it
make android          # build + install the debug APK on a connected device or emulator
make android-test     # the shell's unit tests (JVM, no device)
make android-logs     # follow the app's logs
make ios              # build and run on a simulator (macOS + Xcode + xcodegen)
make ios-test         # the shell's unit tests (simulator)
```

Neither `app/src/main/assets/web/` (Android) nor `Hearth/Web/` (iOS) is in git: both are copies of
`frontend/dist/`, made by `make mobile-web`. Nor is `Hearth.xcodeproj` — it is generated from
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

## What the shells deliberately do not have

No push notifications, no background work, no native sync (the backup place is file I/O through the
system picker, driven by the web app — ADR 0008; cloud sign-in hands the web app tokens and nothing
else — ADR 0009), no analytics, no crash reporter, and no third-party SDK beyond Play services'
sign-in client (ADR 0009). Android asks for exactly one permission (`INTERNET`, for the web app's
BYOK Ask call and cloud backups) and turns off `allowBackup` so that Android's own cloud backup
cannot copy the database off the device.
