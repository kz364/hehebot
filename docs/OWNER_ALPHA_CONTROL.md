# Local supervised owner-alpha control boundary

This is code preparation for bounded, supervised local root inference. It does not enable production execution, prove native-family settlement, or authorize model/account/provider activity. Runtime service assembly and root-only native capability enforcement are separate requirements.

## Operator configuration and readback

`HEHEBOT_OWNER_ALPHA` is an optional JSON string binding. Unset or empty means off. When supplied it must contain exactly these five fields, with no additional properties:

```json
{
  "session_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "persona_id": "11111111-1111-4111-8111-111111111111",
  "expires_at": "2026-09-16T12:00:00.000Z",
  "max_runs": 2,
  "max_task_seconds": 120
}
```

IDs must be UUIDs. Expiry is canonical UTC ISO with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`); `max_runs` is an integer from 1–3; `max_task_seconds` is an integer from 1–300. The date above is illustrative, not an active session. A nonempty malformed value fails closed. Alpha requires `AUTH_MODE=local`, `EXECUTION_ENABLED=false`, `NATIVE_VERIFIED=false`, and `PROVIDER_CONFIG={}`. Existing local owner authentication additionally requires `INSTALLATION_ID=local-only` and loopback ingress. Bind the private Worker listener to loopback; never tunnel the local authentication bypass. Do not commit the operator binding or private persistence directory.

Authenticated `POST /internal/status` with `{}` returns:

```json
{
  "phase": "STOPPED",
  "epoch": 0,
  "execution_enabled": false,
  "owner_alpha": {
    "session_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "persona_id": "11111111-1111-4111-8111-111111111111",
    "expires_at": "2026-09-16T12:00:00.000Z",
    "max_runs": 2,
    "max_task_seconds": 120
  }
}
```

`owner_alpha` is omitted when off. The runtime must match all five policy fields, not treat `execution_enabled:false` as generally enabled. All internal HTTP routes retain runtime bearer authentication and strict payload validation. No new endpoint or schema version is introduced.

## Durable admission and recovery

Use a fresh, private local control-data directory. Initial policy custody requires epoch 0 / STOPPED, no boot/lease/provider-operation identity, empty provider reference, and no previous attempts, operations, effects, resource locks or controller operations. The existing `runtime_metadata` table stores `owner_alpha` as `{policy,admitted_run_ids}`. The ID list is the durable consumed-run counter; it contains at most three independently admitted coordinator IDs. Policy replacement, removal, a new session ID, missing historical custody, or inconsistent attempt history fails closed on reconstruction. There is no reset, migration or reuse command for alpha data.

The existing `POST /internal/boot` body `{ "boot_id": "<UUID>" }` can transition that fresh session to epoch 1 / BOOTING and register the boot. `ready` then opens the normal claim loop. This path makes no provider wake, stop or observation call. A restart of the Worker can reconstruct the same policy and current boot custody; a replacement executor boot cannot steal it. An expired executor lease still fences every callback and leaves recovery required.

Only a direct owner `message.send` to the configured persona's private conversation can queue alpha inference. Claims recheck persona, direct-message provenance, coordinator role, absence of room/routine/occurrence scope, and attempt zero. Routine, schedule, trigger, room, background, agent mutation and retry paths are not admitted. Existing budget/context/native-family predicates still apply. Each successful claim atomically consumes one ID and inserts attempt 1; callbacks and queued messages do not consume more runs, and failed transactions do not consume a run. There are no replacement attempts or automatic retries.

The attempt deadline is the earlier of session expiry and claim time plus `max_task_seconds`. At expiry (including equality), no new claim is admitted. The watchdog continues to request cancellation and preserve unknown outcomes; it does not claim process termination or settle unknown operations. Production execution and native-verification flags remain false throughout.

## Restricted callback surface

The alpha runtime allowlist is `boot`, `ready`, `claim`, `heartbeat`, `submitted`, `coordinator-release`, `output-preview`, `steer-pending`, `agent-routines`, and `agent-skill`, plus read-only `status`. Existing owner read APIs and `run.cancel` remain available. Read-only routine/skill APIs retain their admitted snapshot and scope checks. Steering cannot be enqueued in alpha, so `steer-pending` returns no instructions.

Policy expiry does not invalidate exact existing-family heartbeat, native submission receipts, coordinator release, scoped reads or provisional output. Current epoch, boot, live executor lease, session-owned run and current attempt are still mandatory. Output remains provisional and readable during deadline cancellation; owner cancellation/context invalidation fences it. Root release neither creates a completed result nor settles attempts, operations, effects or descendants.

Final `complete`, native-child registration, effect/resource operations, agent commands, connector authorization, flight operations, question mutation, budget reports and sleep are denied. Unknown custody is retained for explicit investigation, not retried or silently cleared. The runtime must independently enforce its root-only/no-mutating-tools boundary; the Worker cannot stop an uncooperative local process from invoking native tools.

## Credential-free verification

`npx vitest run tests/owner-alpha.test.ts` exercises real SQLite and Worker HTTP ingress with a Cloudflare host shim. It covers default-off behavior, strict configuration, fresh boot, policy persistence, claim count across reconstruction, transactional rollback, expiry boundaries, callback fencing, unknown custody, denied mutations and absence of provider/network calls. These are control-boundary fixtures, not authenticated inference, live provider, or production gate evidence.
