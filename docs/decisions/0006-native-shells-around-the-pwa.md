# ADR 0006: the mobile apps are native shells around the PWA

**Date:** 2026-09-19 · **Status:** Accepted · **Amends:** [design.md §1, §6.6](../design.md)

## Context

The design said "installable PWA, no native mobile app in v1". Installing a PWA is where that plan
runs out on a phone:

- **iOS.** Add to Home Screen is three taps behind a share sheet most people never open, and Safari
  evicts a site's storage — OPFS included — after roughly seven days without a visit. A family
  genome database that disappears over a holiday is not storage.
- **Android.** The install prompt is better, but there is still no listing anyone can find, and
  nothing to point a relative at.
- **Both.** A browser tab cannot be the thing a person keeps the family's health record in. The
  app has to be on the home screen because someone opened a store and installed it.

The alternative shape was a native port: Kotlin and Swift reimplementations of the importers, the
SQLite schema, the Mendelian checks, the retrieval and the dump container. That is what
`../../../sentio` does, and it earns it there — that app is sensors, and sensors are platform APIs.
Hearth is a parser, a database and a set of queries. Porting them would triple the surface of
exactly the code that must not be wrong, and then keep three copies of the privacy guarantee in
step for ever.

## Decision

`mobile/android/` and `mobile/ios/` are **native shells around the existing web build**. Each is one
screen holding one web view that runs `frontend/dist/`, copied into the app bundle by
`make mobile-web`. No native model layer, no bridge to the database, no second implementation of
anything. What each platform contributes is the four things a web app cannot do for itself:

| | Android | iOS |
| --- | --- | --- |
| A real origin | `WebViewAssetLoader` on `https://appassets.androidplatform.net/` | a loopback HTTP server on a fixed port (`LocalWebServer.swift`) |
| Picking a file | `WebChromeClient.onShowFileChooser` → the system picker | native, WKWebView handles `<input type=file>` |
| Saving a file | a JS bridge that streams the `Blob` to MediaStore (`Downloads.kt`) | `WKDownload` → the share sheet |
| Fitting the screen | window insets applied to the container view | SwiftUI's safe area |

**The origin is the load-bearing decision.** `file://` is an opaque origin and a custom
`WKURLSchemeHandler` scheme is not a trustworthy one; OPFS, IndexedDB and the service worker are
partitioned per origin and unavailable to both. Loading the bundle that way would silently drop the
SQLite VFS back to memory, and every import would vanish when the app closed — the worst failure
this project has, because it looks like it worked. So both platforms serve the same files over an
origin the engine accepts, with no network behind it.

The iOS port is **fixed, not "any free port"**, for the same reason: the origin *is* the storage
identity. A port chosen at launch would give the app a new origin every run and orphan the whole
database. When 17800 is taken the app says so and stops.

## Consequences

- **One codebase for everything that matters.** A parser fix ships to web, Android and iOS in the
  same commit. The privacy guarantee is still enforced in one place, `frontend/src/egress/`, and
  the Vitest test that asserts nothing else calls `fetch` still covers the phones.
- **The apps are as good as the web app is on a small screen**, and no better. Responsive layout
  work in `frontend/` is what improves them.
- **Two store identities to hold.** Both are placeholders in this repository (`example.hearth.app`)
  and must be replaced with a domain the publisher owns before the first upload; Play and App Store
  Connect both fix the identifier permanently at that point.
- **The Android WebView is a dependency the user updates.** OPFS synchronous access handles need
  Chromium 108+, so the app checks at launch and refuses to run on anything older rather than
  falling back to a memory database.
- **No push, no background work, no native sync.** Nothing in the design wants them, and each would
  be a reason to hold data outside the web app.
- **Revisit if** a feature needs a platform API the web cannot reach at all (health-kit style
  imports, a background folder sync). That would be one native module beside the shell, not a port.
