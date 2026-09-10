#!/usr/bin/env bash
# Disposable localhost test Gateway; never a launchd service.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local/gateway
if [[ ! -f .local/gateway/openclaw.json ]]; then
  python3 - <<'PY'
import json,pathlib,secrets
p=pathlib.Path('.local/gateway')
t=secrets.token_hex(32)
(p/'.env').write_text('OPENCLAW_GATEWAY_TOKEN='+t+'\n')
pathlib.Path('.local/test-token').write_text(t)
c={'gateway':{'mode':'local','bind':'loopback','port':19789,'auth':{'mode':'token','token':'${OPENCLAW_GATEWAY_TOKEN}'},'nodes':{'browser':{'mode':'off'}}},'browser':{'enabled':True,'headless':True,'ssrfPolicy':{'allowedHostnames':['localhost','127.0.0.1']},'profiles':{'openclaw':{'cdpPort':19800}}},'discovery':{'mdns':{'mode':'off'}}}
(p/'openclaw.json').write_text(json.dumps(c,indent=2)+'\n')
PY
fi
export OPENCLAW_STATE_DIR="$PWD/.local/gateway"
exec caffeinate -i scripts/claw gateway run
