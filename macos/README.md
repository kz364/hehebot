# Hehebot native macOS source foundation

Independent SwiftUI + WKWebView remote-only client for the same HTTPS portal. This is **source awaiting macOS compilation and acceptance**, not a released replacement for `desktop/`. No upstream application code, assets, branding, npm dependencies, Chromium, local agent, task database, scheduler, command queue or model credentials are included. Apple SDK frameworks and the Swift standard library are the only dependencies.

The minimum deployment target is **macOS 14.0**, with **Xcode 15 / Swift 5.9 / macOS 14 SDK or newer** for building. This is a real API requirement: [`WKWebsiteDataStore.init(forIdentifier:)`](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/init(foridentifier:)) became available on macOS 14. Do not lower the target by substituting the shared default store or private WebKit APIs. API availability is documented; compatibility has not been demonstrated on Mac hardware.

## Native behavior

- One SwiftUI portal window, standard application/Edit/Window menus, a Portal menu, and a native Settings window. No full native chat renderer.
- First run is disconnected. Configure the portal and explicit login origins in Settings, save, then choose **Connect to Portal**. Persisted settings are validated on launch, but launch does not connect automatically.
- Configuration is non-secret `UserDefaults` data in `com.hehebot.native-portal`; never enter tokens or credentials. HTTPS origins only, no path/query/fragment/userinfo, no whitespace, wildcard, Unicode hostname, or IPv6 literal. ASCII punycode names are permitted. Port 443 and host case normalize; other ports remain distinct. No loopback HTTP exception.
- Changing the portal field clears the proposed login list. Saving validated settings destroys the current view without carrying navigation history into the new configuration. Each canonical portal origin selects a deterministic SHA-256-derived 128-bit data-store identifier; login origins use that portal's store, not a global identity-provider cookie jar. Returning to a portal intentionally reuses its store.
- **Lock Session** destroys the local view; it is not server logout or cookie erasure. Closing the window/application never cancels remote tasks. Website cookies and storage stay with WebKit; the app does not read or export them.
- **Open Portal in Default Browser** is the only OS URL-opening path. It opens only the configured portal root after a native menu click, not the current page, a redirect, a query token, or a page-supplied link. External links in the page are blocked, even after a click. Use the separate browser for file import/export and workflows needing permissions; its login is separate.

## Security boundaries and intentional restrictions

Navigation actions (including frames) and navigation responses must have the exact configured HTTPS portal or an explicitly configured HTTPS login origin. No origin is learned from page content. Popups/new windows are rejected even for trusted origins. Attachment responses, unrenderable MIME types, explicit downloads, file pickers, file drag/drop, default WebKit context menus, JavaScript dialogs and media capture requests are denied. TLS trust stays with the OS; HTTP authentication and client-certificate requests are cancelled. There is no page-to-native message handler, custom URL-scheme handler, filesystem/process/credential bridge, or permissive TLS/ATS override.

`Permissions.js` removes privacy-sensitive web entry points at document start in all frames, including geolocation, clipboard APIs, media, notifications, motion, hardware APIs, file pickers and credential/passkey APIs. It adds no host capability. This is **defense in depth, not a universal WebKit permission delegate or an OS security boundary**. macOS 14 does not expose a supported catch-all permission-denial callback. The intended signed app uses only App Sandbox + outbound-network entitlements, with no location/camera/microphone/file-access/automation entitlement or privacy usage description. The unsigned build helper does **not** apply entitlements; do not treat that output as permission-accepted or use it for untrusted production pages. Actual permission denial, all-frame timing and context-menu behavior require hostile-page checks on macOS. The source does not use private preferences or beta geolocation delegates to conceal this gap.

The navigation allowlist is not a network firewall: portal scripts, fetch/SSE, service workers and subresources remain subject to WebKit and the portal/server's CSP, authentication and authorization. Server-side protections are required even for trusted login origins. Stricter UI denial intentionally may break popup SSO, passkeys, JavaScript-confirmed portal operations, or browser permission-dependent workflows. Cookie/SSO parity is **not claimed**.

Routine Delete now uses the portal's accessible editor rather than `window.confirm`.
The Chromium fixture (`node scripts/test-portal-routine-delete.mjs`) verifies explicit
acknowledgement, keyboard cancellation/submission, stale/offline rejection and
same-editor idempotent retry with native confirmation unavailable. This resolves
the source compatibility gap, not real WKWebView routine-management acceptance.
Do not enable arbitrary page-to-OS access to hide remaining gaps.

Navigation-level 401/403 responses discard the view and display a rejected-session message. TLS/network failures and WebKit content-process termination also stop rather than automatically reload. Reconnect always creates a fresh view and GETs the configured root; it never calls reload/back, replays a POST, submits a task, retries an effect or infers task completion. A network failure may follow a successfully admitted command: inspect remote task history before resending anything. Login-origin redirects remain allowed so explicitly configured authentication can occur in the same store. The shell cannot see API fetch/SSE 401/403 responses through navigation delegates, or distinguish a server's 200 login page from normal content. API/session revocation and task reconciliation remain portal/control-plane duties; the native lock is available without trusting a page's login claim.

No shell polling, wake loop, stream integration, notifications or updater is implemented. Hidden-page activity remains WebKit/portal behavior; do not claim energy savings or release of every background stream from this source.

## Verification available without accounts

From the repository root:

```sh
node --test macos/tests/*.test.mjs
bash -n macos/scripts/build-app.sh
git diff --check
```

The Node suite executes the permission-removal JavaScript in a synthetic VM and checks deterministic source wiring/manifests. It does **not** execute Swift, simulate WebKit accurately, or prove runtime isolation. Four XCTest methods independently exercise actual Foundation-based origin/configuration/navigation/response policy, including hostile origins, non-default ports, popups, downloads and revocation boundaries:

```sh
swift test --package-path macos
```

On a Linux host with Swift 5.9+, the package excludes the native executable so these policy tests can run without Apple frameworks. Integration installed the official Debian 12 x86_64 Swift **6.3.3** toolchain locally and ran all **four XCTest methods successfully**. This compiles and executes the Foundation policy, not the SwiftUI/WebKit application. The orb still has no Xcode, Apple SDK, AppKit, SwiftUI or WebKit runtime. Native build/render remains unverified; Chromium screenshots would not be evidence for this UI.

The optional reproducible Linux setup is:

```sh
HEHEBOT_SWIFT_POLICY_TESTS=1 bash .agents/setup
.local/swift-toolchain/usr/bin/swift test --package-path macos
```

Setup uses a roughly 1 GiB archive, is opt-in, and does not alter the shell PATH.
The archive SHA256 is `19e0c78cad5418ad48bfa87aa20c53ac9ac9996d1695d04dd94f7c7ea4eb133f`.
Before pinning it, integration verified the upstream detached signature with the
Swift 6.x release key fingerprint `52BB7E3DE28A71BE22EC05FFEF80A866B47A981F`, obtained
from Swift.org's published keys. See the [official Debian downloads](https://swift.org/install/linux/debian/12)
and [signature/dependency instructions](https://www.swift.org/install/linux/tarball).
The compiler stays under ignored `.local/`; it is not shipped with the app.

Recorded credential-free verification, 2026-09-16, based on the owner's bundled local main [9479cb7](https://github.com/kz364/hehebot/commit/9479cb76955880779cc931036af002646e8279ea):

- `node --test macos/tests/*.test.mjs`: 5 passed, 0 failed (one executable JavaScript test plus four structural checks).
- `bash -n macos/scripts/build-app.sh`: passed. Python `plistlib` parsed both support property lists. Invoking the build helper on Linux exited 1 with the expected macOS/Xcode requirement and created no app.
- `npm ci --prefix desktop && npm test --prefix desktop`: 16 passed, 0 failed. The unchanged reference desktop dependency install reported 14 audit vulnerabilities (13 high, 1 critical); no dependency remediation is included in this macOS-only change.
- `bash scripts/verify-codex.sh`: exit 0, final `status: passed`, scope `credential-free Codex and control contracts`. Includes 53 test files / 1,154 application tests, 259 runtime tests, the scripted integration fixtures and a Worker build dry-run. Final `assistantOperational`, `productionAdmission`, and `modelJudgmentVerified` all remain false. This does not test the native app.
- Staged diff whitespace/scope checks accompany the handoff. Only the new `macos/` subtree is changed; no shared docs, portal, verifier, runtime or production gates are edited.

## Prepared Mac commands and later acceptance (not a request to run now)

On a separately authorized Mac development environment:

```sh
xcodebuild -version
swift --version
swift test --package-path macos
swift build --package-path macos -c release
bash macos/scripts/build-app.sh
plutil -lint macos/Support/Info.plist macos/Support/HehebotPortal.entitlements
```

The helper prepares `macos/dist/Hehebot Portal.app` plus its SwiftPM resource bundle, for the build host architecture only. It does not install, launch, sign, notarize, publish or create a universal binary. Open `macos/Package.swift` in Xcode for source inspection/debugging. Production packaging and separately approved development/distribution signing must apply the reviewed entitlements and validate resource lookup; a plist alongside an unsigned executable does not enable App Sandbox.

Before acceptance, record OS/Xcode/architecture, build/test output and inspected screenshots for initial setup, invalid settings, connected portal, login redirect, denied navigation, rejected session and reconnect states. Use disposable credential-free HTTPS fixture origins first. Verify:

1. Exact-origin/port decisions for redirects, frames, user links, `target=_blank`, `window.open`, custom schemes, userinfo, downloads, file inputs and drag/drop. None may launch an OS handler or reveal local files. Test context menus and keyboard shortcuts too.
2. Native browser action opens exactly the configured root once; page actions never call it. Verify settings save, window close/reopen, quit/relaunch and a configuration switch create the intended view rather than retaining the old `NSView`.
3. Synthetic cookies/localStorage in portal A and its login origin do not appear in portal B, including where both portals name the same identity-provider origin. Return to A and relaunch to test intended persistence. Check different ports separately.
4. 401/403, TLS rejection, offline/connection loss and content-process termination show conservative status without task resubmission. Test API-level revocation in the actual portal separately. Confirm reconnect only GETs the root; compare server-side command/effect receipts before and after.
5. Apply and inspect the intended sandbox entitlements only in a separately authorized signing workflow. Verify camera/microphone/location/clipboard/notification/passkey/hardware requests from top-level and child frames produce no unsolicited OS permission grant or prompt. A failure is a release blocker, not a reason to grant broader entitlements.
6. Accessibility/VoiceOver, menu focus, light/dark rendering and resizing; later, separately authorized real login/SSO/cookie lifecycle, Intel/Apple Silicon behavior and idle/hidden/closed CPU/memory/energy/stream teardown. None are established by Linux tests.

Signing, notarization, updates, notifications, account login, owner-Mac installation and energy acceptance remain unimplemented or unverified release work. No production execution/native-verification flag is changed. `desktop/` remains untouched as the reference contract.
