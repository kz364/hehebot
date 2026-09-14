#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pin="$(node --input-type=module -e "import {PINNED_OPENCLAW} from './runtime/openclaw-adapter.mjs'; process.stdout.write(PINNED_OPENCLAW)")"
root="${CLAWBOT_OPENCLAW_PACKAGE_ROOT:-$PWD/.local/native-execution/node_modules/openclaw}"
prefix="$(dirname "$(dirname "$root")")"

if [[ -e "$root" || -L "$root" ]]; then
  if [[ ! -f "$root/package.json" ]]; then
    echo "Refusing to replace unknown native install at $root" >&2
    exit 1
  fi
  installed="$(node -e 'const fs=require("node:fs"); try { process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version || "") } catch { process.exit(1) }' "$root/package.json")"
  if [[ "$installed" != "$pin" ]]; then
    echo "Refusing to replace OpenClaw $installed; clawbot requires $pin" >&2
    exit 1
  fi
  echo "Reusing OpenClaw $pin at $root"
  exit 0
fi

if [[ -e "$prefix" || -L "$prefix" ]]; then
  echo "Refusing to install into existing unknown prefix $prefix" >&2
  exit 1
fi

mkdir -p "$prefix"
echo "Installing OpenClaw $pin into isolated ignored storage"
npm install --prefix "$prefix" --ignore-scripts --no-package-lock --no-save --no-audit --no-fund "openclaw@$pin"
installed="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$root/package.json")"
[[ "$installed" == "$pin" ]] || { echo "Pinned OpenClaw installation verification failed" >&2; exit 1; }
echo "OpenClaw $pin ready at $root"
