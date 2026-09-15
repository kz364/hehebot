# Offline Codex recovery inspection

`runtime/codex-recovery-inspect.mjs` is a diagnostic, not a recovery executor.
It always reports `recoveryRequired: true`, `resumeAllowed: false`, and
`sleepAllowed: false`. Exit zero means a readable diagnostic, never safe admission.

## Operator procedure

Use the existing executor state directory on the same local filesystem. First
stop the executor through its normal supervised shutdown. Do not kill unrelated
processes, remove state, replace lock paths, or assume a dead parent means its
descendants stopped. Acquire the **same directory kernel lock** used by
`scripts/with-executor-lock.sh`. With absolute paths configured locally:

```sh
test -d "$STATE" && test ! -L "$STATE" &&
flock --nonblock --conflict-exit-code 73 --no-fork "$STATE" \
  node "$REPO/runtime/codex-recovery-inspect.mjs" "$STATE/journal"
```

`STATE` must already exist; do not change its path while inspecting. Exit 73 means the
lock is occupied: stop here, do not bypass it. The inspector does not acquire or
verify the lock itself, claim ownership, contact native processes or the Worker,
load account state, or attempt automatic takeover. Reading without the stopped
executor's lock is not a coherent operator snapshot.

Exit 2 means missing, unreadable, unsafe, inconsistent, unresolved or incomplete selected
records. Exit 64 means invalid CLI usage. Output has stable issue codes, not raw
exceptions, paths, prompts or arbitrary journal fields. Treat IDs as private
installation metadata; do not publish reports indiscriminately.

## What it reads and what it cannot establish

The inspector reads `service.json`, the identity-derived current bridge dispatch,
that dispatch's native attempt, and optional exact child cancellation receipts.
It does not enumerate historical attempts or read grants, credential files,
native databases, MCP response files or tool argument files. Selected
JSON records contain some excluded fields in memory while being parsed; only an
explicit typed projection is emitted; context bodies are not inspected or emitted.
It makes no network/native calls, retries,
state writes, hold releases or settlement decisions.

It also scans exact `question_<64 lowercase hex>.json` records independently of
the current dispatch, so missing service metadata cannot hide old question custody.
Question output contains only total/unresolved/resolution-observed counts and phase
counts, never question IDs, text, answers, native IDs or input hashes. `resolved`
means a journaled resolution, not acceptance or consumption. Every other phase,
including `handoff_unknown`, emits `QUESTION_CUSTODY_UNRESOLVED`.
Invalid question records make `questions.complete` false; scan limits or directory
errors emit `QUESTION_SCAN_INCOMPLETE`. Partial counts are not a complete inventory.
Question scanning is bounded to 16384 directory entries, 4096 candidates and 16 KiB
per question record. It validates exact fields and filename/custody hash binding;
this checks local consistency, not authenticity or current Worker authority.

The report includes service epoch/boot, current Worker run/attempt and adapter
attempt ID, exact observed native root/child thread and turn IDs, command/MCP/spawn
invocation statuses and cancellation acknowledgments. Unknown claim custody never
borrows a stale native attempt left in a reused bridge cursor. Missing child turns,
conflicting root IDs, child ancestry and cancellation identities remain unknown.
An accepted interrupt is only an acknowledgment; an interrupted turn is only an
observed terminal turn. Neither settles child commands, MCP effects or the task.
Coverage remains unknown even when every reported invocation is terminal.

Only canonical absolute owner-private directories and owner-private regular files
are accepted. File opens reject symlinks and nonregular files; reads are bounded
to 1 MiB per record and check size/timestamps for changes during that read. These
checks are **not a multi-file transaction**, a complete concurrent-write detector,
or a same-UID security boundary. A crash can leave a coherent but incomplete
durable prefix. The report therefore never certifies snapshot consistency or
permission to resume. Ordinary reads may update filesystem access times; content,
modification times and journal records are not written.

After inspection, retain the state and reconcile uncertain Worker/native/effect
outcomes through separately supported procedures. This tool supplies evidence
only; safe resume, recursive settlement and production sleep gates stay open work.

## Exact native command history recovery

The adapter's separate `reconcile` and `reconcileChild` APIs use supported
`thread/read` for an already acknowledged exact turn. They can recover a missed
terminal command observation only for a recorded `commandExecution` item ID in
that same thread/turn. Child readback additionally verifies the recorded native
parent. A completed root, omitted item, another turn's matching item ID, or an
empty background-terminal list cannot settle a command.

Updates serialize with live notifications and validate the whole selected patch
before one journal write. Duplicate IDs, invalid statuses and conflicting terminal
observations reject reconciliation without partial settlement. Identical replay
does not write. This does not import unrecorded items, infer statusless tool
completion, settle MCP effects, discover missing children, or remove unknown
operation coverage. Production admission and sleep remain denied.

`node scripts/test-codex-native.mjs` preserves an open command receipt while
withholding its actual late completion from that receipt. After the FIFO-backed
command exits, the fixture observes native unload and process exit, restarts the
pristine pinned server, and recovers the command through exact persisted history.
The executed report includes `missedCommandCompletionRecovered: true`. This is
settled-work readback with a deliberately missed notification, not recovery of a
still-running subprocess after a crash. Adapter tests separately cover root/child
namespaces, omitted items, unchanged siblings, replay, malformed readback and a
newer conflicting live observation arriving while the history RPC is pending.

## Verification

```sh
node --test tests/runtime-codex-recovery-inspect.mjs
```

Tests use private real FileJournal records, asymmetric parent/child identities,
secret canaries, missing/corrupt/contradictory data, unsafe files and a real
kernel-locked CLI read. They compare file content, inode, size, modes and mtime
before/after. No authenticated inference or live provider behavior is exercised.
