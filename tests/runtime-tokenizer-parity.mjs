import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mulberry32, ucs2length, utf16Length, buildCorpus, discriminatorPairs,
  maxRecord, BATCH_SIZES, assertParity, corruptExpectation,
  bounded, inspectorCall, runBoundedChild, newRunDir, writeEvidence,
} from '../scripts/test-memory-tokenizer.mjs';

// These tests exercise the harness's own logic offline: corpus determinism,
// contract-boundary accounting, negative-control sensitivity, and the bounded
// execution/evidence machinery (inspector timeouts, process-group termination,
// per-invocation evidence retention). They do not install packages, download
// ranks, or start workerd; the full credential-free harness run is
// `node scripts/test-memory-tokenizer.mjs`.

test('importing the harness has no side effects and exports pure helpers', () => {
  assert.equal(typeof buildCorpus, 'function');
  assert.equal(typeof assertParity, 'function');
  assert.equal(typeof bounded, 'function');
  assert.equal(typeof inspectorCall, 'function');
  assert.equal(typeof runBoundedChild, 'function');
});

test('corpus is deterministic with unique ids and stable hash', () => {
  const a = buildCorpus();
  const b = buildCorpus();
  assert.deepEqual(a, b);
  const ids = a.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // Stable serialized form: identical JSON on every build.
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('corpus covers the required risk areas', () => {
  const corpus = buildCorpus();
  const byId = new Map(corpus.map(c => [c.id, c.text]));
  const mustExist = [
    'english', 'indonesian', 'chinese', 'arabic', 'mixed',
    'crlf', 'whitespace', 'contraction', 'unicodeApostrophe',
    'combiningDecomposed', 'combiningPrecomposed', 'combiningLong',
    'emoji', 'zwjFamily', 'zwjSplit',
    'loneHigh', 'loneLow', 'lonePairMixed', 'twoHigh', 'reversedSurrogates',
    'specialLiteralEndoftext', 'specialLiteralChat', 'specialLiteralEndofprompt',
    'longRepeated', 'longNonRepeated',
    'maxAscii', 'oneOverAscii', 'maxBmp', 'oneOverBmp', 'maxAstral', 'oneOverAstral',
    'maxMixed', 'oneOverMixed',
  ];
  for (const id of mustExist) assert.ok(byId.has(id), `missing corpus case ${id}`);
  const endOfText = '<' + '|endoftext|' + '>';
  assert.ok(byId.get('specialLiteralEndoftext').startsWith(endOfText), 'end-of-text case must contain the actual literal');
  assert.ok(byId.get('specialLiteralChat').includes('<|im_start|>'));
  assert.ok(byId.get('specialLiteralEndofprompt').includes('<|endofprompt|>'));
  // Seeded generated cases from both generators.
  assert.ok(corpus.filter(c => c.id.startsWith('generated-')).length >= 16);
  // Discriminator pairs are all present.
  for (const [id1, , id2] of discriminatorPairs()) {
    assert.ok(byId.has(id1) && byId.has(id2), `missing discriminator pair ${id1}/${id2}`);
  }
  assert.ok(discriminatorPairs().length >= 12, 'discriminator coverage shrank');
});

test('memory-contract size accounting: limit is ucs2length (code points)', () => {
  const corpus = buildCorpus();
  const byId = new Map(corpus.map(c => [c.id, c.text]));
  const max = 16000;
  // ASCII maximum: 16000 code points, 16000 UTF-16 units.
  assert.equal(ucs2length(byId.get('maxAscii')), max);
  assert.equal(utf16Length(byId.get('maxAscii')), max);
  // BMP maximum: 16000 code points, 16000 UTF-16 units.
  assert.equal(ucs2length(byId.get('maxBmp')), max);
  assert.equal(utf16Length(byId.get('maxBmp')), max);
  // Astral maximum: 16000 code points, 32000 UTF-16 units (64000 UTF-8 bytes).
  assert.equal(ucs2length(byId.get('maxAstral')), max);
  assert.equal(utf16Length(byId.get('maxAstral')), 2 * max);
  assert.equal(new TextEncoder().encode(byId.get('maxAstral')).length, 4 * max);
  // Mixed maximum lands exactly on the limit.
  assert.equal(ucs2length(byId.get('maxMixed')), max);
  // One-over cases exceed the contract limit in code points: every variant
  // (ASCII, BMP, astral, mixed) has a boundary pair.
  for (const id of ['oneOverAscii', 'oneOverBmp', 'oneOverAstral', 'oneOverMixed']) {
    assert.equal(ucs2length(byId.get(id)), max + 1, `${id} must be exactly one over`);
  }
  // The batch record is a selected maximum-size stress case at the contract
  // maximum (not a proven worst-case admitted input).
  const record = maxRecord();
  assert.equal(ucs2length(record.text), max);
  assert.equal(utf16Length(record.text), 2 * max);
  // Batch sizes from the brief.
  assert.deepEqual(BATCH_SIZES, [1, 10, 100]);
});

test('ucs2length counts lone surrogates as single code points', () => {
  assert.equal(ucs2length('a\uD800b'), 3);
  assert.equal(ucs2length('\uDC00\uD800'), 2);
  assert.equal(utf16Length('a\uD800b'), 3);
});

test('seeded PRNG is deterministic and seed-sensitive', () => {
  const a1 = mulberry32(42), a2 = mulberry32(42), b = mulberry32(43);
  const seqA1 = [a1(), a1(), a1()], seqA2 = [a2(), a2(), a2()], seqB = [b(), b(), b()];
  assert.deepEqual(seqA1, seqA2);
  assert.notDeepEqual(seqA1, seqB);
});

test('assertParity passes matching vectors and detects every mismatch shape', () => {
  const cases = [{ id: 'one', text: 'abc' }, { id: 'two', text: 'defg' }];
  const expected = [[1, 2, 3], [4, 5, 6, 7]];
  assertParity(cases, expected, [[1, 2, 3], [4, 5, 6, 7]], 'stub');
  // Wrong token id.
  assert.throws(() => assertParity(cases, expected, [[1, 2, 4], [4, 5, 6, 7]], 'stub'),
    /case one: token index 2: expected 3 actual 4/);
  // Wrong token count.
  assert.throws(() => assertParity(cases, expected, [[1, 2], [4, 5, 6, 7]], 'stub'),
    /case one: token count expected 3 actual 2/);
  // Wrong case count.
  assert.throws(() => assertParity(cases, expected, [[1, 2, 3]], 'stub'), /candidate count mismatch/);
  // Non-array encoding.
  assert.throws(() => assertParity(cases, expected, [null, [4, 5, 6, 7]], 'stub'),
    /case one: token count expected/);
});

test('corrupted expected token is detected and reports case id and index', () => {
  const cases = buildCorpus();
  // Independent stub reference: char-code encoding, deliberately unlike the
  // comparison logic under test.
  const stubReference = cases.map(c => Array.from(c.text, ch => ch.codePointAt(0)));
  // Candidate matches the stub reference exactly.
  assertParity(cases, stubReference, stubReference.map(e => e.slice()), 'stub');
  const corrupted = corruptExpectation(cases, stubReference);
  assert.equal(corrupted.from, stubReference[stubReference.findIndex((e, i) => cases[i].id === corrupted.caseId)][corrupted.index]);
  assert.notEqual(corrupted.to, corrupted.from);
  assert.throws(() => assertParity(cases, corrupted.expected, stubReference, 'negative-control'),
    new RegExp(corrupted.caseId));
  assert.throws(() => assertParity(cases, corrupted.expected, stubReference, 'negative-control'),
    new RegExp(`token index ${corrupted.index}`));
});

test('corpus survives a JSON round trip including lone surrogates', () => {
  const corpus = buildCorpus();
  const roundTripped = JSON.parse(JSON.stringify(corpus));
  const byId = new Map(roundTripped.map(c => [c.id, c.text]));
  assert.equal(byId.get('loneHigh'), 'a\uD800b');
  assert.equal(byId.get('reversedSurrogates'), '\uDC00\uD800');
});

// ---------------------------------------------------------------------------
// Bounded execution: inspector protocol, phase timeouts, process-group cleanup.
// ---------------------------------------------------------------------------

// Minimal WebSocket stand-in: inspectorCall only needs addEventListener, send,
// readyState and dispatched message/close/error events.
class FakeInspectorSocket extends EventTarget {
  constructor({ readyState = WebSocket.OPEN, script = [] } = {}) {
    super();
    this.readyState = readyState;
    this._script = script.slice();
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
    const script = this._script.splice(0);
    for (const action of script) {
      queueMicrotask(() => {
        if (action.reply !== undefined) this.dispatchEvent(new MessageEvent('message', { data: action.reply }));
        if (action.close) this.dispatchEvent(new Event('close'));
        if (action.error) this.dispatchEvent(new Event('error'));
      });
    }
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

test('bounded passes through resolution and rejection', async () => {
  assert.equal(await bounded(Promise.resolve('value'), 5000, 't-pass'), 'value');
  await assert.rejects(() => bounded(Promise.reject(new Error('inner')), 5000, 't-fail'), /inner/);
});

test('bounded classifies a timeout as a harness safety failure, not performance', async () => {
  await assert.rejects(
    () => bounded(new Promise(() => {}), 40, 't-hang'),
    /t-hang: bounded phase timed out after 40ms \(harness safety failure, not performance acceptance\)/
  );
});

test('inspectorCall resolves only on an id-matching reply', async () => {
  const ws = new FakeInspectorSocket({ script: [
    { reply: JSON.stringify({ id: 999, result: 'other request' }) },
    { reply: JSON.stringify({ id: 7, result: 'expected' }) },
  ] });
  assert.equal(await inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 5000 }), 'expected');
  assert.equal(ws.sent.length, 1);
  assert.equal(JSON.parse(ws.sent[0]).id, 7);
});

test('inspectorCall rejects on a never-replying socket after a bounded timeout', async () => {
  const ws = new FakeInspectorSocket({ script: [] });
  await assert.rejects(
    () => inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 40 }),
    /Test.method: timed out after 40ms \(harness safety failure, not performance acceptance\)/
  );
});

test('inspectorCall rejects on an already-closed socket', async () => {
  const ws = new FakeInspectorSocket({ readyState: WebSocket.CLOSED });
  await assert.rejects(
    () => inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 5000 }),
    /Test.method: socket already closed/
  );
  assert.equal(ws.sent.length, 0);
});

test('inspectorCall rejects on a protocol error reply', async () => {
  const ws = new FakeInspectorSocket({ script: [
    { reply: JSON.stringify({ id: 7, error: { code: -32000, message: 'boom' } }) },
  ] });
  await assert.rejects(
    () => inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 5000 }),
    /Test.method: protocol error .*boom/
  );
});

test('inspectorCall rejects when the socket closes before the reply', async () => {
  const ws = new FakeInspectorSocket({ script: [{ close: true }] });
  await assert.rejects(
    () => inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 5000 }),
    /Test.method: socket closed before reply/
  );
});

test('inspectorCall rejects on an unparseable reply', async () => {
  const ws = new FakeInspectorSocket({ script: [{ reply: 'not json' }] });
  await assert.rejects(
    () => inspectorCall(ws, 'Test.method', { id: 7, timeoutMs: 5000 }),
    /Test.method: unparseable reply/
  );
});

test('runBoundedChild returns output for a child that exits normally', async () => {
  const result = await runBoundedChild(process.execPath, ['-e', 'console.log("hi"); process.exit(3)'], { timeoutMs: 20000 });
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, 'hi\n');
});

test('runBoundedChild rejects when the command cannot be spawned', async () => {
  await assert.rejects(() => runBoundedChild('/nonexistent-command-hehebot-test', [], { timeoutMs: 5000 }));
});

test('runBoundedChild actually terminates a hung child process group on timeout', async () => {
  // Middle child spawns a grandchild and prints both pids; both block forever.
  // On timeout the harness must SIGTERM/SIGKILL the whole group so that BOTH
  // processes are really dead, not merely abandoned by a Promise.race.
  const middle = 'const { spawn } = require("child_process");' +
    'const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'console.log("PIDS " + process.pid + " " + grand.pid);' +
    'setInterval(() => {}, 1000);';
  const result = await runBoundedChild(process.execPath, ['-e', middle], { timeoutMs: 800, killGraceMs: 1500 });
  assert.equal(result.timedOut, true, 'hung child must be classified as timed out');
  assert.notEqual(result.signal, null, 'hung child must have been signalled');
  const match = /PIDS (\d+) (\d+)/.exec(result.stdout);
  assert.ok(match, 'child must print its pid tree: ' + JSON.stringify(result.stdout));
  const [, middlePid, grandPid] = match;
  const waitForGone = async pid => {
    for (let i = 0; i < 40; i++) {
      try { process.kill(Number(pid), 0); } catch { return; } // ESRCH: gone
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`process ${pid} still alive after group kill`);
  };
  await waitForGone(middlePid);
  await waitForGone(grandPid);
});

// ---------------------------------------------------------------------------
// Evidence retention: unique per-invocation directories; repeated failures are
// preserved, never overwritten.
// ---------------------------------------------------------------------------

test('newRunDir returns a unique directory per invocation', () => {
  const base = join(tmpdir(), 'hehebot-tokenizer-test-base');
  const a = newRunDir(base);
  const b = newRunDir(base);
  assert.notEqual(a, b);
  assert.ok(a.startsWith(base));
});

test('repeated failure evidence is preserved, not overwritten', async () => {
  const base = await mkdtemp(join(tmpdir(), 'hehebot-tokenizer-evidence-'));
  try {
    const runA = newRunDir(base);
    const runB = newRunDir(base);
    await writeEvidence(runA, { result: 'fail', run: 'first' });
    await writeEvidence(runB, { result: 'fail', run: 'second' });
    const first = JSON.parse(await readFile(join(runA, 'evidence.json'), 'utf8'));
    const second = JSON.parse(await readFile(join(runB, 'evidence.json'), 'utf8'));
    assert.equal(first.run, 'first');
    assert.equal(second.run, 'second');
    assert.notEqual(runA, runB, 'each invocation must get its own evidence directory');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('writeEvidence creates missing parent directories (fresh checkout without .local)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'hehebot-tokenizer-fresh-'));
  try {
    const run = newRunDir(join(base, 'nested', 'deep', 'run'));
    await writeEvidence(run, { result: 'pass' });
    const evidence = JSON.parse(await readFile(join(run, 'evidence.json'), 'utf8'));
    assert.equal(evidence.result, 'pass');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
