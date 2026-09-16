# Executor lock: bounded descendant evidence

Local evidence, 2026-09-16, for E02/E09. This is **not** a completed
one-installation service boundary, safe takeover, or process-tree settlement.
No launcher, runtime, provider, connector admission or production gate changes.

## What the real subprocess fixture proves

`tests/runtime-process-lock.mjs` invokes the existing
`scripts/with-executor-lock.sh` against a disposable private directory on Linux.
The launcher uses `flock --no-fork` on that directory's inode. Both new cases
start a real Node parent, which spawns one real Node child:

| Spawn configuration | Before parent exit | After parent exit, same child still live | After child cleanup |
| --- | --- | --- | --- |
| Explicitly pass the parent's lock descriptor into child fd 3 | Contender exits 73 | Contender exits 73; child retains directory descriptor | Contender enters, exits 0 |
| Node `spawn(executable, args)` with default options | Contender exits 73 | Contender **enters and exits 0**, despite live child; child has no directory descriptor | Contender enters, exits 0 |

The negative case is an exclusion gap, **not permission to take over**. This
child uses private-file coordination, does not read stdin or write stdout/stderr,
and can survive the loss of its default pipes. This does not imply every program
survives parent exit, or that default-spawn descendants are necessarily settled.
Neither case uses `detached`, a browser, Codex, a provider or an account.

The harness waits for explicit readiness before asking the parent to exit. It
checks the launcher's PID survives exec, matches the child PID reported by the
parent to the child's self-report, and verifies the original parent relationship.
Directory descriptors are identified by device/inode rather than guessing
flock's descriptor number. Atomic readiness/reply files prevent partial JSON
reads. Only after observing parent exit does the harness request a fresh child
reply and run the competing launcher. Linux `/proc/PID/stat` start time remains
identical across the contender check, and the child is neither zombie nor dead.
Contender exit status and presence/absence of its body-written marker both count.

Cleanup requests that exact child's exit through its private stop file and waits
for `/proc/PID` to disappear, not merely for `kill(pid, 0)` or a zombie state.
The parent and contenders are reaped through Node child-process exit events.
Each fixture parent/child has a 20-second self-exit ceiling, each polling wait
and contender has a five-second bound, and each new test has a 30-second timeout.
An immediately registered cleanup hook also stops the owned parent on failure;
there are no process-name patterns or process-group kills. If the environment
cannot reap the orphan within the bound, the test fails rather than reporting
cleanup success. The normal successful path removes the disposable directory.

## Why descriptor inheritance matters

- [Linux flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html): locks
  attach to the open file description, survive exec, and are shared by duplicated
  descriptors. They release when all such descriptors close, or through explicit
  unlock. Merely opening the same inode independently does not inherit that lock.
- [Node spawn stdio](https://nodejs.org/api/child_process.html#optionsstdio): the
  default creates pipes for descriptors 0–2; descriptors 3+ default to ignore.
  A positive integer in the stdio array explicitly shares a parent's descriptor.
- [Node exit event](https://nodejs.org/api/child_process.html#event-exit): direct
  process exit is distinct from stdio closure. Neither event inventories or
  confirms termination of an arbitrary descendant tree.

The launcher's existing comment correctly qualifies descendants as **inheriting
the descriptor**. The default-spawn counterexample prevents reading that comment
as an unconditional whole-tree exclusion guarantee. The fixture only tests the
unchanged directory inode on a local filesystem; directory replacement, shared
mounts, arbitrary native descendants and cross-machine fencing are not covered.

## Implications for a future service boundary

One installation needs explicit process/descendant ownership independent of lock
availability: stable identities, cancellation and verified termination, retained
uncertainty after owner loss, and durable effect/task reconciliation. Passing a
lock fd deliberately can preserve exclusion for that child, but does not prove
its own descendants inherit it, prevent explicit close/unlock, settle effects,
or establish provider sleep safety. A service manager or containment boundary
would need its own supported-interface implementation and behavioral evidence.
No such implementation is added here. E02/E09 and live connector admission remain
open; root exit and successful lock acquisition must not clear unknown work.

## Reproduction and observed scope

```sh
node --test tests/runtime-process-lock.mjs
node --test tests/runtime-process-lock.mjs tests/runtime-file-journal.mjs tests/runtime-codex-service.mjs
```

Observed in the Linux orb with Node v26.5.1, util-linux flock 2.38.1 and systemd
PID 1: focused **4/4**, related **25/25**, no skips or cancellations. Both new
cases logged the exact parent/child PID, child start time, descriptor inventory
and contender result, followed by confirmed child reaping and successful final
contender. Private delivery logs are `.local/executor-lock-focused.log` and
`.local/executor-lock-related.log`. This is evidence for this environment, not
an assertion that every supported Node/OS/provider combination was tested.
