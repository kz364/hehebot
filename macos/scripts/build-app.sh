#!/bin/bash
set -euo pipefail
if [[ $(uname -s) != Darwin ]]; then
  echo 'Requires macOS 14+ and Xcode 15+ (Swift 5.9+ / macOS 14 SDK).' >&2
  exit 1
fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
swift build --package-path "$ROOT" -c release
BIN=$(swift build --package-path "$ROOT" -c release --show-bin-path)
APP="$ROOT/dist/Hehebot Portal.app"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN/HehebotPortal" "$APP/Contents/MacOS/HehebotPortal"
# SwiftPM's generated Bundle.module accessor searches beside Bundle.main.bundleURL.
cp -R "$BIN/HehebotPortal_HehebotPortal.bundle" "$APP/"
cp "$ROOT/Support/Info.plist" "$APP/Contents/Info.plist"
echo "Prepared unsigned app: $APP"
echo 'Not a distribution or security-accepted build. Entitlements require separately authorized signing.'
