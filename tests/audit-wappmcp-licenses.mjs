import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { audit, inspectArtifact, verifyIntegrity } from '../scripts/audit-wappmcp-licenses.mjs';

// Synthetic source only. Independent stdlib archive writer, no upstream fixtures.
function fixture(extra = [], pkg = {}) {
  const members = [
    { path: 'package/package.json', text: JSON.stringify({ name: 'example', version: '1.2.3', ...pkg }) },
    ...extra,
  ];
  const tar = execFileSync('python3', ['-I', '-c', `
import io, json, sys, tarfile
out = io.BytesIO()
with tarfile.open(fileobj=out, mode='w', format=tarfile.PAX_FORMAT) as tar:
 for member in json.load(sys.stdin):
  info = tarfile.TarInfo(member['path'])
  info.mode = member.get('mode', 0o644)
  data = bytes(member['bytes']) if 'bytes' in member else member.get('text', '').encode()
  info.size = len(data)
  if 'link' in member:
   info.type = tarfile.SYMTYPE
   info.linkname = member['link']
  if 'pax' in member: info.pax_headers = member['pax']
  tar.addfile(info, io.BytesIO(data))
sys.stdout.buffer.write(out.getvalue())
`], { input: JSON.stringify(members) });
  const bytes = gzipSync(tar);
  return { bytes, entry: { version: '1.2.3', resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } };
}
const inspect = ({ bytes, entry }) => inspectArtifact(bytes, entry, 'node_modules/example');

test('altered and empty bytes, missing SRI and weak SRI fail before parsing', () => {
  const { bytes, entry } = fixture();
  verifyIntegrity(bytes, entry.integrity);
  for (const altered of [Buffer.alloc(0), Buffer.concat([bytes, Buffer.from('changed')]), Buffer.from(bytes)]) {
    if (altered.length === bytes.length) altered[20] ^= 1;
    assert.throws(() => inspectArtifact(altered, entry, 'node_modules/example'), /integrity mismatch/);
  }
  for (const sri of [undefined, '', 'sha1-abc', entry.integrity.slice(0, -1)]) {
    assert.throws(() => verifyIntegrity(bytes, sri), /integrity mismatch/);
  }
});

test('missing, permissive and misleading license metadata never approve', () => {
  for (const license of [undefined, 'MIT', 'Public Domain']) {
    const f = fixture([{ path: 'package/LICENSE', text: 'Synthetic restrictive license, not MIT' }], { license });
    f.entry.license = 'MIT';
    const result = inspect(f);
    assert.equal(result.status, 'review-required');
    assert.equal(result.lockLicense, 'MIT');
    assert.equal(result.artifactLicense, license ?? null);
    assert.equal(result.files.find(f => f.path === 'LICENSE').text, 'Synthetic restrictive license, not MIT');
  }
  assert.ok(inspect(fixture()).reasons.includes('Missing lock license metadata'));
  assert.ok(inspect(fixture()).reasons.includes('No named license/notice file found'));
});

test('hashes exact files, preserves legacy licenses and identifies binary, asset and script evidence without execution', () => {
  const result = inspect(fixture([
    { path: 'package/hello.txt', text: 'hello' },
    { path: 'package/native', bytes: [127, 69, 76, 70, 0, 1] },
    { path: 'package/lib.wasm', bytes: [0, 97, 115, 109, 1, 0, 0, 0] },
    { path: 'package/image.png', text: 'synthetic asset' },
    { path: 'package/bin/run', text: '#!/usr/bin/env node\n// Copyright fixture\nthrow Error("must not execute")' },
  ], { licenses: [{ type: 'MIT' }], scripts: { postinstall: 'exit 93' } }));
  assert.equal(result.files.find(f => f.path === 'hello.txt').sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.deepEqual(result.files.filter(f => f.kind === 'binary').map(f => f.path), ['lib.wasm', 'native']);
  assert.equal(result.files.find(f => f.path === 'image.png').kind, 'asset');
  assert.match(result.files.find(f => f.path === 'bin/run').headerEvidence, /Copyright fixture/);
  assert.deepEqual(result.legacyLicenses, [{ type: 'MIT' }]);
  assert.equal(result.scripts.postinstall, 'exit 93');
});

test('rejects traversal, absolute names, duplicate paths, links and PAX traversal', () => {
  for (const extra of [
    [{ path: 'package/../escape', text: 'bad' }],
    [{ path: '/tmp/escape', text: 'bad' }],
    [{ path: 'package/alias', text: 'a' }, { path: 'package/./alias', text: 'b' }],
    [{ path: 'package/a', text: 'a' }, { path: 'package/a', text: 'b' }],
    [{ path: 'package/a', link: '../../escape' }],
    [{ path: 'package/a', pax: { path: 'package/../../escape' } }],
  ]) assert.throws(() => inspect(fixture(extra)), /Unsafe archive path|Duplicate archive path|Unsupported archive entry/);
});

test('interior dot aliases retain raw names, reject canonical collisions and never extract files', () => {
  const result = inspect(fixture([{ path: 'package/./dist/index.js', text: '// Synthetic license header' }]));
  const file = result.files.find(file => file.path === 'dist/index.js');
  assert.equal(file.archivePath, 'package/./dist/index.js');
  assert.equal(file.sha256, createHash('sha256').update('// Synthetic license header').digest('hex'));
  assert.throws(() => inspect(fixture([{ path: 'package/./package.json', text: '{}' }])), /Duplicate archive path/);
  assert.throws(() => inspect(fixture([{ path: 'package/x', pax: { path: 'package/./../escape' } }])), /Unsafe archive path/);
});

test('checks version and name, but supports explicit lockfile npm aliases', () => {
  assert.throws(() => inspect(fixture([], { version: '1.2.4' })), /identity mismatch/);
  assert.throws(() => inspect(fixture([], { name: 'impostor' })), /identity mismatch/);
  const f = fixture();
  f.entry.name = 'example';
  assert.equal(inspectArtifact(f.bytes, f.entry, 'node_modules/example-cjs').name, 'example');
});

test('identical aliases remain explicit evidence, while changed bytes or metadata reject', () => {
  const first = { path: 'package/./dist/index.js', text: '// Same bytes' };
  const alias = { path: 'package/dist/index.js', text: first.text };
  const result = inspect(fixture([first, alias]));
  const files = result.files.filter(file => file.path === 'dist/index.js');
  assert.equal(files.length, 1);
  assert.equal(files[0].archivePath, first.path);
  assert.deepEqual(files[0].identicalArchiveAliases, [alias.path]);
  assert.equal(result.status, 'review-required');
  assert.ok(result.reasons.some(reason => reason.includes('Identical archive aliases')));
  for (const changed of [{ ...alias, text: '// Other bytes' }, { ...alias, mode: 0o755 }]) {
    assert.throws(() => inspect(fixture([first, changed])), /conflicting contents or metadata/);
  }
});

test('audit is deterministic and unsafe archives are explicit unresolved evidence, not omitted', async () => {
  const good = fixture([], { license: 'MIT' });
  const bad = fixture([{ path: 'package/../escape', text: 'bad' }]);
  const lock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
    '': {}, 'node_modules/z': { ...good.entry, name: 'example' },
    'node_modules/a': { ...bad.entry, resolved: 'https://registry.npmjs.org/bad.tgz' },
  } }));
  const fetcher = async url => url.endsWith('bad.tgz') ? bad.bytes : good.bytes;
  const result = await audit(lock, fetcher);
  assert.deepEqual(result, await audit(lock, fetcher));
  assert.equal(result.packageLocations, 2);
  assert.equal(result.packages[0].location, 'node_modules/a');
  assert.match(result.packages[0].inspectionError, /Unsafe archive path/);
  assert.equal(result.redistributionApproved, false);
  assert.equal(result.licenseAuditComplete, false);
  assert.equal(result.upstreamCodeExecuted, false);
  await assert.rejects(audit(lock, async () => Buffer.from('corrupted')), /integrity mismatch/);
  await assert.rejects(audit(Buffer.from('{"lockfileVersion":3,"packages":{}}')), /Empty dependency inventory/);
});
