# Metering

Fly has no usage/billing API for Sprites (GraphQL has none, and Cost Explorer is
server-rendered), so Hehebot meters itself. This is an estimate, not a bill:
reconcile against Fly's Cost Explorer occasionally (see below).

## How it works

**Runtime sampler** (`runtime/metering-sampler.mjs`): while the v2 service is
running, it samples Linux cgroup v2 stats every 15s (default):

- CPU: `cpu.stat`'s `usage_usec`, as a delta between samples, converted to
  CPU-seconds.
- Memory: `memory.current`, integrated over the sample interval into
  GB-seconds (a Riemann sum, not an exact integral, but the sampling interval
  is short enough that the error is negligible for billing purposes).

The cgroup path is found from `/proc/self/cgroup`, falling back to
`/sys/fs/cgroup` if that can't be resolved. If neither is readable, the
sampler reports `cgroup_available: false` with zeroed totals for that period
instead of crashing or throwing.

Accumulated CPU-seconds and GB-seconds are reported to the Worker every 60s
(default) and once more on graceful stop, through the `metering` runtime RPC
(`src/core/runtime-types.ts`, `SCHEMAS/runtime.json`, the switch in
`src/worker/control-object.ts`). Reporting is fire-and-forget: a failed or
rejected report is dropped, never retried, and never blocks or fails the
runtime's main work. The RPC payload is fenced by the same epoch/boot/lease
identity check as `heartbeat` (`LifecycleCore.authorizeMetering`), so a
retired generation cannot write into the ledger.

Both the sample interval and the report interval are configurable through the
v2 runtime config (`metering: { sampleIntervalMs, reportIntervalMs }`, passed
through `runtime/v2-service-entry.mjs` and validated in
`runtime/codex-service.mjs`).

### Why awake time comes from the report interval, not a phase-transition log

Each `metering` report carries `interval_seconds`, the wall-clock time since
the previous report (or since start). The Worker sums these into "awake
seconds" for the day. This was chosen over adding a separate persistent log
of lifecycle phase transitions because:

- The report is already fenced by the same identity check as every other
  runtime RPC, so it isn't more trustworthy to derive awake time from a
  separate transition history.
- It avoids a new durable structure whose only job would be to double-check
  a number the fenced RPC already carries.

The tradeoff: if the process dies uncleanly between the last successful
report and the actual stop, that last partial interval (up to the report
interval, 60s by default) is not counted. This is a small, bounded
undercount, not an unbounded one.

## The Worker ledger

`src/core/metering.ts` stores one `runtime_metadata` row per **Jakarta
calendar day** (`metering:<YYYY-MM-DD>`, UTC+7, no DST) — the owner is in
Asia/Jakarta, so "today" in the portal matches their day, not UTC's. No
migration was needed; `runtime_metadata` is a generic key/value table already
used the same way by `token-usage:*` snapshots.

Each day row holds: `awake_seconds`, `cpu_seconds`, `gb_seconds`, `samples`,
`reports`, `updated_at`. Cost is computed on read, not stored, from
`HEHEBOT_METERING_RATES`.

### Rates

`HEHEBOT_METERING_RATES` is an optional Worker var, a JSON object with
exactly these three non-negative numeric fields:

```json
{"cpu_hour_usd": 0.07, "gb_hour_usd": 0.04375, "storage_gb_hour_usd": 0.000683}
```

Unset or empty falls back to those same defaults (published Fly Sprite rates
as of 2026-09: $0.07/CPU-hour, $0.04375/GB-hour RAM, $0.000683/GB-hour hot
storage, roughly $0.50/GB-month). `storage_gb_hour_usd` is accepted for
forward compatibility but not currently multiplied into the estimate — disk
sampling was left out per the task's own note that it's optional/skip-if-
expensive; there is no disk-usage sample being taken yet.

Malformed JSON or a shape that doesn't match exactly is rejected at Durable
Object construction with `INVALID_CONFIGURATION` (`src/core/metering.ts`'s
`parseMeteringRates`, following the same pattern as `lifecycle-config.ts`).

### Tokens

The Worker already stores per-run `token-usage:<run_id>` snapshots
(`src/core/token-usage.ts`), pruned 90 days after first write. These are
**not** bucketed by day — summing them per day without double-counting would
require attributing partial-run token growth to specific calendar days,
which the snapshot shape (one cumulative total per run, overwritten in
place) doesn't support cleanly. Rather than build that out, `metering`
surfaces a live sum of whatever token-usage snapshots are currently
retained, labeled explicitly as such (`tokens.note` in the API response and
the portal card).

## Exposure

`GET /v1/state` includes a `metering` object:

```json
{
  "calendar": "Asia/Jakarta",
  "rates": {"cpu_hour_usd": 0.07, "gb_hour_usd": 0.04375, "storage_gb_hour_usd": 0.000683},
  "today": {"awake_minutes": 12.3, "cpu_hours": 0.02, "gb_hours": 0.05, "estimated_usd": 0.0036, "samples": 41},
  "last_7_days": {...},
  "month_to_date": {...},
  "tokens": {"total_tokens_in_retained_snapshots": 12345, "note": "..."},
  "note": "Estimate from runtime samples × published Sprite rates; reconcile with Fly Cost Explorer."
}
```

The portal's Workspace column shows a "Runtime cost estimate" card (below
"Infrastructure budget") with today / last 7 days / month-to-date, and the
same reconciliation note.

## Debug logging (optional)

Off by default everywhere. Turn it on with either:

- `HEHEBOT_DEBUG=1` in the runtime's process environment, or
- `debug: true` in the v2 runtime config file (the JSON pointed to by
  `HEHEBOT_V2_CONFIG`, alongside `personas`, `stateRoot`, etc. — see
  `CONFIG_KEYS` in `runtime/v2-service-entry.mjs`).

When enabled, `runtime/debug-log.mjs` writes one JSON line per event to
`<stateDirectory>/logs/debug-YYYY-MM-DD.jsonl` (on the Sprite the state directory is per boot: `ls -t ~/.hehebot/state/*/logs/*.jsonl`) (mode 0600), keeping 7 days
and capping each day's file size (older lines are dropped once the cap is
hit, the file is never left to grow unbounded). Logged: every control RPC
(`type`, latency in ms, outcome/error code — this covers boot, ready, claim,
heartbeat, submitted, complete, prepare-sleep, commit-sleep, and `metering`
itself, since those are exactly the RPC types), metering sample/report
failures, and any other event a caller logs through the same module.

**Never logged:** message/reply text, tokens, Access credentials, or file
contents. `debug-log.mjs`'s `scrub()` also strips any detail key that looks
like it could carry those (`token`, `secret`, `password`, `credential`,
`authorization`, `text`, `body`, `payload`, `content`, `*message`) as a
backstop — callers should still only ever pass ids, types, sizes, durations
and error codes.

The browser gateway (`runtime/browser-gateway.mjs`, spawned by
`codex-service.mjs` as its own MCP server process per task) and the takeover
module (`runtime/browser-takeover.mjs`) build their own `debug-log.mjs`
logger from the browser grant's `debug`/`stateDirectory` fields — set by
`codex-service.mjs` only when its own debug gate (`config.debug` or
`HEHEBOT_DEBUG=1`) is on — or from `HEHEBOT_DEBUG=1` in the gateway process's
own environment. Logged per tool call: tool name, classification
(`read`/`action`), duration in ms, and outcome (`ok`/`error`/`timeout`/
`refused`, with an error code where one applies); separately, repeat/budget
stops, browser restarts, CAPTCHA/blocker detections, and takeover open/end
(plus one `browser_takeover`/`session` line with outcome/duration/viewed from
the takeover module itself). Never logged: typed text, a URL's query string,
page content or screenshots — a navigated URL is logged as origin+path only.

On the Worker side, `HEHEBOT_DEBUG` (optional in the `Env` type; not a
`wrangler.jsonc` var) gates the same kind of structured
`console.log(JSON.stringify({...}))` lines, visible with `npx wrangler tail
--env hehebot`, via the tiny helper `src/core/debug.ts` (a no-op unless
`HEHEBOT_DEBUG==='1'`, so it costs nothing when off). Wired into
`src/worker/control-object.ts`: every `/v1/commands` command (`type`,
`status`, `ms`), every runtime RPC the control object handles (`type`, `ms`,
`outcome`, and the error code on failure), hosted-owner wake requests
(`epoch`, `ms`, `outcome`), and `src/worker/index.ts`'s `scheduled()` Cron
handler (`status`, `ms`). Never logged: message/reply text, tokens, or
headers.

To enable Worker-side debug logging on a deployed installation: `wrangler
secret put HEHEBOT_DEBUG --env hehebot` and enter `1` (or set it as a plain
`var` in `wrangler.jsonc` if you don't need it kept secret — either way the
Worker only checks for the exact string `"1"`). Tail it live with `npx
wrangler tail --env hehebot`. Unset the secret (or set it to anything other
than `1`) to turn it back off; there is no restart needed since every log
call re-reads `env.HEHEBOT_DEBUG`.

## Reconciling with Fly Cost Explorer

1. Open `/v1/state` (or the portal's "Runtime cost estimate" card) for the
   period you want to check.
2. Open Fly's Cost Explorer for the same Sprite over the same date range
   (Jakarta day boundaries are UTC+7; Cost Explorer is typically UTC —
   convert before comparing day-by-day, or compare month totals to avoid the
   boundary skew).
3. Compare CPU-hours, GB-hours (RAM) and estimated cost. Expect the
   self-metered numbers to be a slight *undercount* (see the awake-time
   tradeoff above, and cgroup sampling granularity), not an overcount.
4. If they diverge by more than that, check whether `cgroup_available` was
   `false` for stretches of the period (via debug logs) — that means the
   sampler couldn't read cgroup stats at all and undercounted more than
   expected.
