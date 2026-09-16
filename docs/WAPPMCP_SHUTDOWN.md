# Credential-free shutdown evidence, not E09 completion

`scripts/test-wappmcp-shutdown.mjs` exports
`verifyWappMcpShutdown(installation): Promise<report>`. The host must supply the
disposable, integrity-locked, scripts-disabled installation already produced by
`scripts/verify-wappmcp.mjs`. This module does not install packages, apply patches,
initialize a WhatsApp client, run the plugin CLI, launch Chromium, connect accounts,
or make model/provider calls. No production flags or settlement policy change.

Host integration (owned separately):

```js
import { verifyWappMcpShutdown } from './test-wappmcp-shutdown.mjs';
const shutdown = await verifyWappMcpShutdown(installation);
```

## Sources and attribution

Reviewed npm `wappmcp@0.4.0`, SHA256 of its distributed tarball:
`f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8`.
The host verifier owns tarball/lock integrity; this harness additionally rejects
changes to four distributed files using exact SHA256 values in `hashes`.

Source revision: [9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8](https://github.com/vaibhavpandeyvpz/wappmcp/commit/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8).

| Reviewed upstream source | Installed file used |
| --- | --- |
| [`src/lib/signal-handler.ts`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/signal-handler.ts) | `wappmcp/dist/lib/signal-handler.js`: imported `register()` |
| [`src/lib/whatsapp/session.ts`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/whatsapp/session.ts#L140-L191) | `wappmcp/dist/lib/whatsapp/session.js`: actual prototype `destroy()` |
| [`src/lib/timeout.ts`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/timeout.ts) | `wappmcp/dist/lib/timeout.js`: unmodified imported timer |
| [`src/cli/mcp.ts`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/cli/mcp.ts) | `wappmcp/dist/cli/mcp.js`: inspected and hash checked, **not executed** |

Also executed from locked `whatsapp-web.js@1.34.7`:
`src/Client.js` (`Client.prototype.destroy`),
`src/authStrategies/BaseAuthStrategy.js` (inherited no-op `destroy`), and
`src/authStrategies/LocalAuth.js` (`logout` against only a new disposable canary).
Dependency tarball SHA256:
`714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c`.
The existing approved reaction patch does not modify these methods. The standalone
run used an unpatched `npm ci --ignore-scripts` graph; host integration may use the
same graph after its separately approved patch verification.

Wappmcp is MIT, copyright 2026 Vaibhav Pandey; whatsapp-web.js is Apache-2.0.
Their license files remain in the disposable installed packages. No upstream
implementation is copied into tracked files and no dependency is modified here.
The fixture now imports `WhatsAppSession` and `register` through the public ESM
package root, using a temporary re-export module in the disposable graph.
The hash-checked implementation files above are inspected, not imported through
unsupported package subpaths. This remains verification, not a production adapter.
This is not a transitive license audit or approval to redistribute the graph.

## Public API candidate, not embedded lifecycle acceptance

The pinned [package export map](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/package.json)
and [root barrel](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/index.ts)
expose `WhatsAppSession`, `WhatsAppMcpServer` and signal helpers through the import
condition. CommonJS resolution is not exported. Main's first `require.resolve`
attempt failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`; normal ESM import passed
all 19 shutdown cases across 13 children in `.local/wapp-public-root-esm.log`.
No session was constructed or started; prototype methods retain synthetic handles.

A host-owned session using the package root is therefore a supported-export
candidate that need not depend on the CLI's removed signal handlers. The README
documents CLI use, not a complete embedded-host lifecycle. Public `destroy()` is
separate from `logOut()`; it still does not prove descendant settlement. Transport
closure, singleton/profile ownership, startup/teardown concurrency, real browser
termination and reconnect must be established before admission. No dependency
patch, browser launch, pairing or production lifecycle was introduced here.

## Executable observations

Thirteen synthetic Node children run serially: twelve signal cases and one child
containing seven destroy cases. The parent awaits `close` and asserts the exact
exit code and signal. IPC records distinguish callback entry from completion.

| Signal case (each tested with SIGINT and SIGTERM) | Exact child exit | Callback evidence |
| --- | --- | --- |
| Fulfilled | code 130 / 143, signal null | entered, completed |
| Rejected promise | code 130 / 143, signal null | entered, no completion |
| Other signal while callback pending | code of first signal, signal null | one invocation; both one-shot listeners consumed; first callback completes |
| Same signal repeated while pending | code null, signal SIGINT / SIGTERM | entered, no completion; second signal terminates directly |
| Hung callback | code null, signal SIGKILL | entered, no completion; **parent kills after 200ms observation** |
| Explicit unregister before signal | code null, signal SIGINT / SIGTERM | no callback entry |

The 200ms wait is a fixture observation window, **not an upstream shutdown bound**.
The upstream handler has no callback deadline. Its promise rejection is swallowed;
the 130/143 exit therefore does not prove successful cleanup. Repeated identical
signals can terminate before cleanup completes. Synchronous callback throws are
outside this matrix (the CLI callback is async).

The destroy child exits code 0, signal null only after all assertions and profile
cleanup complete. Contracts cover:

1. Actual `WhatsAppSession.destroy` → actual `Client.destroy` → synthetic browser
   close and actual inherited `LocalAuth.destroy`. One close/listener removal,
   zero logout calls, unchanged profile canary; a repeated destroy makes no calls.
2. Actual `LocalAuth.logout` removes that same disposable canary. This negative
   control distinguishes profile preservation from a test unable to observe deletion.
3. Rejected client destroy triggers listener removal, disconnect request, browser
   process lookup and direct `SIGKILL` request, in that order.
4. A held client destroy reaches the **unmodified 5000ms upstream timer** before
   the same fallback. It is still unresolved after the session method returns,
   and can finish later. The timer assertion permits 100ms lower-bound tolerance;
   the independent child watchdog bounds the upper end.
5. Rejected disconnect and thrown kill errors are swallowed; return still does
   not establish termination. Ordinary fallback uses a held disconnect promise
   and a kill returning false, and also returns without waiting for either proof.
6. Rejected destroy with no browser only removes listeners and returns.
7. An empty session becomes disconnected with no client cleanup.

Concurrent second destroy returns immediately after the first clears `wwebjs`,
before the first cleanup finishes. `state === 'disconnected'` is therefore not a
settlement receipt. No fallback case authorizes sleep or releasing resource locks.

Every child has an independent 12-second fail-closed watchdog (exit 97 fails the
contract), and a parent 15-second SIGKILL watchdog (also a failure). Only the
explicit hung-callback case expects parent SIGKILL. Children receive a minimal
environment and disposable HOME, and parent cleanup removes that directory even
after forced exit. No synthetic child spawns descendants. This bounds fixture
cleanup under ordinary OS signal delivery, not unkillable kernel tasks.

## CLI wiring is a separate blocker

Static inspection of both pinned TypeScript and distributed JavaScript found
`McpCommand.action` registers the handler before startup but **unconditionally
calls `unregister()` in `finally`**, including after the ready branch sets
`keep = true` and returns. That branch skips session destroy, but not unregister.
Consequently the standalone handler results cannot be promoted to evidence that
the successful long-running CLI retains those signal handlers. The unregister
negative control demonstrates the primitive's default-signal behavior, not an
executed CLI lifecycle test. No actual CLI/startup was run or dependency patched.

## Reproduction and limits

On 2026-09-16 in the Linux orb, prepared an isolated installation from
`config/wappmcp/{package.json,package-lock.json,.npmrc}` using
`npm ci --ignore-scripts --no-audit --no-fund`, then ran:

```sh
node --check scripts/test-wappmcp-shutdown.mjs
node --input-type=module -e "import {verifyWappMcpShutdown} from './scripts/test-wappmcp-shutdown.mjs'; console.log(JSON.stringify(await verifyWappMcpShutdown('/tmp/hehe-shutdown-install')))"
```

Both exited 0. The report contains all twelve exact signal exits, seven named
destroy cases, pinned file hashes, `syntheticChildExitVerified: true`, and
`processTreeSettlementVerified: false`, `cliLifecycleVerified: false`,
`livePairing: false`, `e09Complete: false`. Private exact output is retained in
`.local/wappmcp-shutdown-final.log`; host integration should rerun against its own
verified disposable graph. The narrow workstream did not run the full application
or desktop verification; main owns verifier integration and combined checks.

No browser PID was killed: browser handles are synthetic, and only synthetic Node
fixture PIDs receive real signals. Chromium descendants, real profile/session
reconnect, message catch-up, provider sleep, live permissions and process-tree
settlement remain unverified. E09 remains incomplete.
