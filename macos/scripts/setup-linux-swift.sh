#!/usr/bin/env bash
set -euo pipefail

# Optional Linux policy-test compiler, not an Apple SDK or a distributable app.
# Swift.org release signature verified at integration; this pins those exact bytes.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$(uname -s)/$(uname -m)" != Linux/x86_64 ]] || ! grep -q '^VERSION_ID="12"$' /etc/os-release || ! grep -q '^ID=debian$' /etc/os-release; then
  echo 'This compiler pin supports Debian 12 x86_64 only.' >&2
  exit 1
fi
ARCHIVE="$ROOT/.local/swift-download/toolchain.tar.gz"
DEST="$ROOT/.local/swift-toolchain"
mkdir -p "$(dirname "$ARCHIVE")" "$DEST"
if [[ ! -f "$ARCHIVE" ]]; then
  TEMP="$(mktemp "$(dirname "$ARCHIVE")/download.XXXXXX")"
  trap 'rm -f "$TEMP"' EXIT
  curl --fail --location --silent --show-error --max-time 600 \
    https://download.swift.org/swift-6.3.3-release/debian12/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE-debian12.tar.gz -o "$TEMP"
  printf '%s  %s\n' 19e0c78cad5418ad48bfa87aa20c53ac9ac9996d1695d04dd94f7c7ea4eb133f "$TEMP" | sha256sum -c -
  mv "$TEMP" "$ARCHIVE"
fi
printf '%s  %s\n' 19e0c78cad5418ad48bfa87aa20c53ac9ac9996d1695d04dd94f7c7ea4eb133f "$ARCHIVE" | sha256sum -c -
tar -xzf "$ARCHIVE" --strip-components=1 -C "$DEST"
"$DEST/usr/bin/swift" --version
