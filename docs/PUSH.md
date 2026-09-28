# Push notifications

Standard Web Push (RFC 8030/8291/8292, VAPID) sends the owner a browser/OS
notification when a bot posts (`bot.message`) or needs attention (a `notice`
with kind `needs_you`, `runtime` or `degraded`) — without the portal open.
There is no third-party push service beyond the browser's own push endpoint
(e.g. Google FCM, Mozilla autopush, Apple's web push service); the Worker
signs and encrypts every message itself with WebCrypto (`src/core/webpush.ts`).
No npm dependency is used for VAPID signing or `aes128gcm` encryption.

Until the three secrets below are configured, push is fully disabled: the
Worker never sends anything, `GET /v1/state` omits `settings.push`, the portal
hides its "Notifications" toggle, and `push.subscribe` is rejected with
`CAPABILITY_UNAVAILABLE`. `push.unsubscribe` always works, so a stale
subscription can always be cleared.

## 1. Generate a VAPID key pair (once per deployment)

Run this locally. It never prints the private key to the terminal; it writes
both keys to files in the current directory, which you then hand to
`wrangler secret put` and delete.

```sh
node -e '
const { generateKeyPairSync } = require("crypto");
const { writeFileSync } = require("fs");
const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicDer = publicKey.export({ type: "spki", format: "der" });
const publicRaw = publicDer.subarray(publicDer.length - 65); // uncompressed P-256 point
const privateDer = privateKey.export({ type: "pkcs8", format: "der" });
writeFileSync("vapid-public.txt", b64url(publicRaw));
writeFileSync("vapid-private.txt", b64url(privateDer));
console.log("Wrote vapid-public.txt and vapid-private.txt in", process.cwd());
'
```

- `HEHEBOT_VAPID_PUBLIC_KEY` is the base64url of the uncompressed P-256 point
  (65 bytes, `0x04 || X || Y`). It is not secret — the browser also receives
  it verbatim as `applicationServerKey` — but is still stored as a secret for
  convenience (`GET /v1/state` republishes it inside `settings.push`, never a
  file).
- `HEHEBOT_VAPID_PRIVATE_KEY` is the base64url of the DER PKCS8 encoding of
  the matching private key. Keep this one confidential.

## 2. Configure the Worker

```sh
npx wrangler secret put HEHEBOT_VAPID_PUBLIC_KEY --env hehebot < vapid-public.txt
npx wrangler secret put HEHEBOT_VAPID_PRIVATE_KEY --env hehebot < vapid-private.txt
```

`HEHEBOT_VAPID_SUBJECT` is a plain (non-secret) variable — a `mailto:` or
`https:` URI identifying the sender, per RFC 8292 — already present as an
empty string in `wrangler.jsonc`'s `vars` for `env.hehebot`/`env.local`/the
top level; set it to a real address before deploying, e.g.:

```jsonc
"HEHEBOT_VAPID_SUBJECT": "mailto:owner@example.com"
```

Then delete the two key files (`rm vapid-public.txt vapid-private.txt`) and
deploy as usual (`npx wrangler deploy --env hehebot`). This step is not
performed as part of this change — no secrets were set and nothing was
deployed.

## 3. Enable notifications on a device

Once the three settings above are live, open the portal (it must be served
over HTTPS, or `http://localhost` for local dev — Web Push requires a secure
context) and open **Workspace → Notifications**. The toggle is hidden until
push is configured server-side.

- **Desktop (Chrome, Firefox, Edge, Safari 16+)**: click "Enable
  notifications", accept the browser's permission prompt. Done — a
  notification arrives even with the tab closed, as long as the browser
  itself is running (some browsers also deliver while fully closed, via the
  OS push service).
- **Android Chrome**: same flow; works with the browser or Chrome fully
  closed.
- **iPhone/iPad (iOS 16.4+)**: Web Push only works from a *home-screen*
  installation, not from a normal Safari tab. Open the portal in Safari, tap
  **Share → Add to Home Screen**, then reopen the portal from the home-screen
  icon and use the toggle from there. The portal detects a non-standalone iOS
  Safari session and shows this same instruction instead of a toggle.

To stop notifications on a device, use the same toggle ("Disable
notifications on this device"); this also removes that device's subscription
from the Worker. A subscription is also removed automatically the next time a
push to it is rejected by the browser's push service with HTTP 404 or 410
(the standard "this subscription no longer exists" response).

## How it fits together

- **Trigger**: `src/worker/control-object.ts`'s `dispatchPushNotifications()`,
  called from the same two places that already broadcast to open
  `/v1/stream` sockets on commit — every `rpc()` and every `alarm()`
  (ARCHITECTURE_V2 A6's sibling hook). It reads new `bot.message` events and
  `notice` events (kinds `needs_you`/`runtime`/`degraded`) since a persisted
  cursor, collapses repeats for the same persona within 10 seconds
  (`src/core/push-notify.ts`), and fans out to every stored subscription. The
  cursor/collapse bookkeeping is synchronous, ordinary SQLite; only the actual
  network sends run in `ctx.waitUntil`, after the triggering commit has
  already returned, so a slow or failing push endpoint can never delay or
  fail the command/event/alarm that produced it.
- **Storage**: `push.subscribe` / `push.unsubscribe` commands
  (`src/core/push-subscriptions.ts`), validated against
  `SCHEMAS/contracts.json` like every other command, and stored in the
  `push_subscriptions` SQLite table (schema v20, `DB/schema.sql`).
- **Send**: `src/core/webpush.ts` — VAPID (ES256 JWT) and `aes128gcm`
  encryption (RFC 8291/8188), WebCrypto only.
