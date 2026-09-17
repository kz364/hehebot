# Isolated WhatsApp dependency graph

This is a locked installation input, not an enabled connector. It does not start
Chrome, pair WhatsApp, register tools or authorize chat access. Do not run the
upstream CLI until those separate gates are satisfied.

`node scripts/verify-wappmcp.mjs` from the repository root copies these inputs into
a disposable directory, runs `npm ci --ignore-scripts --no-audit --no-fund`, checks
the exact plugin/dependency/patch and applies only the owner-approved patch using
`git apply`. It compares pristine and patched source bytes against the independently
SHA256-pinned tarballs, then deletes the installation. No lifecycle scripts run;
in particular neither upstream `patch-package` nor browser-download scripts run.
The `.npmrc` is additional protection, not permission to run other scripts.

## Optional local preparation, without enabling

From the repository root, explicitly choose a **new** directory under an existing
private parent, preferably outside Git:

```sh
node scripts/verify-wappmcp.mjs --prepare /absolute/existing-parent/new-directory
```

This downloads/installs the locked graph and runs the same pinned artifact, exact
approved patch and synthetic positive/negative checks as the disposable verifier.
Only after all checks pass does it retain `new-directory/installation`. Existing
directories (even empty), files and symlinks are refused; there is no in-place
upgrade, overwrite or repair. A normal failure removes only the new staging
directory. An interrupted process may leave staging behind; inspect it manually
and use a different new destination rather than treating it as prepared.

The destination is mode 0700; `installation/hehebot-preparation.json` is mode 0600.
The receipt records `prepared-not-enabled`, the lock hash, observation time and
verification results. `installed:true` means files retained at that path only.
`processStarted:false` refers to the real connector, not synthetic test processes.
Readiness remains blocked, pairing/tool registration/production admission remain
false. The receipt is historical evidence, not a signature, full-tree attestation,
fresh inventory or authorization: later changes require fresh verification.
No account profile, credentials, browser download or real WhatsApp process is
created. npm uses disposable HOME/cache/config and an allowlisted environment;
Git cannot discover the surrounding repository when applying the approved patch.
Temporary source trees, synthetic fixtures and npm cache are removed, not retained.

Do not run the retained CLI or manually register it in Codex. Supported startup,
process supervision, reviewed recent-read compatibility and separately authorized
pairing still need implementation/verification. Do not ship this directory or an
image containing it as an approved distribution: `licenseAuditComplete` and
`redistributionApproved` remain false. Existing evidence includes unresolved LGPL
WebAssembly source/notices, native prebuild provenance, Public Domain rights and
vendored code/assets; see [license evidence](../../docs/WAPPMCP_LICENSE_EVIDENCE.md).
No pins, dependency graph or patch exception change in prepare-only mode.

## Compatibility remains blocked

The verifier also runs the actual locked MCP SDK 1.30.0 and the upstream JSON
result helper against a synthetic in-memory server. **Recent-message reads are
incompatible on this path:** the plugin returns an array in `structuredContent`,
but the SDK requires an object. Object-shaped scoped search passes. The verifier
reports `syntheticCompatibility:false`; a passing negative contract is not plugin
readiness. Do not bypass result validation, silently substitute search for recent
history, or add a dependency patch under the existing narrow patch exception.
An upstream-compatible fix/version needs review and the compatibility rerun.

The public ESM `WhatsAppMcpServer` factory also runs over a synthetic two-method
session and in-memory SDK: exact 22-tool catalog, eight schema rejections and
26 host denials pass. Scoped search routes correctly; actual recent reads fail
server-side SDK result validation. No `WhatsAppSession` is constructed, channels
are disabled and no mutation callback runs. Public transport closure is not
browser/session settlement. See [public-server evidence](../../docs/WAPPMCP_PUBLIC_SERVER.md).

Abort, SDK timeout and connection close all reject the client call while a handler
that ignores cancellation can remain pending. The journal retains unknown intent
and rejects replay even after the handler later returns. This is actual SDK
in-memory evidence, not stdio, Chromium descendant termination or safe sleep.

The verifier additionally starts a bounded synthetic stdio server and descendant
on Linux. It independently confirms the direct server stopped after SDK close,
then observes the descendant still making progress. The retained read remains
unknown and cannot replay. Fixture cleanup separately stops that descendant and
checks its PID/start-time is no longer executing. No real plugin or browser starts;
this negative contract does not verify a production process-tree supervisor.

The pinned shutdown fixture exercises actual signal/destroy primitives with
synthetic children and retains a disposable LocalAuth profile without logout.
It does not prove graceful CLI shutdown: the pinned CLI unconditionally unregisters
signal handlers in `finally`, including after successful ready/keep=true return.
The five-second destroy fallback can return before browser termination, and
concurrent destroy calls need not await each other. See
[shutdown evidence](../../docs/WAPPMCP_SHUTDOWN.md). CLI lifecycle, descendant
settlement and E09 completion remain unverified; no additional patch is authorized.

Pins: wappmcp 0.4.0, source revision
`9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8`; whatsapp-web.js exactly 1.34.7.
The only approved patch is that revision's
`patches/whatsapp-web.js+1.34.7.patch`. No patch changes are authorized here.
The npm v3 lockfile fixes 350 package locations with registry URLs and SHA512
integrities. Generated with Node 26.5.1/npm 10.9.9; upstream requires Node 24+.
This is not a browser binary/OS image lock or supply-chain signature attestation.

## Distribution review remains open

Lock metadata inspection on 2026-09-16 found:

- 283 MIT, 25 ISC, 17 Apache-2.0, 8 BSD-2-Clause, 6 BSD-3-Clause entries.
- 4 BlueOak-1.0.0, 1 Python-2.0, 1 0BSD, 1 `(MIT OR CC0-1.0)`.
- `node-webpmux` declares **LGPL-3.0-or-later**. Review redistribution and linked
  assets/obligations; do not describe the complete graph as permissively licensed.
- `jsonify` declares `Public Domain`, requiring source/license review.
- `qrcode-terminal` and `fluent-ffmpeg/node_modules/async` have no lockfile license
  metadata. Absence is unknown, not approval or evidence of no license.

These are package declarations, not a completed source, dependency, binary,
asset or notice audit. Preserve required upstream notices; review the exact
locked sources before distribution. The verifier intentionally reports
`licenseAuditComplete:false`. Version/patch changes require compatibility and
authorization reruns; changed patches require renewed owner approval.

Worker task/chat grants and lease/revocation checks exist. Trusted MCP transport
wiring, guided installation, browser setup, pairing/reconnect/history coverage and sleep/cost
evidence remain open. Notification allowlists do not authorize tools. All mutation
tools stay unavailable by default; imported routines stay no-send.
