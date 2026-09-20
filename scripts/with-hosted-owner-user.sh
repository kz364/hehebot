#!/usr/bin/env bash
set -euo pipefail

# Production root-to-nonroot launch bootstrap for the hosted owner runtime.
# Usage: with-hosted-owner-user.sh UID GID -- COMMAND [ARGS...]
# The caller must be the real root service that owns the launch: this script
# never elevates, mounts, or reads configuration, and stays in the caller's
# user namespace so the root-managed floor keeps its authentic ownership.
# It performs one supported setpriv call that drops to the owner identity with
# supplemental groups, every capability set, and future privileges cleared
# before the command runs. Because Debian's libcap-ng logs failed bounding-set
# drops instead of failing setpriv, the dropped process reads back its own
# /proc/self/status and refuses to run the command unless the boundary really
# holds: non-root uids, all five capability masks empty, NoNewPrivs set.
if (( EUID != 0 )); then
  echo 'with-hosted-owner-user: caller must be root' >&2
  exit 64
fi
usage() {
  echo 'Usage: with-hosted-owner-user.sh UID GID -- COMMAND [ARGS...]' >&2
}
if (($# < 4)) || [[ $3 != -- ]]; then
  usage
  exit 64
fi
uid=$1
gid=$2
valid_id() {
  [[ $1 =~ ^[1-9][0-9]{0,9}$ ]] && (($1 <= 4294967294))
}
valid_id "$uid" || { echo "with-hosted-owner-user: invalid uid '$uid'" >&2; exit 64; }
valid_id "$gid" || { echo "with-hosted-owner-user: invalid gid '$gid'" >&2; exit 64; }
shift 3
# Trusted absolute system executables only; the caller's PATH cannot redirect
# the privileged drop, and nothing else is read or evaluated while privileged.
setpriv_bin=/usr/bin/setpriv
bash_bin=/bin/bash
awk_bin=/usr/bin/awk
[[ -x $setpriv_bin && -x $bash_bin && -x $awk_bin ]] || {
  echo 'with-hosted-owner-user: required system executable missing' >&2
  exit 64
}
verify=''
read -r -d '' verify <<'VERIFY' || true
/usr/bin/awk -F '\t' 'BEGIN { uid_ok = 0; caps_ok = 1; nnp_ok = 0 }
$1 == "Uid:" { uid_ok = ($2 != 0 && $3 != 0 && $4 != 0 && $5 != 0) }
$1 == "CapInh:" || $1 == "CapPrm:" || $1 == "CapEff:" || $1 == "CapBnd:" || $1 == "CapAmb:" { if ($2 != "0000000000000000") caps_ok = 0 }
$1 == "NoNewPrivs:" { nnp_ok = ($2 == 1) }
END { exit (uid_ok && caps_ok && nnp_ok) ? 0 : 91 }' /proc/self/status || exit 91
exec "$@"
VERIFY
# One supported setpriv call: the reuid must precede the capability drops,
# because an emptied bounding set blocks the setresuid down from root.
exec "$setpriv_bin" --reuid="$uid" --regid="$gid" --clear-groups \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs -- \
  "$bash_bin" -c "$verify" with-hosted-owner-boundary "$@"
