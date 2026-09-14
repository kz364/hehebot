# Clawbot Portal for macOS

This directory is an independently written, remote-only Electron shell around the authoritative Clawbot web portal. It has no local agent, server, scheduler, task database, wake loop, preload bridge, or renderer IPC. Closing the app does not cancel remote work; remote completion and history remain control-plane responsibilities.

## Install and run

Use Node.js 22.13 or newer. Dependencies and Electron are pinned in this directory's lockfile.

```sh
cd desktop
npm ci
npm test
npm start -- --portal-origin=https://portal.example
```

On first run, copy the complete portal origin to the clipboard and confirm it in the native setup dialog. The command-line argument remains available for automated setup. Configuration is saved under Electron's per-user `userData` directory as owner-only `portal-config.json` where supported. To switch later, use **Clawbot Portal → Switch Portal to Origin on Clipboard…**.

Cloudflare Access/OIDC login origins must be explicitly owner-configured: put one complete HTTPS origin per clipboard line and choose **Clawbot Portal → Configure Login Origins from Clipboard…**. Do not include paths or credentials. Trusted login redirects remain inside the portal's isolated persistent Chromium session so login cookies can be set; trusted pages still receive no native API. This local list is never learned from portal content. Each canonical portal origin uses a distinct session partition, so cookies do not cross portals. Portal HTTP is accepted exclusively for `localhost`, `127.0.0.1`, and `[::1]` tests; auth origins are always HTTPS.

## Security boundary

- Remote pages run with Chromium sandboxing and context isolation, without Node integration, a preload script, webviews, or IPC.
- Permission requests, file selection, downloads, HTTP basic-auth prompts, and popup windows are denied. The shell exposes no filesystem, OS credential, clipboard, or process API to a page.
- Exact-origin navigations and explicitly configured HTTPS login redirect chains stay in the shell. Arbitrary remote redirects and automatic cross-origin navigations are blocked and are not opened in the OS. The explicit **Open Link in Default Browser** context-menu action is available for external HTTPS and `mailto:` links. HTTP non-loopback, credential-bearing URLs (including same-origin URLs), `file:`, `javascript:`, and other schemes are denied.
- The shell makes no wake request and performs no idle polling. Portal network behavior remains the portal's responsibility.
- Configuration is local and must not contain credentials. Portal authentication cookies remain in Electron's origin-isolated Chromium session.

The control plane must still enforce authentication, authorization, CSP, CSRF/origin checks, task identity, and revoked-login behavior. A desktop shell is not a substitute for server-side controls.

## macOS package

```sh
npm run pack:mac   # unpacked development app
npm run build:mac  # unsigned DMG and ZIP
```

Outputs go to ignored `desktop/dist/`. `identity: null` is deliberate: this repository **does not claim signing or notarization**. Public distribution requires a maintainer-controlled Apple Developer identity, hardened-runtime/entitlement review, notarization, stapling, and validation on supported Intel/Apple Silicon Macs. There is no updater or notification implementation in this bounded shell.

## Verification and provenance

`npm test` includes mocked Electron event tests for redirect/login/external-navigation behavior, plus hostile configuration/origins, isolated partitions, private config, renderer sandbox/Node/IPC denial, file and permission denial, and absence of local process/polling code. Linux Electron launch checks do not establish macOS acceptance. Run package launch/login/origin-switch/revocation/external-link checks on actual macOS before release.

All source in `desktop/` is newly and independently written for this repository. No OpenMausBot, Gawk, Rakazo, enterprise, copied Apache source, logos, or other third-party application assets are included. Packaged third-party npm dependencies retain their own licenses; inspect `node_modules/**/LICENSE*` and the packaged dependency inventory as part of each release review.
