#!/usr/bin/env bash
set -euo pipefail

# Reviewed upstream release; no plugins, credentials or key generation.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)/$(uname -m)" != Linux/x86_64 ]]; then
  echo 'Pinned age setup supports Linux x86_64 only; review another release asset before use.' >&2
  exit 1
fi
DEST="$ROOT/.local/age-v1.3.2"
mkdir -p "$DEST"
ARCHIVE="$DEST/release.tar.gz"
if [[ ! -f "$ARCHIVE" ]]; then
  TEMP="$(mktemp "$DEST/download.XXXXXX")"
  trap 'rm -f "$TEMP"' EXIT
  curl --fail --location --silent --show-error --max-time 120 \
    https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz -o "$TEMP"
  printf '%s  %s\n' cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 "$TEMP" | sha256sum -c -
  mv "$TEMP" "$ARCHIVE"
fi
printf '%s  %s\n' cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 "$ARCHIVE" | sha256sum -c -
tar -xzf "$ARCHIVE" -C "$DEST" age/age age/age-keygen age/LICENSE
printf '%s  %s\n' \
  eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c "$DEST/age/age" \
  0a0009db842259d6717f7eeb30acb6b90d2a2eb924c6acd0a0db0ca1f1537899 "$DEST/age/age-keygen" | sha256sum -c -
"$DEST/age/age" --version
