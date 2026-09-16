# Bounded E15 endpoint custody matrix

Source: host unpublished local main [8915a47](https://github.com/kz364/hehebot/commit/8915a478502bbe1f5226043111f36f79ab01244d), imported from `.local/parallel-readiness-security.bundle`, not `origin/main`. This is credential-free local evidence, not a full endpoint/security audit or an E15 completion claim. The host owns integration and completion status.

## Executable boundary

`tests/endpoint-custody-matrix.test.ts` invokes the actual `src/worker/index.ts` fetch handler, owner authentication, runtime authentication, `PersonalControl` RPC, generated runtime validation, and core SQLite implementation. It adapts `tests/control-object.test.ts` and `tests/root-child-effects-rpc.test.ts`: only the Cloudflare Durable Object host/storage cursor and schema-import wrapper are replaced, using `TestDatabase` and the actual schema. No HTTP listener or workerd process runs.

The JWKS network resolver is replaced with `createLocalJWKSet`; `jwtVerify` is unchanged. Locally generated RS256 owner and foreign-owner tokens have the same signing key, issuer, audience and valid lifetime, differing only in subject. Thus foreign-owner rejection is not accidentally an invalid-signature test. Global fetch throws on unexpected dispatch. No account credentials, external resources, provider or model processes are used. Execution/native flags are true only in the disposable fixture; no deployment configuration changes.

Each test creates independent SQLite state. Two owner messages enter through authenticated HTTP into different personas, with distinct task/history canaries. Native admission, task titles and the initial persona policy are seeded as fixture observations/configuration, not claimed as runtime admission evidence. A supported native question carries another canary; an authorized answer adds a distinct answer canary. The contract rejects `isSecret: true`, so these are privacy-sensitive synthetic strings in an ordinary supported question, not proof of native secret-question support.

## Routes and assertions exercised

| Method and route | Negative credentials/scenarios | Positive control |
| --- | --- | --- |
| GET `/v1/state` | Missing owner, valid foreign subject, runtime bearer alone → 401 | Owner sees both persona canaries |
| GET `/v1/conversations/:id/events` | Same three → 401 | Owner sees selected persona history, not other persona canary |
| GET `/v1/conversations/:id/tasks` | Same three → 401 | Owner sees selected task title, not other persona canary |
| GET `/v1/conversations/:id/recovery` | Same three → 401 | Owner sees seeded recovery task, not other persona canary |
| GET `/v1/receipts/:id` | Same three → 401 | Owner receives existing command receipt |
| GET `/v1/export/control` | Same three → 401 | Owner export contains both seeded persona canaries |
| POST `/v1/commands`, `question.answer` | Same three → 401 | Owner answer → 202/applied, answer canary persists |
| POST `/v1/commands`, `question.close` | Same three → 401 | Owner stopped closure → 202/applied |
| POST `/v1/commands`, `run.recover` | Same three → 401 | Owner recovery after closure → 202/applied; other task unchanged |
| POST `/internal/question-record` | Missing bearer, foreign-owner JWT only, owner JWT only → 401 | Runtime records a supported question via HTTP in every fixture |
| POST `/internal/question-take` | Same three → 401; owner JWT also denied after secret-bearing answer persists | Runtime receives exact answer once with `response_unknown`; second take returns null |
| POST `/internal/question-resolve` | Same three → 401 | Runtime resolves taken question → 200/ok |
| POST `/internal/whatsapp-read-authorize` | Same three → 401; valid runtime with other persona's ungranted task → 403 | Valid runtime and granted task → exact allowed/deadline response |

Every 401 assertion checks `UNAUTHORIZED`, absence of all canaries and supplied credential strings in the response, zero calls to the relevant owner/runtime control RPC methods, unchanged **all SQLite tables** (including commands, rate limits, metadata, lifecycle, effects and controller operations), unchanged `total_changes()`, no alarm set/delete, and no fetch dispatch. This catches even writes restored to their original values. No control RPC means no downstream command, wake/provider or model admission through that path; this is boundary evidence, not live provider observation. The scoped WhatsApp 403 additionally checks unchanged tables/change count, no alarms/fetch, and no canary leakage after an authorized positive query against the same state.

There are 43 tests: 27 owner-route authentication combinations, 12 runtime-route combinations, and four positive/scoped custody controls. Positive reads are not asserted to be mutation-free: existing authorized reads can rate-limit and reconcile maintenance. Denied reads must not enter those operations.

## Endpoint inventory and explicit exclusions

Inspection of `src/worker/index.ts` identifies these ingress families: owner reads, owner commands, runtime POST RPC, signed trigger POST, and authenticated GET/HEAD assets. Beyond the covered rows, owner ingress includes GET `/v1/schedules/preview`; other public `/v1/` routes return not-found. Task details currently use the conversation task page, not a separate `/v1/tasks/:id` endpoint.

Excluded from this matrix:

- Schedule-preview authentication, authenticated assets/HEAD/CSP, unsupported methods/paths, malformed URLs/cursors, rate-limit exhaustion, CSRF/origin permutations and request-size limits. Existing focused tests cover some, but this matrix makes no new claims about them.
- POST `/v1/triggers/:source` HMAC, replay, and source scoping; other `/v1/commands` command types.
- Other `/internal/` runtime types: status, output-preview, steer-pending/result, budget-report, flight-register/confirm/reconcile, native-child, resource-acquire/release, boot/ready/claim/heartbeat/submitted/complete, prepare-sleep/commit-sleep, effect-intent/result, root-child-effect-intent/result, agent-command/routines/skill.
- Runtime-token rotation, invalid-token variants, dual owner-plus-runtime credentials, real Access/JWKS HTTP caching/rotation, Cloudflare deployment isolation and direct external RPC exposure.
- Exhaustive question identity/staleness/closure cases and WhatsApp policy tuple/deadline/descendant cases; those remain in `question-control.test.ts` and `whatsapp-access.test.ts`. Authorized question record/take/resolve and closure here establish ingress composition, not additional native protocol proof.
- Cross-installation tenancy, persona permission systems beyond the current single installation owner, room membership, cursor pagination/retention races, encrypted storage, crash persistence, log inspection, browser rendering, live connectors, model inference and production security. Owner-wide state/export intentionally include both personas; conversation pages must remain scoped.

## Evidence and findings

Executed on the imported source plus these two new files:

```text
npx vitest run tests/endpoint-custody-matrix.test.ts
Test Files  1 passed (1)
Tests       43 passed (43)

npx vitest run tests/endpoint-custody-matrix.test.ts tests/auth.test.ts tests/question-control.test.ts tests/whatsapp-access.test.ts tests/control-object.test.ts
Test Files  5 passed (5)
Tests       123 passed (123)

npm run types
Types written to worker-configuration.d.ts

npm run typecheck
tsc --noEmit
(exit 0)

git diff --cached --check
(no output; exit 0)
```

No production authorization/privacy defect was reproduced in this bounded matrix. The first typecheck failed with TS2339 for `HEHEBOT_WHATSAPP_READ_POLICIES` in `src/worker/control-object.ts`: this orb's ignored generated `worker-configuration.d.ts` was stale after importing the bundle. Running the repository's `npm run types` regenerated that local artifact from the existing `wrangler.jsonc`; typecheck then passed without changing tracked source or suppressing diagnostics. This was an environment prerequisite issue, not a baseline production defect.
