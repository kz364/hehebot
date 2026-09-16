# Actual public-server fixture, not connector admission

`scripts/test-wappmcp-public-server.mjs` exports
`verifyWappMcpPublicServer(installation): Promise<report>`. The caller supplies the
existing disposable, integrity-locked, scripts-disabled installation prepared by
`scripts/verify-wappmcp.mjs`. Shared verifier wiring and status belong to the host;
this fixture does not enable or install a connector.

The fixture uses the actual public ESM `WhatsAppMcpServer.create(session, false,
allowlist)` and `start(transport)`, with MCP SDK **1.30.0** in-memory transports.
Its session is a two-method synthetic object, not a constructed `WhatsAppSession`.
All other session property access throws and is recorded. No account, browser,
CLI, session start/destroy, mutation callback or channel permission relay runs.

Host integration, after its existing artifact/install/patch gates:

```js
import { verifyWappMcpPublicServer } from './test-wappmcp-public-server.mjs';
const publicServer = await verifyWappMcpPublicServer(installation);
```

## Evidence and boundaries

- Actual initialization reports `wappmcp` **0.4.0** and lists the exact **22-tool**
  catalog. The independent expected list includes mutation tools. Presence is not
  authorization: the host grant permits only selected-chat recent reads/search.
- Real input schemas advertise recent `chatId` as required and `limit <= 100`;
  search requires only `query`, so upstream's schema permits global search.
  **Eight invalid requests** return tool errors without entering either synthetic
  read method: missing/wrong chat, zero/101/fractional recent limit, missing search
  query, zero page and fractional search limit.
- Actual search routing is exactly `searchMessages('Synthetic meal', chatId, 3,
  17)`. The protocol result equals the synthetic object and its exact JSON text.
  Through `readWappMcp`, two asymmetric messages retain only ID/body/timestamp,
  with the exact query/page and `coverage: 'unknown'`; extra payload is discarded.
- Actual recent routing is `getChatMessages(chatId, limit)`, including explicit
  17, the accepted input boundary 100, and omitted `undefined`. The host boundary
  supplies its own default 50. **None is a successful recent read:** SDK result
  validation rejects array-shaped `structuredContent` on the server side and
  sends a protocol error, not a success result. The public `createJsonResult`
  helper is separately checked for its exact array/text result and its rejection
  by the real `CallToolResultSchema`. No schema bypass, result repair, private
  handler access or substitution of search for recent history is used.
- **26 host denials** dispatch zero additional SDK calls: all 20 other advertised
  tools (including every mutation), foreign recent/search chat, global search,
  host search page/limit above 100, and an empty grant. These denials are checked
  at `readWappMcp`, not mistaken for upstream access control. No mutation callback
  or upstream global/foreign read is invoked.
- The notification allowlist contains only a foreign synthetic chat. Authorized
  family search still succeeds, while that allowlisted chat is denied by the
  host. No tool authority is inferred from notification configuration. Channels
  are false; experimental channel capabilities are absent. Calling `subscribe()`
  only exercises its disabled-channel rejection before any session access;
  no channel subscription starts and no permission notification is sent.
- After completed calls, public client/transport closure succeeds and a later
  read rejects as not connected with no session access. Cleanup also closes the
  server transport and removes the temporary import bridge. Multiple linked
  close callbacks are not treated as multiple settlements or required to be
  exactly once. This is **transport cleanup, not session/browser settlement**.

The fixture's protocol calls have a 3-second SDK timeout, host reads a 4-second
bound, and setup/cleanup waits a 5-second assertion bound. These bound this
credential-free fixture, not a live browser process tree. Held-handler cancellation
and unknown intent remain covered separately by `test-wappmcp-sdk.mjs`; host
execution-bridge result custody, Worker authorization, live permissions, pairing,
reconnect, history coverage and sleep are outside this slice. `e09Complete`,
`productionAdmission`, `livePairing`, `sessionSettlementVerified` and
`browserSettlementVerified` remain false.

## Source, integrity and license provenance

No upstream implementation is copied or modified. A temporary ESM re-export
module inside the disposable graph resolves only supported public exports:
`wappmcp`, SDK `client/index.js`, `inMemory.js` and `types.js`. It does not use
CommonJS `require.resolve('wappmcp')`, unsupported `dist` imports or server internals.
Distributed implementation files are read only for SHA256 checks, not imported
through private paths. The caller owns artifact SRI and installation integrity;
the fixture additionally checks installed versions, exact repository lock bytes
and these reviewed distributed wappmcp file hashes:

| File under `dist/` | SHA256 |
| --- | --- |
| `index.js` | `dff70a42c3979a3abd6a8003eca714930b16c0451a657a66cd75bbad9a324abe` |
| `lib/mcp/server.js` | `db13ddecbf0735955688867a08690ad1fe7a3b3429e85a83a4996080827346a3` |
| `lib/mcp/helpers.js` | `81dc4e17e949df937a392b7ad2149b123aea5b66d24b3c9fffb2079663225992` |

Corresponding source paths are `src/index.ts`, `src/lib/mcp/server.ts` and
`src/lib/mcp/helpers.ts` at the pinned
[wappmcp revision](https://github.com/vaibhavpandeyvpz/wappmcp/commit/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8).
The public root export map is in `package.json`. Wappmcp 0.4.0 tarball SHA256:
`f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8`.
The 350-location lock SHA256 is
`15bf32b13594d9a38fd9d36e59a93d1433a0f077320d253e3b2209eb39df4ddf`.

Wappmcp's LICENSE is MIT, copyright 2026 Vaibhav Pandey. SDK 1.30.0's LICENSE
is MIT, copyright 2024 Anthropic, PBC. whatsapp-web.js 1.34.7 is Apache-2.0.
Preserve their license/attribution texts for any actual redistribution. The
existing approved reaction patch is the only patch used during verification;
this fixture needs no new patch. The full graph is **not** an approved permissive
bundle: [artifact/license evidence](WAPPMCP_LICENSE_EVIDENCE.md) records LGPL,
native/WASM, source and notice obligations that remain open.

## Reproduction and observed results

On 2026-09-16, Node 26.5.1 in the Linux orb, copied
`config/wappmcp/{package.json,package-lock.json,.npmrc}` into the disposable
`/tmp/hehe-public-server-install`, then ran:

```sh
npm ci --prefix /tmp/hehe-public-server-install --ignore-scripts --no-audit --no-fund
node --check scripts/test-wappmcp-public-server.mjs
node --input-type=module -e "import { verifyWappMcpPublicServer } from './scripts/test-wappmcp-public-server.mjs'; console.log(JSON.stringify(await verifyWappMcpPublicServer('/tmp/hehe-public-server-install')))"
```

All exited **0**. The report says `status: 'passed'`, 22 catalog tools, eight
schema rejections, 26 host denials, exact search/routing true and
`recentArrayCompatible: false`. Private output: `.local/public-server-focused.log`.

Then verified the existing patch SHA256
`b2b582a7650545d6e7534e7a66731a8b546b309efd6bce9e0e9a4722e0a616cf`, applied it
using `git apply --check` then `git apply` within that disposable installation,
and ran both fixtures against the same graph:

```sh
node --input-type=module -e "import { verifyWappMcpPublicServer } from './scripts/test-wappmcp-public-server.mjs'; import { verifyWappMcpSdk } from './scripts/test-wappmcp-sdk.mjs'; const installation = '/tmp/hehe-public-server-install'; console.log(JSON.stringify({publicServer: await verifyWappMcpPublicServer(installation), sdk: await verifyWappMcpSdk(installation)}))"
```

Exit **0**, same public-server result and all five existing SDK modes passed
(recent incompatibility, scoped search, abort, timeout, close). Private output:
`.local/public-server-patched.log`. Initial development assertions incorrectly
expected a successful array response on the wire and exactly one close callback;
the executed SDK contradicted both, and the fixture now tests the actual contract.
`node --test tests/runtime-wappmcp-reads.mjs` also exited **0**, with **18 passed,
0 failed** (`.local/public-server-read-boundary.log`).
Combined application/desktop verification and shared verifier integration remain
host-owned; they were not run by this bounded workstream. No pushes or deployments.
