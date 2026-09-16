# Short-lived owner browser gateway

`runtime/owner-alpha-gateway.mjs` is a restricted owner-authentication boundary for a **fresh, dedicated local owner-alpha installation**. It does not enable production execution, change `AUTH_MODE=local`, publish a portal, connect an account, invoke a model, or expose the runtime listener.

The launcher must keep the local-auth Worker and runtime on private loopback listeners. Only this gateway may be connected to a trusted HTTPS ingress. Do not point ingress at the Worker: loopback URL validation in local auth is not a network access control. Gateway HTTP binds only `127.0.0.1`; ingress terminates TLS and carries requests over that trusted local connection. Configure the public HTTPS origin explicitly; proxy `Host`, `Forwarded`, `X-Forwarded-*`, and identity headers are not trusted.

## Exported launcher contract

```js
import { startOwnerAlphaGateway } from './runtime/owner-alpha-gateway.mjs';

const gateway = await startOwnerAlphaGateway({
  publicOrigin,       // Exact canonical HTTPS origin, no slash/path/query/credentials.
  upstreamOrigin,     // https://127.0.0.1:PORT or https://[::1]:PORT; explicit port.
  upstreamCaFile,     // Absolute PEM CA path; upstream certificate must match its IP.
  ownerTokenFile,     // Absolute private regular file, current UID, mode 0600 or stricter.
  runtimeTokenFile,   // Separate private file; used ONLY to reject credential reuse.
  ownerAlpha,         // Existing exact ownerAlphaPolicy contract, same as Worker/runtime.
  accessExpiresAt,    // Canonical UTC ISO timestamp; fixed absolute browser deadline.
  port,              // Integer 0–65535; zero requests an ephemeral loopback port.
});
// gateway.server is Node's HTTP Server; gateway.address is server.address().
// Shut down with await gateway.stop(). No signal handlers or portal publication are installed.
```

All keys are required; unknown keys are rejected. CA verification cannot be disabled; `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected. Only Node built-ins and the existing owner-alpha policy validator are used. The optional second argument accepts `now` (a deterministic test clock) and a host-owned synchronous `admissionOpen` predicate. The launcher binds that predicate to its original runtime process still being live and no shutdown requested. It must return exactly true immediately before forwarding a message, after all awaited body/token reads. Early process exit closes new-message forwarding without closing readback or cancellation; logging in again does not restart the process. The predicate is not supplied through operator JSON or browser input. This check does not undo requests already dispatched or prove native settlement. The portal can still show its last session snapshot until a send is refused or the deadline arrives.

The operator must generate the owner token from at least 32 cryptographically random bytes, encoded as base64url (for example `randomBytes(32).toString('base64url')`), and write it directly to its private file without printing it. The gateway accepts 43–128 base64url characters with a basic diversity check; syntax checks cannot establish real entropy. It rejects symlink token files, group/world permissions, shared file identity, and equal owner/runtime token values. Parent directories must be operator-controlled. Never place either token in a URL, command-line argument, browser storage, logs, source control, or a public artifact.

`accessExpiresAt` must be at or after `ownerAlpha.expires_at`, at most 15 minutes beyond it, in the future, and no more than 20 minutes from gateway startup. The inference deadline must be no more than five minutes ahead, matching the existing runtime entrypoint; starting within the remaining readback window is allowed. The launcher chooses the policy and browser deadlines once. The gateway does not extend either deadline on requests, refresh, or repeated login. Message forwarding closes at the inference deadline; the Worker remains authoritative for admission, policy, run budgets, schema validation, receipts, cancellation and idempotency. Reads and cancellation can continue until the browser deadline. This does not mean pending tools/effects have settled.

## Browser authentication and forwarding

`GET /login` renders a built-in, script-free password form. `POST /login` requires the exact configured public `Origin`, `application/x-www-form-urlencoded`, a body of at most 512 bytes and exactly one `token` field. Token and session comparisons use fixed-size SHA-256 digests with `timingSafeEqual`. The token is never forwarded to the Worker. Each successful login creates a random in-memory session (maximum 128 concurrent sessions) in `__Host-hehebot_owner_alpha`, with `HttpOnly; Secure; SameSite=Strict; Path=/` and the fixed expiry. It is not the owner token or runtime token.

Every POST requires the configured public origin and rejects a cross-site `Sec-Fetch-Site`. Authenticated allowed commands receive a deliberately rewritten **private upstream Origin** and `Sec-Fetch-Site: same-origin`. Upstream requests use only constructed headers: no incoming cookie, authorization, forwarded identity, or arbitrary headers. The upstream is fixed HTTPS loopback with the supplied CA, normal certificate/IP verification, no redirects, an absolute elapsed 10-second deadline covering TLS/headers/body and a 4 MiB response bound. Response activity never extends that deadline; its timer is cleared on success or failure. A timed-out mutation has an unknown outcome and is never automatically replayed. Redirects/errors become generic redacted errors, not forwarded destinations. Upstream `Set-Cookie`, CORS and other headers are dropped; content type is retained only for allowlisted assets. All normal gateway responses carry `no-store`, CSP, `nosniff`, and a `same-origin` referrer policy. The gateway does not log credentials, requests, or upstream error bodies.

Exact forwarding allowlist (other methods, paths, unknown/duplicate query keys and noncanonical/encoded paths are rejected):

| Method | Path | Query / restriction |
| --- | --- | --- |
| GET, HEAD | `/`, `/index.html`, `/app.js`, `/style.css`, `/import-setup.js` | No query |
| GET | `/v1/state` | `after`, `limit` |
| GET | `/v1/conversations/{selected-persona}/events` | `before` |
| GET | `/v1/conversations/{selected-persona}/tasks`, `/recovery` | `after`, `limit` |
| GET | `/v1/receipts/{uuid}` | No query |
| POST | `/v1/commands` | JSON ≤64 KiB, UUID `Idempotency-Key`; only exact `message.send` or `run.cancel` envelopes |

`message.send` must name the configured persona. `run.cancel` must name a run in the canonical upstream `/v1/state` with that persona; missing runs, malformed state and lookup failures deny cancellation, with no fallback or replay. A run outside the state snapshot may therefore be unavailable for cancellation here. Canonical command authorization still runs in the Worker. Other commands, configuration exports, schedule previews, `/internal/*`, `/v1/triggers/*`, arbitrary assets and arbitrary destinations are never forwarded.

**This is owner authentication, not selected-persona confidentiality.** `/v1/state` is forwarded unchanged and exposes the installation's full existing owner-visible state, including unrelated seeded personas; receipt reads are also owner-wide. The launcher must use fresh dedicated persistence with no private imports or connector/account state. Conversation routes and writes are restricted, but that does not narrow the state endpoint's read scope. Do not connect this gateway to a populated/private installation and claim persona isolation.

`POST /logout`, with exact public Origin and an empty body, invalidates the presented session and clears its cookie even after expiry; it makes no upstream call. Expired/revoked root and login pages explain that access is closed instead of redirecting in a loop. Stopping the gateway revokes all sessions. Changing/removing the owner token file revokes all access when the next request checks it; restoring the old token does not revive that process. The file is checked again after reading login input and immediately before mutation dispatch, after awaited body/ownership reads; a revoked grant cannot authorize a new dispatch at that check. Restart with the new private token to enable a new authorized session. Rotation/stop does not undo commands already accepted upstream, and no unknown external outcome is automatically replayed. Runtime credentials never authenticate browser access.

## Local evidence and limits

The integrated Chromium → local TLS ingress → gateway → real Worker/SQLite check
is `node scripts/test-owner-alpha-gateway.mjs`. It verifies form login, HttpOnly
cookie authentication, one durable queued message with zero native attempts,
reload, forbidden mutations/export, and logout. The response referrer policy is
`same-origin`: `no-referrer` makes Chromium's form POST Origin null and breaks the
exact-Origin CSRF check. Cross-origin referrers remain suppressed. This fixture
does not publish ingress or start a native/model session.

Run `node --test tests/runtime-owner-alpha-gateway.mjs`. Tests create temporary local certificates and HTTP/HTTPS listeners, synthetic tokens and a synthetic public origin. They cover route/method denials, forged forwarded identity, exact Origin/CSRF, cookie flags, token separation, private-file constraints, canonical cancellation fail-closed behavior, readback vs inference expiry, non-sliding login expiry, logout, rotation during body/ownership reads and wrong-CA rejection. A real 10-second trickling-response regression verifies the elapsed deadline and no replay after an uncertain mutation. OpenSSL is required only for test certificate generation. No account, model, provider, portal or external network calls are made by these tests.

These fixtures do not prove integrated native execution, real public HTTPS ingress or production security acceptance. The launcher must verify its own listener isolation, exact origin configuration, matching owner-alpha policy and fresh persistence. Public ingress publication and live inference require applicable owner authorization.
