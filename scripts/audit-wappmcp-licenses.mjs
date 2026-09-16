// Evidence only: never installs packages, extracts to disk, or executes upstream code.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const limit = 128 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyIntegrity(bytes, integrity) {
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity ?? '') ||
      createHash('sha512').update(bytes).digest('base64') !== integrity.slice(7)) {
    throw new Error('Locked artifact SHA512 integrity mismatch');
  }
}

// tarfile resolves PAX/GNU names before validation. No extract(), links, devices,
// upstream imports, or filesystem writes. Bound gzip output, entries and file sizes.
const reader = String.raw`
import sys, io, tarfile, json, hashlib, re
archive = tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()), mode='r:')
files = []
seen = set()
package = None
root = None
for index, member in enumerate(archive):
    if index >= 30000: raise ValueError('Too many archive entries')
    name = member.name.rstrip('/')
    parts = name.split('/')
    if any(p in ('', '..') for p in parts) or parts[0] == '.' or '\\' in name or any(ord(c) < 32 for c in name):
        raise ValueError('Unsafe archive path')
    original_name = name
    parts = [p for p in parts if p != '.']
    name = '/'.join(parts)
    if root is None: root = parts[0]
    if parts[0] != root: raise ValueError('Multiple archive roots')
    if name in seen: raise ValueError('Duplicate archive path')
    seen.add(name)
    if member.isdir(): continue
    if not member.isfile(): raise ValueError('Unsupported archive entry (including links)')
    if member.size > 64 * 1024 * 1024: raise ValueError('Oversize archive file')
    data = archive.extractfile(member).read()
    path = '/'.join(parts[1:])
    if not path: raise ValueError('Invalid package file')
    if path == 'package.json': package = json.loads(data)
    binary = data.startswith((b'\x7fELF', b'MZ', b'\x00asm', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe'))
    notice = bool(re.search(r'(^|/)(licen[sc]e|copying|copyright|notice|authors)([./_-]|$)', path, re.I))
    asset = bool(re.search(r'\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp[34]|pdf|wasm|node|exe|dll|so|a)$', path, re.I))
    source = data.startswith(b'#!') or bool(re.search(r'\.(js|mjs|cjs|ts|c|cc|h|cpp|py)$', path, re.I))
    record = dict(path=path, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), kind='binary' if binary else 'notice' if notice else 'asset' if asset else 'source' if source else 'other')
    if original_name != name: record['archivePath'] = original_name
    if notice:
        record['text'] = data[:65536].decode('utf-8', errors='replace')
        record['truncated'] = len(data) > 65536
    elif source or re.search(r'(^|/)readme', path, re.I):
        header = data[:4096].decode('utf-8', errors='replace')
        matches = [str(i + 1) + ': ' + line[:500] for i, line in enumerate(header.splitlines()) if re.search(r'copyright|licen[sc]e|public domain', line, re.I)]
        if matches: record['headerEvidence'] = '\n'.join(matches)
    files.append(record)
if package is None: raise ValueError('Missing package.json')
print(json.dumps(dict(package=package, archiveRoot=root, files=sorted(files, key=lambda f:f['path']))))
`;

export function inspectArtifact(bytes, entry, location) {
  verifyIntegrity(bytes, entry.integrity); // Must precede decompression/parsing.
  const tar = gunzipSync(bytes, { maxOutputLength: limit });
  let inspected;
  try {
    inspected = JSON.parse(execFileSync('python3', ['-I', '-c', reader], {
      input: tar, maxBuffer: limit, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch (error) {
    throw new Error(error.stderr?.toString().trim().split('\n').at(-1) || 'Archive reader failed');
  }
  const name = entry.name ?? location.split('node_modules/').at(-1);
  if (inspected.package.name !== name || inspected.package.version !== entry.version) {
    throw new Error(`Package identity mismatch: ${location}`);
  }
  const reasons = ['Artifact evidence is not legal approval; source, assets and redistribution notices need review'];
  if (!entry.license) reasons.push('Missing lock license metadata');
  if (entry.license !== inspected.package.license) reasons.push('Lock and artifact license declarations differ or are absent');
  if (!inspected.files.some(file => file.kind === 'notice')) reasons.push('No named license/notice file found');
  if (inspected.files.some(file => file.kind === 'binary')) reasons.push('Bundled binary: establish corresponding source, build provenance and notices');
  if (inspected.files.some(file => file.truncated)) reasons.push('Truncated notice evidence: inspect complete hashed file');
  return {
    location, name, version: entry.version, resolved: entry.resolved, integrity: entry.integrity,
    artifactSha256: sha256(bytes), lockLicense: entry.license ?? null,
    artifactLicense: inspected.package.license ?? null, legacyLicenses: inspected.package.licenses ?? null,
    repository: inspected.package.repository ?? null, scripts: inspected.package.scripts ?? {},
    archiveRoot: inspected.archiveRoot, status: 'review-required', reasons, files: inspected.files,
  };
}

async function download(url) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://registry.npmjs.org' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Only public locked npm registry artifacts are allowed');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Artifact HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('Compressed artifact exceeds limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function audit(lockBytes, fetchArtifact = download) {
  const lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion !== 3) throw new Error('Expected lockfile v3');
  const packages = [];
  for (const [location, entry] of Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!location) continue;
    if (entry.link || !location.startsWith('node_modules/')) throw new Error('Unsupported lock entry');
    const bytes = await fetchArtifact(entry.resolved);
    verifyIntegrity(bytes, entry.integrity);
    try {
      packages.push(inspectArtifact(bytes, entry, location));
    } catch (error) {
      packages.push({ location, version: entry.version, resolved: entry.resolved, integrity: entry.integrity,
        artifactSha256: sha256(bytes), status: 'review-required', inspectionError: error.message });
    }
  }
  if (!packages.length) throw new Error('Empty dependency inventory');
  return { schemaVersion: 1, status: 'review-required', licenseAuditComplete: false,
    redistributionApproved: false, lifecycleScripts: false, upstreamCodeExecuted: false,
    lockSha256: sha256(lockBytes), packageLocations: packages.length,
    inspectedLocations: packages.filter(p => !p.inspectionError).length,
    uninspectedLocations: packages.filter(p => p.inspectionError).map(p => p.location), packages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await audit(await readFile(new URL('../config/wappmcp/package-lock.json', import.meta.url)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 2; // Evidence collected, NOT an approval gate passing.
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', redistributionApproved: false, error: error.message }));
    process.exitCode = 1;
  }
}
