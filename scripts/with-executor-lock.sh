#!/usr/bin/env bash
set -euo pipefail

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
[[ -d "$state" && "$(stat -c %u -- "$state")" = "$(id -u)" && "$(stat -c %a -- "$state")" = 700 ]] || {
  echo 'Executor state must be an owner-only directory' >&2
  exit 64
}
# --no-fork retains ownership across exec. Descendants inheriting the descriptor
# keep the lock held after their parent exits; we must not take over live work.
exec flock --nonblock --conflict-exit-code 73 --no-fork "$state" "$@"
