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

Trusted task/chat-scope issuance and Worker lease/revocation wiring, guided
installation, browser setup, pairing/reconnect/history coverage and sleep/cost
evidence remain open. Notification allowlists do not authorize tools. All mutation
tools stay unavailable by default; imported routines stay no-send.
