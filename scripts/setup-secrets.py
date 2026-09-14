#!/usr/bin/env python3
"""Prepare private local secret files. No network calls; never prints a value."""
import argparse, getpass, os, secrets
from pathlib import Path
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--generate', action='store_true', help='Create runtime and wake secrets if absent')
parser.add_argument('--store', choices=['PROVIDER_TOKEN','CLOUDFLARE_API_TOKEN','CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET'], help='Read a provider-issued value through a hidden terminal prompt')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / '.local' / 'secrets'
root.mkdir(parents=True, exist_ok=True, mode=0o700)
if root.is_symlink(): raise SystemExit('Refusing symlink secret directory')
os.chmod(root,0o700)
def put(name, value):
    if not value or '\n' in value or '\r' in value: raise SystemExit('Value must be a nonempty single line')
    try: fd=os.open(root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:
        print(name+': already exists; preserved'); return
    with os.fdopen(fd,'w') as f: f.write(value+'\n'); f.flush(); os.fsync(f.fileno())
    print(name+': saved privately')
if args.generate:
    for name in ['RUNTIME_TOKEN','SPRITE_WAKE_TOKEN']: put(name,secrets.token_urlsafe(32))
if args.store:
    if not os.isatty(0): raise SystemExit('Use an interactive terminal for hidden input')
    put(args.store,getpass.getpass(args.store+' (hidden): ').strip())
if not args.generate and not args.store: parser.print_help()
