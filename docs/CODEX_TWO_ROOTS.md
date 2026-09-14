# Two independently admitted roots: blocked by Worker admission

Run the credential-free diagnostic after normal Codex fixture prerequisites:

```sh
node scripts/test-codex-tools.mjs --two-roots
```

The current supported result is **exit 2**, `status: "blocked"`,
`blocker: "WORKER_SINGLE_COORDINATOR_ADMISSION"`. This is not a passing
two-admitted-root isolation test. Unexpected fixture failures exit 1. Existing
fixture modes retain their existing behavior; this diagnostic is not silently
included in the normal passing wrapper.

## Actual evidence

The fixture creates two distinct personas with asymmetric reviewed skills:
19-versus-43 for the first persona, 71-versus-103 for the second. It independently
queues both logical coordinator runs through the public HTTPS Worker API and
claims the first with the real fenced runtime identity. It attempts the second
claim while the first is claimed, after actual native submission is acknowledged,
and after the native root's terminal event. All three requests return `null`.
Fresh SQLite-backed Worker state keeps the first run running and the second
queued at attempt zero. No second grant or native root is fabricated.

One pristine Codex 0.154.0 app-server uses supported per-root
`thread/start.config.mcp_servers` with a private read-only-tool grant. Three
scripted loopback responses drive two distinct native MCP invocations. The first
returns the exact admitted skill ID and body even after owner disablement; the
second attempts the other persona's skill and receives a tool failure without
that skill body. A direct request through the same Worker runtime scope separately
confirms HTTP 404, the intentional missing-from-admitted-snapshot response.
The native journal records two invocation IDs and the exact terminal root;
effects remain unknown and sleep remains denied.

## Why a second root cannot be claimed here

`LifecycleCore.claim` in `src/core/lifecycle.ts` returns null whenever any
coordinator has status claimed, running, finishing or cancelling. It then selects
only queued coordinator runs. This is a global coordinator gate, not a per-persona
capacity gate. Native completion does not settle the Worker task and therefore
does not remove it. Registering a native child is metadata for observed ancestry,
not an independent root admission workaround. Marking the first run complete
without settlement proof or inserting task rows directly would fabricate evidence.

The remaining positive test requires an explicitly designed and separately
verified Worker contract for independent coordinator concurrency (or a legitimate
settled sequential-admission scenario with different acceptance claims). This
fixture does not modify that contract, fake settlement or relax production gates.

All model decisions are scripted; no account authentication, paid model use,
personal connectors or production changes occur. This proves one admitted root's
scope behavior and a concrete concurrency blocker—not two-root native identity
separation, filesystem isolation or per-child authentication. Existing shared
root/descendant authority is unchanged. Successful blocked diagnostics stop the
fixture processes and remove disposable TLS, bearer, native home and SQLite state.
