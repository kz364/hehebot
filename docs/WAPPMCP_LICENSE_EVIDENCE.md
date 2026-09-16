# WhatsApp dependency artifact evidence — redistribution review required

Collected 2026-09-16 from public npm tarballs for the existing isolated lockfile.
This advances E09/E13 evidence only. It is **not a legal audit, redistribution
approval, connector installation, or production gate change**. No accounts,
pairing, lifecycle scripts, upstream CLI, browser downloads or patch changes were
used. No upstream source or binaries are added to this repository.

## Reproduce the inventory, not an approval

Requires the repository's Node runtime and Python 3 standard library. Run from
the repository root:

```sh
node --test tests/audit-wappmcp-licenses.mjs
node scripts/audit-wappmcp-licenses.mjs > .local/wappmcp-license-inventory.json
# Expected exit 2: evidence collected, review required. Exit 1: collection failed.
sha256sum .local/wappmcp-license-inventory.json
```

The auditor reads the lockfile, fetches only public `registry.npmjs.org` HTTPS
artifacts without redirects, verifies SHA512 SRI **before** decompression, checks
package name/version (including explicit npm aliases), and hashes individual
files. Tar contents stay in bounded process memory: nothing is extracted to the
filesystem. Python runs isolated (`-I`); no package code is imported or executed.
Traversal/absolute paths, canonical duplicate names, links and special files
are rejected after PAX/GNU filename resolution. Per-package inspection errors
remain visible, never silently omitted. Download/SRI failures abort collection.
Compressed/expanded sizes, member size/count and subprocess time are bounded.
Interior dot aliases are normalized for collision detection while retaining their
original archive names; no files are extracted or overwritten.

Output is sorted, timestamp-free JSON with the lock hash, artifact URL/SRI/SHA256,
declarations, legacy `licenses`, repository metadata, scripts as **data**, file
paths/hashes/sizes, notice text and short header-line evidence. The scanner uses
filename/magic heuristics, not a license classifier: first-4-KiB header lines and
at-most-64-KiB named notices are not exhaustive source inspection. Truncated
notices are flagged. Every result remains `review-required`; MIT metadata never
becomes approval. Do not treat a shell wrapper accepting exit 2 as a release gate.
Generated reports contain public notice material; keep them local or in a reviewed
release-evidence archive, not a new vendored dependency tree.

Observed verification:

- `node --test tests/audit-wappmcp-licenses.mjs`: **7 passed, 0 failed**. Negative
  controls cover changed/appended/empty bytes, missing/weak SRI, misleading or
  missing metadata, identity mismatch, traversal/PAX paths, links and duplicates.
  Synthetic upstream source and postinstall traps are inventoried, never executed.
- Auditor: **exit 2, review-required**, all **350 locations SRI-verified**;
  **340 inspected locations / 15,613 file records / 40 binary-magic candidates**.
  Ten artifacts have explicit inspection errors (below). This is not a claim of
  complete file or legal coverage for 350 packages.
- Lock SHA256: `15bf32b13594d9a38fd9d36e59a93d1433a0f077320d253e3b2209eb39df4ddf`.
- Integrated inventory SHA256: `223988df5d6596f60b9b8a1f1157fdc97cccec4134a5a77cf164af40721550a5`.

The integrated parser detects canonical duplicate paths in `agent-base`,
`data-uri-to-buffer`, `degenerator`, `get-uri`, `http-proxy-agent`,
`https-proxy-agent`, `pac-proxy-agent`, `pac-resolver`, `proxy-agent` and
`socks-proxy-agent`. Allowing interior `.` aliases did not resolve these errors:
the canonical paths collide. These errors come from SRI-verified tar streams.
This is an **inventory limitation**, not evidence that those packages are malicious
or unlicensed. Before claiming full coverage, independently inspect their original
member names and canonical-path collisions; do not silently normalize/overwrite
aliases during extraction. Their exact artifact identities remain in the report.

## Exact locked artifacts resolve some metadata gaps, not all obligations

All file paths below are relative to the package's tarball root. Registry URLs,
versions and SRI come from `config/wappmcp/package-lock.json`, not a mutable `latest`
tag. SHA256s below independently identify the fetched bytes; SRI identifies them
against the checked-in input. This is not publisher signature/source attestation.

| Artifact source | Tarball SHA256 |
| --- | --- |
| [node-webpmux 3.2.1](https://registry.npmjs.org/node-webpmux/-/node-webpmux-3.2.1.tgz) | `3b0fe96a91507797ee2ffdd6b569a60fed9739f5b0c08cc37ba5776319b31d7b` |
| [jsonify 0.0.1](https://registry.npmjs.org/jsonify/-/jsonify-0.0.1.tgz) | `3812e6415dc7c4e8dc5a6171a328557e624bce0c88079354f08ef0bde7812bac` |
| [qrcode-terminal 0.12.0](https://registry.npmjs.org/qrcode-terminal/-/qrcode-terminal-0.12.0.tgz) | `3a6260c4e0d80bd527a3f930e90ea2348c03646621f25aa0bd960ee205a0a706` |
| [async 0.2.10](https://registry.npmjs.org/async/-/async-0.2.10.tgz), nested under fluent-ffmpeg | `46869f9efcfc4045217c7730f65a81f85b518a0765d14f931ddb70581afb644c` |

### node-webpmux includes LGPL code and compiled WebAssembly

`COPYING.LESSER` is LGPLv3 (SHA256
`e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118`).
`webp.js`, `parser.js`, `io.js`, `libwebp.js`, `libwebp/binding.cpp`, examples and
`bin/webpmux` contain ApeironTsuka 2023 copyright and LGPLv3-or-later headers.
**`bin/webpmux` is a Node script, not a native executable.**

The tarball's 12 files also include generated `libwebp/libwebp.js` and
**`libwebp/libwebp.wasm`**, 380,544 bytes, SHA256
`b7cbd4613bb8a607a7b179ccfa7b33f901376b1ca40fd56bb46e3eb09dc74419`.
`libwebp/binding.cpp` SHA256 is
`279d5a4f77a93e80a387b7e5870291bd7203111b18995bdf90eb40621c000e02`.
The README's compilation paragraph attributes libwebp to Google's
`webmproject/libwebp` mirror and gives an `emcc` command referencing
`libwebp/src/{dec,dsp,demux,enc,mux,utils}/*.c` and `libwebp/sharpyuv/*.c`.
Those library sources are **not shipped in this tarball**. The paragraph supplies
neither an exact libwebp commit nor an Emscripten version. The generated JS hash is
`7beda27c5ab517934c8bcdd5325d02d21b7700d20ab2a3b6f60480623c06a577`.

Only `COPYING.LESSER`, not a full GPL text, libwebp license/patent notices or
toolchain notices, is present as a named license file. Do not infer that the LGPL
package declaration alone covers every compiled component. Obtain exact library
and toolchain provenance, their applicable notices, and corresponding source/build
instructions for the shipped WASM before redistribution. The shim alone is not
evidence of complete corresponding source.

LGPLv3's included text requires reviewing library notices and the accompanying GPL
and LGPL copies; modifications and combined works need the applicable source,
replacement/relinking, reverse-engineering and installation-information provisions
considered for the actual delivery form. Merely loading JavaScript dynamically
does not prove those obligations met. This is a compliance checklist, not a legal
conclusion about the whole application.

### jsonify's public-domain statement lacks a complete rights trail

The artifact's `package.json` and README say `Public Domain`/`public domain`.
The README attributes the implementation to Douglas Crockford and links `LICENSE`,
but the **10-file tarball has no LICENSE**. Direct inspection of `index.js`,
`lib/parse.js` and `lib/stringify.js` found no embedded license/copyright statement.
README SHA256: `1c5c071519aa740a5f69212af7891f63f4cdaad595f7a91e8d391c485f3de97f`;
parse: `1a31c8d1e82411b4e4cc0ae9722a17033b09f2c1c03b3edcb570a9ba29c2c105`;
stringify: `52eee6fd1e5be1748387d5df3bdebc5d680ea4ad434fa5b9e81c7bb5e54b936d`.

Keep the attribution and establish the exact source/dedication and contributor
rights for this version, including applicable jurisdiction treatment of public
domain. Do not replace that investigation with a CC0/MIT assumption or infer a
restriction from unrelated Crockford software. A current repository's license
would not alone establish the rights of these locked bytes.

### qrcode-terminal includes Apache-2.0 and a separate vendored MIT attribution

The missing modern `license` field is not absent licensing: legacy `licenses`
declares Apache 2.0, and `LICENSE` contains Apache-2.0 plus an attribution appendix
for **QRCode for JavaScript, Copyright (c) 2009 Kazuhiko Arase**, marked MIT.
The appendix names `vendor/QRCode`, modifications for Node/refactoring and the QR
Code trademark. `vendor/QRCode/index.js` repeats that attribution and modification
statement. It is not an additional npm package in the lockfile.

`LICENSE` SHA256: `b3c7a2fadb2515b8106eae58439a4b9c0581a4eaa88d6a265701f8d4dd7dadb8`;
vendored entry: `7377be90fc61a40268acf7f30d5bd89c2fca99c57ef5391623de8c151b8da7df`.
The MIT declaration links to the license rather than including its full permission
text. Resolve and ship the applicable MIT text/attribution alongside Apache-2.0;
preserve source notices and modification notices. Apache §4's NOTICE requirement
is conditional: no separate NOTICE file was present here; the appendix still
must not be discarded. Do not reuse upstream branding. The archive also contains
`example/basic.png` (SHA256
`7ebca694acacd1f9affc2c8f175506cb60b2fd014939a2127a19ac239b21d445`); review its
asset provenance if shipping examples rather than presuming code terms suffice.

### async 0.2.10 includes a full MIT license

At `node_modules/fluent-ffmpeg/node_modules/async`, legacy `licenses` declares MIT;
`LICENSE` contains the full grant, copyright **2010 Caolan McMahon**, inclusion
condition and disclaimer. SHA256:
`b04b9e208e566fa898c7429e4dd5b45ba3ba2f7391e5c009cf63c53d580fa9b4`.
Preserve the copyright/permission notice in copies or substantial portions.
This resolves that metadata gap with actual artifact evidence; it is not approval
for fluent-ffmpeg, FFmpeg binaries, or the entire graph.

## Wider graph and remaining release work

The exact wappmcp 0.4.0 tarball hash remains
`f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8`;
its MIT LICENSE names Vaibhav Pandey 2026. whatsapp-web.js 1.34.7 remains
`714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c`, with
Apache-2.0 LICENSE. Preserve these texts and notices for the actual release.
The existing verifier owns comparison/application of the owner-approved patch
from [the pinned wappmcp revision](https://github.com/vaibhavpandeyvpz/wappmcp/commit/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8).
This auditor inventories pristine tarballs; a redistributed patched tree needs
its own modification notice/source manifest. No patch was applied here.

Beyond node-webpmux WASM, `bare-fs` 4.8.1, `bare-path` 3.1.2 and `bare-url` 2.5.4
each contain **13 platform `.bare` native prebuilds** (ELF, Mach-O or PE magic).
Their Apache declarations do not attest linked code or reproducible builds.
`bare-path/NOTICE` specifically includes Holepunch attribution. Review exact
prebuild source/linkage and notices for every platform actually redistributed.
The inventory includes optional and non-host-platform packages; it does not
silently remove their obligations from an all-platform tarball distribution.

Before redistribution, the owner must choose the delivery boundary (source-only
self-host setup, customer-specific installation, or a shipped runtime/image) and
decide whether to retain the LGPL component with reviewed compliance materials or
authorize a separately reviewed replacement. No replacement/graph change is made
or authorized by this evidence. Qualified review must close the WebAssembly source
and notice gaps, jsonify rights trail, vendored QR/asset notices, native prebuilds,
ten parser exceptions and remaining source/header/asset coverage. Produce and
verify a third-party notice/source bundle against the **actual released files**.

Browser binaries fetched by later Puppeteer installation, system libraries, FFmpeg,
downloaded runtime assets, WhatsApp content/branding, service terms and model/account
eligibility are outside this npm-artifact inventory and need separate evidence.
No gate should be marked passed from this document or from package license counts.
