#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for executable in amp Xvfb openbox dbus-run-session xdotool xdpyinfo; do
  command -v "$executable" >/dev/null || { echo 'Desktop prerequisites missing; run bash scripts/setup-desktop.sh in an orb.' >&2; exit 1; }
done
/usr/bin/python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk'
root="${CLAWBOT_OPENCLAW_PACKAGE_ROOT:-$PWD/.local/native-execution/node_modules/openclaw}"
mkdir -p .local
parent="$(mktemp -d "$PWD/.local/desktop-acceptance-XXXXXX")"
directory="$parent/proof"
service="claw-desktop-$$"
node scripts/probe-desktop.mjs prepare "$root" "$directory"
printf -v launch 'node %q serve %q %q' "$PWD/scripts/probe-desktop.mjs" "$root" "$directory"
started=false
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$started" == true ]]; then
    amp orb service stop "$service" || result=1
    [[ ! -e /tmp/.X11-unix/X99 ]] || result=1
  fi
  echo "Private desktop evidence retained at $directory"
  exit "$result"
}
trap cleanup EXIT
started=true
amp orb service start "$service" --command "$launch"
ready=false
for attempt in $(seq 1 30); do
  if node scripts/probe-desktop.mjs status "$root" "$directory" > "$parent/status.json" 2> "$parent/status-error.log" &&
    jq -e '(.nodes.pending | length) > 0 or ([.connected.nodes[] | select(.connected)] | length) > 0' "$parent/status.json" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Desktop node readiness failed.' >&2; exit 1; }
node scripts/probe-desktop.mjs proof "$root" "$directory"
