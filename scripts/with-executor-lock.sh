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
holder_file="$state/holder.pid"

# Portable process-group kill: prefer the holder's own pgid (works without
# setsid, which this script never assumes is present); fall back to the bare
# pid if `ps` cannot resolve one. Never treats a zero/blank/malformed pid as
# alive.
kill_holder() {
  [[ -f "$holder_file" ]] || return 0
  local pid pgid waited=0
  pid="$(cat -- "$holder_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  [[ "$pgid" =~ ^[0-9]+$ ]] || pgid="$pid"
  kill -TERM "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null && (( waited < 10 )); do
    sleep 0.5
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
}

# Quick non-consuming probe: if the lock is free right now, the immediate
# blocking acquire below is effectively instant (matches the pre-G3 fast
# path exactly). If it is held, a live holder gets one takeover attempt
# before we wait out the rest of the 30s budget.
if ! flock --nonblock --conflict-exit-code 73 "$state" true 2>/dev/null; then
  kill_holder
fi

exec flock --timeout 30 --conflict-exit-code 75 --no-fork "$state" \
  bash -c 'printf "%s\n" "$$" > "$1/holder.pid"; shift; exec "$@"' _ "$state" "$@"
