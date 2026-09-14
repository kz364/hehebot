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

Exit 2 means missing, unreadable, unsafe, inconsistent or incomplete selected
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

## Verification

```sh
node --test tests/runtime-codex-recovery-inspect.mjs
```

Tests use private real FileJournal records, asymmetric parent/child identities,
secret canaries, missing/corrupt/contradictory data, unsafe files and a real
kernel-locked CLI read. They compare file content, inode, size, modes and mtime
before/after. No authenticated inference or live provider behavior is exercised.
