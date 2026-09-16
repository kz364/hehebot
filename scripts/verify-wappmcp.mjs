// Verification only: no npm lifecycle scripts, browser, pairing or MCP process.
// Pins are the sole owner-approved patch exception. Changes require review.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readWappMcp } from '../runtime/wappmcp-reads.mjs';

const revision = '9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8';
const pins = {
  plugin: ['https://registry.npmjs.org/wappmcp/-/wappmcp-0.4.0.tgz', 'f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8'],
  dependency: ['https://registry.npmjs.org/whatsapp-web.js/-/whatsapp-web.js-1.34.7.tgz', '714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c'],
  patch: [`https://raw.githubusercontent.com/vaibhavpandeyvpz/wappmcp/${revision}/patches/whatsapp-web.js+1.34.7.patch`, 'b2b582a7650545d6e7534e7a66731a8b546b309efd6bce9e0e9a4722e0a616cf'],
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = (bytes, expected) => assert.equal(hash(bytes), expected, 'Artifact integrity mismatch');
const root = await mkdtemp(join(tmpdir(), 'hehebot-wappmcp-'));
try {
  for (const [name, [url, digest]] of Object.entries(pins)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.ok, true, `Cannot fetch pinned ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes, digest);
    // Negative controls: missing/altered artifacts cannot pass the same gate.
    assert.throws(() => verify(Buffer.alloc(0), digest));
    assert.throws(() => verify(Buffer.concat([bytes, Buffer.from('changed')]), digest));
    await writeFile(join(root, name), bytes);
  }
  const plugin = join(root, 'plugin-source'), dependency = join(root, 'node_modules/whatsapp-web.js');
  await mkdir(plugin); await mkdir(dependency, { recursive: true });
  for (const [archive, directory] of [['plugin', plugin], ['dependency', dependency]]) {
    execFileSync('tar', ['-xzf', join(root, archive), '--strip-components=1', '-C', directory]);
  }
  const pkg = JSON.parse(await readFile(join(plugin, 'package.json')));
  const dep = JSON.parse(await readFile(join(dependency, 'package.json')));
  assert.equal(pkg.name, 'wappmcp'); assert.equal(pkg.version, '0.4.0');
  assert.equal(dep.name, 'whatsapp-web.js'); assert.equal(dep.version, '1.34.7');
  const patch = await readFile(join(plugin, 'patches/whatsapp-web.js+1.34.7.patch'));
  verify(patch, pins.patch[1]);
  assert.deepEqual(patch, await readFile(join(root, 'patch')));
  // git apply has no fuzzy matching and --check rejects partial/double application.
  execFileSync('git', ['apply', '--check', join(root, 'patch')], { cwd: root });
  execFileSync('git', ['apply', join(root, 'patch')], { cwd: root });
  assert.throws(() => execFileSync('git', ['apply', '--check', join(root, 'patch')], { cwd: root, stdio: 'pipe' }));

  const exports = {}, calls = [];
  let stored, memoryHit = true;
  const window = { require(name) {
    if (name === 'WALinkify') return { findLinks: () => [] };
    if (name === 'WAWebCollections') return { Msg: {
      get(id) { assert.equal(id, 'message-73'); calls.push(['get', id]); return memoryHit ? stored : null; },
      async getMessagesById(ids) { assert.deepEqual(Array.from(ids), ['message-73']); calls.push(['fetch', ...ids]); return { messages: [stored] }; },
    } };
    throw new Error(`Unexpected synthetic module ${name}`);
  } };
  // Execute the actual patched upstream functions, not copied normalization logic.
  runInNewContext(await readFile(join(dependency, 'src/util/Injected/Utils.js'), 'utf8'), { exports, window });
  exports.LoadUtils();
  const Reaction = createRequire(import.meta.url)(join(dependency, 'src/structures/Reaction.js'));
  for (const key of [{ _serialized: 'message-73' }, { $1: 'message-73' }, { _serialized: 'message-73', $1: 'wrong-19' }]) {
    const original = JSON.stringify(key);
    assert.equal(window.WWebJS.getMsgKeyId(key), 'message-73');
    const reaction = new Reaction({}, { msgKey: key, parentMsgKey: key });
    assert.equal(reaction.id._serialized, 'message-73'); assert.equal(reaction.msgId._serialized, 'message-73');
    stored = { body: 'Synthetic message', serialize: () => ({ id: { ...key, remote: { _serialized: 'family@g.us' } }, body: 'Synthetic message' }) };
    const message = window.WWebJS.getMessageModel(stored);
    assert.equal(message.id._serialized, 'message-73'); assert.equal(message.id.remote, 'family@g.us');
    for (const hit of [true, false]) {
      memoryHit = hit; calls.length = 0;
      const chat = await window.WWebJS.getChatModel({ lastReceivedKey: key, serialize: () => ({ msgs: [1] }) });
      assert.equal(chat.lastMessage.id._serialized, 'message-73');
      assert.deepEqual(calls, hit ? [['get', 'message-73']] : [['get', 'message-73'], ['fetch', 'message-73']]);
    }
    assert.equal(JSON.stringify(key), original);
  }
  calls.length = 0;
  for (const key of [null, {}, { $1: null }]) {
    assert.equal(window.WWebJS.getMsgKeyId(key), undefined);
    const chat = await window.WWebJS.getChatModel({ lastReceivedKey: key, serialize: () => ({ msgs: [1] }) });
    assert.equal(chat.lastMessage, null);
  }
  assert.deepEqual(calls, []);
  const grant = { chatIds: ['family@g.us'], tools: ['whatsapp_get_chat_messages'] };
  const server = await readFile(join(plugin, 'dist/lib/mcp/server.js'), 'utf8');
  const declared = [...server.matchAll(/registerTool\("(whatsapp_[a-z0-9_]+)"/g)].map(match => match[1]);
  assert.equal(declared.length, 22);
  for (const name of declared.filter(name => !['whatsapp_get_chat_messages', 'whatsapp_search_messages'].includes(name))) {
    await assert.rejects(readWappMcp(grant, name, { chatId: 'family@g.us' }, () => assert.fail('Mutation reached upstream')), { code: 'WHATSAPP_READ_DENIED' });
  }
  await assert.rejects(readWappMcp(grant, 'whatsapp_get_chat_messages', { chatId: 'stranger@g.us' }, () => assert.fail('Foreign chat reached upstream')), { code: 'WHATSAPP_READ_DENIED' });
  execFileSync(process.execPath, ['--test', 'tests/runtime-wappmcp-reads.mjs'], { stdio: 'inherit' });
  console.log(JSON.stringify({ status: 'passed', revision, hashes: Object.fromEntries(Object.entries(pins).map(([name, [, digest]]) => [name, digest])), cleanPatch: true, syntheticCompatibility: true, livePairing: false, installed: false, productionAdmission: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
