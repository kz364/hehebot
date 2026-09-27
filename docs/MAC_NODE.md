# Mac node (V10, ARCHITECTURE_V2 A9)

The paired Mac is an optional, intermittent **device node**, not a second brain. A
small Node.js agent (`mac-node/mac-node.mjs`) keeps one outbound WebSocket to the
Worker's Durable Object and runs only allowlisted, read-only capabilities. The
runtime on the Sprite *pulls* from it through the Worker. While the Mac is offline,
requests park durably and nothing keeps the Sprite awake for them.

Status: implemented with focused tests. **Live verification is pending** (pairing,
Full Disk Access and the Access service token on the owner's Mac).

## Pieces

| Piece | Where |
| --- | --- |
| Queue, pairing, node auth, follow-up wake | `src/core/node-bridge.ts`, `src/worker/control-object.ts` |
| Routes | `src/worker/index.ts` |
| Runtime RPCs `node-request`, `node-result` | `SCHEMAS/runtime.json`, `runtime/control-client.mjs` |
| Tool `hehebot_messages_search` | `runtime/agent-tools.mjs` (guidance in `runtime/execution-bridge.mjs`) |
| Grant | tool policy `f1503d17-e75d-4c90-9c9c-2012628b3aea`, "Mac: read Messages" (`MAC_MESSAGES_POLICY`) |
| Node agent | `mac-node/mac-node.mjs`, `mac-node/messages.mjs`, `mac-node/install-launchd.sh` |
| Portal | Workspace panel → **Mac** card (paired, online, last seen, queued, Pair, Revoke) |

## Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/nodes` | Owner (Access JWT) | Mac card status |
| `POST /v1/nodes/pair` | Owner + same origin | Mint a one-time pairing code (12 chars, 10 min, 5 wrong tries) |
| `POST /v1/nodes/revoke` | Owner + same origin | Delete the node token, close its socket |
| `POST /node/exchange` | Access service token at the edge; the code is the credential | Exchange the code once for a node token |
| `GET /node/stream` | Access service token at the edge + `Authorization: Bearer <node token>` | Node WebSocket |

The pairing code and node token are stored only as SHA-256 hashes (`runtime_metadata`
keys `node:pairing`, `node:device`). The pairing code is returned by a dedicated
route rather than a `/v1/commands` receipt, because receipts are durable,
idempotently replayable and exported, and a secret must not live there. One Mac is
paired at a time; a new exchange replaces the old one.

## Queue and parking

- A request is `{id, capability, args, run_id, attempt, enqueued_at, deadline, status,
  result}` with status `queued → delivered → done | failed | expired`. Default
  deadline 12 h (1 min–24 h). At most 50 open and 200 retained requests; args ≤ 4 KB,
  results ≤ 64 KB; settled requests are pruned after 24 h. Expiry runs from the DO
  alarm (`arm()` includes the earliest deadline and never postpones an earlier alarm).
- `node-request` is epoch/attempt fenced (`lifecycle.authorizeAttempt`), requires the
  run's frozen persona snapshot to hold the capability's policy, and dedupes on
  `request_key`. If the Mac is online, it is pushed at once; otherwise it is pushed on
  the node's next `hello`. Delivery is at-least-once (open requests are redelivered
  after a reconnect); every capability is read-only and the node replays a cached
  result for a repeated id.
- The tool waits at most 20 s, and only while the Mac is online. Otherwise it calls
  `node-result` with `park: true` and returns
  `parked: the Mac is offline; this will continue when it reconnects`. The owner sees
  a `NODE_PARKED` notice. The turn ends normally. Node requests are not counted by
  `lifecycle.active()`, so the runtime can sleep.
- When a parked request settles, the Worker enqueues a coordinator run for the persona
  (the original instruction plus the result, marked as untrusted content). This is the
  normal wake path, bounded by the A4 causal depth of 3. A parked request that expires
  only posts a `NODE_REQUEST_EXPIRED` notice and does not wake the runtime.

## Capabilities

| Capability | Behavior |
| --- | --- |
| `ping` | `{pong, at, version}` |
| `messages.search` | Read-only query of `~/Library/Messages/chat.db` (`node:sqlite`, `readOnly: true`, `PRAGMA query_only`). Filters: `query` (text contains), `sender` (handle contains), `since`/`until` (default last 7 days), `limit` ≤ 50. Returns id, date, from, chat, service, text (≤ 2000 chars) and `has_attachments`. Never returns attachment content. |

When `message.text` is NULL (recent macOS), the node decodes the first NSString in
`attributedBody` (typedstream layout `NSString 01 ?? 84 01 2B <len> <utf8>`). Anything
unrecognised is returned as `text: null, text_unavailable: true`; the node never
guesses. Nanosecond `date` values are converted in SQL (they exceed 2^53). Tested only
against a synthetic fixture with the real schema subset, not the owner's database.

The node allowlist is `IMPLEMENTED_CAPABILITIES ∩ config.capabilities`: configuration
can narrow it but never widen it. Anything else gets `CAPABILITY_NOT_ALLOWED`.

## Owner setup (live steps)

1. **Access service token.** In Cloudflare Zero Trust → Access → Service Auth, create a
   service token (for example `hehebot-mac-node`). Add a policy with the **Service Auth**
   action for that token to the portal's Access application, the same way the
   runtime's `hehebot-runtime` token is allowed. Save the Client ID and Secret on the
   Mac as two files with mode 600, for example
   `~/Library/Application Support/Hehebot Node/access-id` and `access-secret`. The node
   sends them as `CF-Access-Client-Id/Secret`, like `runtime/control-client.mjs`.
2. **Deploy** the Worker with this change. `TOOL_POLICY_IDS` in env `hehebot` already
   allows the new policy.
3. **Install.** `bash mac-node/install-launchd.sh` copies `node` to
   `~/Library/Application Support/Hehebot Node/bin/node` and renders
   `~/Library/LaunchAgents/com.hehebot.mac-node.plist`. It does not load the agent.
4. **Pair.** Portal → Workspace → Mac → **Pair a Mac**, then on the Mac:
   `"…/Hehebot Node/bin/node" mac-node/mac-node.mjs pair --origin https://<portal-origin> --code XXXX-XXXX-XXXX --access-id-file …/access-id --access-secret-file …/access-secret`.
   This writes `config.json` and `node-token` (mode 600).
5. **Full Disk Access.** System Settings → Privacy & Security → Full Disk Access: add
   `~/Library/Application Support/Hehebot Node/bin/node`. Only the owner can grant it;
   the node never requests it. The dedicated copy means other `node` processes do not
   inherit the grant. Check with `… mac-node.mjs check`, which prints a count and no
   message content.
6. **Start.** `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hehebot.mac-node.plist`,
   or use the Mac app's menu (Start Mac Node). Stop with
   `launchctl bootout gui/$(id -u)/com.hehebot.mac-node`. The card should show Online.
7. **Grant.** In the bot editor, turn on Capabilities → **Mac: read Messages** for the
   Messages persona only.
8. **Verify.** Ask that bot "when is my next appointment in my messages?" with the Mac
   online (it answers directly). Then stop the node and ask again: it should say it
   will follow up, the thread shows the parked notice, and the Sprite goes to sleep.
   Start the node again: a follow-up reply arrives.

Revoke from the card at any time. The node exits cleanly on revoke and launchd does
not restart it (`KeepAlive.SuccessfulExit=false`).
