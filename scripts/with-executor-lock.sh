#!/usr/bin/env bash
set -uo pipefail

# Linux runtime launch boundary. The lock is kernel-owned, not a stale PID file.
# Keep this directory on one local persistent filesystem, never a shared mount.
if (($# < 2)); then
  echo 'Usage: with-executor-lock.sh ABSOLUTE_PRIVATE_STATE_DIR COMMAND [ARGS...]' >&2
  exit 64
fi
state="$1"
shift
[[ "$state" = /* && ! -L "$state" ]] || { echo 'Private absolute state directory required' >&2; exit 64; }
umask 077
mkdir -p -- "$state"
[[ -d "$state" && "$(stat -c %u -- "$state" 2>/dev/null || stat -f %u -- "$state")" = "$(id -u)" && "$(stat -c %a -- "$state" 2>/dev/null || stat -f %OLp -- "$state")" = 700 ]] || {
  echo 'Executor state must be an owner-only directory' >&2
  exit 64
}

# G3 (GROK_ALIGNMENT A2): a contended lock no longer just refuses. It kills the
# prior holder's process group (SIGTERM, then SIGKILL after a short grace) and
# retries acquiring for up to 30s total; only then does it give up and report
# RECOVERY_REQUIRED. No process-death proof is required before that -- the
# Worker-side epoch fence (LifecycleCore.advanceGeneration) is what actually
# retires the prior generation's work; this script only clears the same-
# machine OS resource so the successor can boot.

# Identify a contended lock's live holder directly from the kernel's own lock
# table (lslocks), never from a self-reported bookkeeping file. The pid
# lslocks reports for a FLOCK on this exact, canonicalized path IS the
# process that holds the kernel lock -- nothing else can produce that fact --
# so a corrupted, stale or foreign value can never be mistaken for it (unlike
# a recorded-pid file, which could name anything, including a same-UID PID 1
# inside a container). This also leaves no stray file behind in the state
# directory: a bookkeeping file is never cleaned up by a holder's normal
# exit, since `exec` into the final command loses any shell-level trap.
current_holder_pid() {
  local target pid type path
  target="$(realpath -e -- "$state" 2>/dev/null)" || return 1
  command -v lslocks >/dev/null 2>&1 || return 1
  while read -r pid type path; do
    if [[ "$type" == "FLOCK" && "$path" == "$target" ]]; then printf '%s\n' "$pid"; return 0; fi
  done < <(lslocks -r -n -o PID,TYPE,PATH 2>/dev/null)
  return 1
}

# The holder always becomes its own session/process-group leader (see the
# `setsid` in the exec chain below), so a genuine holder always satisfies
# pgid==pid. Only THEN is it safe to signal the negative pgid (the group),
# which is how a descendant that inherited the lock fd is fenced along with
# it; a holder that is not its own group leader (e.g. one that predates
# setsid, or one recorded when `setsid` itself was skipped as already
# redundant) is signalled alone instead, since an unverified pgid may be a
# large *ambient* group shared with the caller (the supervisor, or, in
# tests, the test runner itself).
kill_holder() {
  local pid pgid waited=0
  pid="$(current_holder_pid)" || return 0
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$pgid" =~ ^[0-9]+$ && "$pgid" == "$pid" ]]; then
    kill -TERM "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  while kill -0 "$pid" 2>/dev/null && (( waited < 10 )); do
    sleep 0.5
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    if [[ "$pgid" =~ ^[0-9]+$ && "$pgid" == "$pid" ]]; then
      kill -KILL "-$pgid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
}

# Quick non-consuming probe: if the lock is free right now, the immediate
# blocking acquire below is effectively instant (matches the pre-G3 fast
# path exactly). If it is held, a live holder gets one takeover attempt
# before we wait out the rest of the 30s budget.
if ! flock --nonblock --conflict-exit-code 73 "$state" true 2>/dev/null; then
  kill_holder
fi

# setsid(2) succeeds in place (no fork) only when the calling process is not
# already a process-group leader. Every real caller nests two of these locks
# (native-home wrapping session/state -- see owner-alpha-session.mjs and the
# hosted-owner-* launchers), so by the time the inner lock reaches this line
# the outer lock's setsid has already made this exec chain its own session
# and process-group leader. Calling `setsid` again in that state cannot
# succeed in place: setsid(2) itself would fail on a leader, so the `setsid`
# utility silently FORKS a child to satisfy it and (without --wait) does not
# propagate the child's exit code, returning its own success immediately.
# That would both change the PID from the caller's spawn() through to the
# executor for the inner lock (breaking PID-based identity downstream) and
# discard the real exit code of whatever the inner lock ultimately runs.
# Skip setsid entirely once we are already isolated; only call it the first
# time (outermost lock), which is exactly when it is needed to keep a
# takeover's future group-kill off an ambient group we do not own.
setsid_cmd=setsid
if command -v setsid >/dev/null 2>&1; then
  self_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d '[:space:]')"
  self_sid="$(ps -o sid= -p $$ 2>/dev/null | tr -d '[:space:]')"
  [[ "$self_pgid" == "$$" && "$self_sid" == "$$" ]] && setsid_cmd=
else
  setsid_cmd=
fi
exec flock --timeout 30 --conflict-exit-code 75 --no-fork "$state" $setsid_cmd "$@"
