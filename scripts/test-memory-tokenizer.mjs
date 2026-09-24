#!/usr/bin/env node
// Credential-free o200k_base tokenizer parity and local-workerd load harness.
//
// Scope: a repeatable verification harness for the gpt-tokenizer 4.0.0 candidate
// (narrow `gpt-tokenizer/encoding/o200k_base` import) against the official
// OpenAI tiktoken 0.11.0 Python reference. It proves token-for-token parity on a
// deterministic varied corpus, exercises realistic memory-sized workloads in real
// local workerd through installed Miniflare with the actual application module
// bundled, and proves its own negative controls. It is NOT application tokenizer
// adoption, memory-budget implementation, or a deployed-acceptance claim.
//
// Bounded execution: every external operation (npm, uv/pip, Python reference,
// Node runner, workerd phase) runs in its own detached process group with a
// timeout; on timeout the harness SIGTERMs and then SIGKills the whole group,
// which actually terminates owned workerd children instead of leaving work
// running. Timeouts are classified as harness safety failures, never as
// performance results or acceptance.
//
// Evidence: each invocation writes a unique per-run evidence directory under
// .local/memory-tokenizer-harness/ (created on demand; a fresh checkout without
// .local works) containing machine-readable evidence, the workerd child result
// with partial observations, and its stdout/stderr. Repeated runs never
// overwrite earlier evidence. On failure the disposable fixture directory is
// retained and its location recorded; on success it is removed.
//
// The candidate is installed only into a disposable directory with no lifecycle
// scripts and no inherited credentials; nothing is added to the repository
// dependency tree. Requires network access to registry.npmjs.org, PyPI, and
// openaipublic.blob.core.windows.net (public package/rank downloads only).
// Run from the repository root: node scripts/test-memory-tokenizer.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pinned candidate: gpt-tokenizer 4.0.0 (no runtime dependencies).
const CANDIDATE = {
  name: 'gpt-tokenizer',
  version: '4.0.0',
  tarball: 'https://registry.npmjs.org/gpt-tokenizer/-/gpt-tokenizer-4.0.0.tgz',
  integrity: 'sha512-YAWIyzvuVUHEfW7tFfFAxH8qQb+Q3RU9nYOTy7skMNX5qzU6Q8jxTHZLyO56ug1vYvCR7wndzpd3jwD86/mhjQ==',
  gitHead: 'fb04ebca53f662200e737caefe9a5ef372a5e41a',
};
// Official o200k_base ranks (immutable URL). tiktoken 0.11.0 itself asserts
// this SHA-256 when loading the encoding; the harness also verifies it directly.
const RANKS = {
  url: 'https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken',
  sha256: '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d',
};
// Reference implementation: official OpenAI tiktoken, Python (PyPI).
const REFERENCE = { package: 'tiktoken', version: '0.11.0' };
// Current memory-text contract limit (Ajv maxLength = ucs2length = code points).
const MEMORY_TEXT_MAX = 16000;
const WORKER_NAME = 'hehebot-tokenizer-probe';

const sha256hex = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512sri = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

// ---------------------------------------------------------------------------
// Pure, exported helpers (deterministic corpus + comparison logic). Imported by
// tests/runtime-tokenizer-parity.mjs and by the generated workerd child runner;
// importing this file has no side effects.
// ---------------------------------------------------------------------------

// Deterministic PRNG (mulberry32) so every run generates the identical corpus.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ajv maxLength semantics: ucs2length counts Unicode code points (astral = 1).
export function ucs2length(text) {
  let n = 0;
  for (const _ of text) n++; // eslint-disable-line no-unused-vars
  return n;
}

// UTF-16 code units (JavaScript string .length).
export const utf16Length = text => text.length;

// Token-boundary discriminator pairs: [id1, text1, id2, text2]. Near-identical
// inputs whose correct o200k_base encodings must differ from each other; they
// keep the corpus sensitive to token-boundary behavior, not just bulk output.
export function discriminatorPairs() {
  return [
    ['discriminator-hello-world', 'hello world', 'discriminator-hello-worlds', 'hello worlds'],
    ['discriminator-hello', 'hello', 'discriminator-space-hello', ' hello'],
    ['discriminator-lower', 'hello', 'discriminator-upper', 'Hello'],
    ['discriminator-email', 'e-mail', 'discriminator-email-joined', 'email'],
    ['discriminator-email-split', 'email', 'discriminator-email-spaced', 'e mail'],
    ['discriminator-crlf', 'a\r\nb', 'discriminator-lf', 'a\nb'],
    ['discriminator-cr', 'a\rb', 'discriminator-lf-2', 'a\nb'],
    ['discriminator-tab', 'x\ty', 'discriminator-space', 'x y'],
    ['discriminator-emoji', '😀', 'discriminator-emoji-a', '😀a'],
    ['discriminator-a-emoji', 'a😀', 'discriminator-emoji-alone', '😀'],
    ['discriminator-precomposed', 'café', 'discriminator-decomposed', 'cafe\u0301'],
    ['discriminator-math', '𝐀', 'discriminator-ascii-a', 'A'],
    ['discriminator-its', "it's", 'discriminator-its-plain', 'its'],
    ['discriminator-digit', '12345', 'discriminator-digit-split', '1234 5'],
    ['discriminator-ellipsis', '…', 'discriminator-dots', '...'],
    ['discriminator-zws', 'a\u200Bb', 'discriminator-no-zws', 'ab'],
  ];
}

// Deterministic corpus of {id, text} cases. No clocks, no Math.random.
export function buildCorpus() {
  const cases = [];
  const add = (id, text) => cases.push({ id, text });

  // Curated ordinary text (special literals are NOT control tokens here).
  add('english', 'The assistant keeps durable scoped memory for each persona.');
  add('indonesian', 'Selamat pagi, terima kasih atas kabarnya hari ini.');
  add('chinese', '你好，世界。简体中文的记忆文本测试。');
  add('arabic', 'السلام عليكم ورحمة الله وبركاته، مرحبا بالعالم.');
  add('mixed', 'Halo 世界 — مرحبا — hello ✓ mixed-script memory record.');
  add('code', 'const limit = 16000; if (text.length > limit) throw new Error("too long");');
  add('json', '{"schema_version":1,"type":"memory.put","text":"记忆"}');
  add('url', 'https://example.com/hehebot/memory?record=42#anchor');
  add('markdown', '# Memory\n\n- item one\n- item two\n\n**bold** and `code`.');
  add('numbers', '16000 code points, 32000 UTF-16 units, 64000 UTF-8 bytes, 0.5, 1e3.');
  add('punctuation', '…“curly quotes” — em-dash, semi; colon: [brackets] (parens) {braces}');
  add('specialLiteralEndoftext', ' is treated as ordinary text here.');
  add('specialLiteralChat', '<|im_start|>assistant<|im_end|> as ordinary text.');
  add('specialLiteralEndofprompt', '<|endofprompt|> ordinary text.');

  // Whitespace, line endings, contractions.
  add('crlf', 'line1\r\nline2\rline3\nline4\r\n\r\nline5');
  add('whitespace', 'a b\u00a0c\u2003d\te\nf\r\ng');
  add('leadingTrailing', '  leading and trailing spaces  ');
  add('contraction', "don't can't won't y'all 'twas o'clock it's");
  add('unicodeApostrophe', "don’t can’t won’t it’s");

  // Combining marks and normalization-sensitive sequences.
  add('combiningDecomposed', 'e\u0301\u0327 a\u0488\u0489 n\u0303');
  add('combiningPrecomposed', 'é̡᷉ ẙ̲ ñ');
  add('combiningLong', 'a' + '\u0301\u0327\u0488\u0489\u035C'.repeat(80));

  // Emoji, ZWJ sequences, flags, skin tones.
  add('emoji', '🎉🤷🏽‍♂️🇮🇩❤️‍🔥 simple emoji run');
  add('zwjFamily', '👩‍👩‍👧‍👦 family 👨‍👩‍👧 and 👩‍❤️‍👨 couple');
  add('zwjSplit', '👩\u200d👩\u200d👧\u200d👦 explicit ZWJ code points');

  // Lone surrogates (WHATWG replacement semantics on both sides).
  add('loneHigh', 'a\uD800b');
  add('loneLow', 'x\uDC00y');
  add('lonePairMixed', '\uD83D\uDE00 \uD83D and \uDE00');
  add('twoHigh', 'a\uD800\uD801b');
  add('reversedSurrogates', '\uDC00\uD800');

  // Token-boundary discriminators: near-identical pairs that must tokenize
  // differently. Each member is also an ordinary parity case.
  for (const [id1, text1, id2, text2] of discriminatorPairs()) { add(id1, text1); add(id2, text2); }

  // Seeded generated cases from mixed alphabets.
  const pools = {
    ascii: ['the', 'assistant', 'memory', 'record', 'limit', 'budget', 'sleep', 'wake'],
    indonesian: ['selamat', 'pagi', 'terima', 'kasih', 'apa', 'kabar', 'datang', 'tidur', 'nyenyak', 'hari'],
    chinese: ['你', '好', '世', '界', '记', '忆', '睡', '眠', '测', '试', '，', '。'],
    arabic: ['ا', 'ل', 'س', 'ل', 'ا', 'م', 'م', 'ر', 'ح', 'ب', 'ا', ' '],
    combining: ['\u0301', '\u0327', '\u0488', '\u0489', '\u035C'],
    emoji: ['😀', '🎉', '👍', '👩', '\u200D', '👧', '❤', '\uFE0F', '🔥', '🇮🇩'],
    whitespace: [' ', '\t', '\n', '\r\n', '\u00a0'],
    specials: ['', '<|im_start|>', '<|im_end|>', '<|endofprompt|>'],
  };
  const poolNames = Object.keys(pools);
  for (let seed = 1; seed <= 12; seed++) {
    const next = mulberry32(seed * 0x9E3779B1);
    const pieces = [];
    const count = 5 + Math.floor(next() * 40);
    for (let i = 0; i < count; i++) {
      const pool = pools[poolNames[Math.floor(next() * poolNames.length)]];
      pieces.push(pool[Math.floor(next() * pool.length)]);
    }
    add(`generated-${seed}`, pieces.join(''));
  }
  // Seeded raw code-point cases, including astral and lone surrogates.
  const ranges = [[0x20, 0x7e], [0x4e00, 0x9fff], [0x0600, 0x06ff], [0x0300, 0x036f], [0x1f300, 0x1f6ff]];
  for (let seed = 13; seed <= 20; seed++) {
    const next = mulberry32(seed * 0x85EBCA6B);
    const count = 10 + Math.floor(next() * 60);
    const points = [];
    for (let i = 0; i < count; i++) {
      if (next() < 0.08) points.push(next() < 0.5 ? 0xD800 : 0xDC00); // lone surrogates
      else { const [lo, hi] = ranges[Math.floor(next() * ranges.length)]; points.push(lo + Math.floor(next() * (hi - lo + 1))); }
    }
    add(`generated-raw-${seed}`, points.map(p => String.fromCodePoint(p)).join(''));
  }

  // Long repeated and long non-repeated text.
  add('longRepeated', 'ab '.repeat(5000));
  const nextLong = mulberry32(0xC0FFEE);
  const longWords = [];
  for (let i = 0; i < 1500; i++) {
    const pool = pools[['ascii', 'indonesian', 'chinese'][Math.floor(nextLong() * 3)]];
    longWords.push(pool[Math.floor(nextLong() * pool.length)]);
  }
  add('longNonRepeated', longWords.join(' '));

  // Memory-contract size cases: the limit is 16000 ucs2length (code points),
  // so a maximum legal record may be 16000 astral code points = 32000 UTF-16
  // units = up to 64000 UTF-8 bytes. One-over cases exceed the contract limit
  // and are workload-boundary probes only: parity is still compared, and the
  // real application schema validation must reject them.
  add('maxAscii', 'x'.repeat(MEMORY_TEXT_MAX));
  add('oneOverAscii', 'x'.repeat(MEMORY_TEXT_MAX + 1));
  add('maxBmp', '中'.repeat(MEMORY_TEXT_MAX));
  add('oneOverBmp', '中'.repeat(MEMORY_TEXT_MAX + 1));
  add('maxAstral', '𝐀'.repeat(MEMORY_TEXT_MAX));
  add('oneOverAstral', '𝐀'.repeat(MEMORY_TEXT_MAX + 1));
  add('maxMixed', 'a中𝐀'.repeat(Math.floor(MEMORY_TEXT_MAX / 3)) + 'a'.repeat(MEMORY_TEXT_MAX % 3));
  add('oneOverMixed', 'a中𝐀'.repeat(Math.floor(MEMORY_TEXT_MAX / 3)) + 'a'.repeat(MEMORY_TEXT_MAX % 3 + 1));

  const ids = cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'corpus case ids must be unique');
  return cases;
}

// Stress record for multi-record batch load cases: a selected maximum-size
// record (16000 astral code points). This is a chosen stress case at the
// contract maximum, not a proven worst-case admitted input.
export function maxRecord() {
  return { id: 'maxAstral', text: '𝐀'.repeat(MEMORY_TEXT_MAX) };
}

// Batch sizes (number of maximum-size records per request).
export const BATCH_SIZES = [1, 10, 100];

// Compare candidate encodings against reference encodings, case by case.
// Throws on the first mismatch with the case id, token index and both values.
export function assertParity(cases, expected, actual, label = 'parity') {
  assert.equal(cases.length, expected.length, `${label}: reference count mismatch`);
  assert.equal(cases.length, actual.length, `${label}: candidate count mismatch`);
  for (let i = 0; i < cases.length; i++) {
    const want = expected[i], got = actual[i];
    if (!Array.isArray(want) || !Array.isArray(got) || want.length !== got.length) {
      throw new Error(`${label} mismatch: case ${cases[i].id}: token count expected ${want && want.length} actual ${got && got.length}`);
    }
    for (let j = 0; j < want.length; j++) {
      if (want[j] !== got[j]) {
        throw new Error(`${label} mismatch: case ${cases[i].id}: token index ${j}: expected ${want[j]} actual ${got[j]} (lengths ${want.length}/${got.length})`);
      }
    }
  }
}

// Negative control: corrupt exactly one expected token at a deterministic
// position and return {expected, caseId, index, from, to} for reporting.
export function corruptExpectation(cases, expected) {
  const corrupted = expected.map(e => e.slice());
  const caseIndex = cases.findIndex((c, i) => expected[i].length >= 3);
  assert.ok(caseIndex >= 0, 'no case with >=3 tokens to corrupt');
  const index = Math.floor(corrupted[caseIndex].length / 2);
  const from = corrupted[caseIndex][index];
  const to = from === 0 ? 1 : from + 1;
  corrupted[caseIndex][index] = to;
  return { expected: corrupted, caseId: cases[caseIndex].id, index, from, to };
}

// ---------------------------------------------------------------------------
// Bounded-execution helpers. These are the harness's safety net: a timeout is a
// harness safety failure and exits nonzero; it is never read as a performance
// measurement or an acceptance result.
// ---------------------------------------------------------------------------

// Race a promise against a deadline. On timeout this rejects with a classified
// safety failure; the underlying work keeps running until the owning
// runBoundedChild group kill (or process exit) terminates it, so callers must
// always run untrusted/unbounded work inside runBoundedChild.
export function bounded(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`${label}: bounded phase timed out after ${timeoutMs}ms (harness safety failure, not performance acceptance)`));
      }
    }, timeoutMs);
    Promise.resolve(promise).then(
      value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      error => { if (!settled) { settled = true; clearTimeout(timer); reject(error instanceof Error ? error : new Error(`${label}: ${error}`)); } }
    );
  });
}

// One inspector request over an open WebSocket. Resolves only on a reply whose
// id matches the request; rejects on a protocol error reply, socket close,
// socket error, or timeout (classified harness safety failure with cleanup of
// the listeners and timer).
export function inspectorCall(ws, method, { params, timeoutMs = 15000, id = 1 } = {}) {
  return new Promise((resolveCall, rejectCall) => {
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
      rejectCall(error);
    };
    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
      resolveCall(result);
    };
    let settled = false;
    const onMessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return fail(new Error(`inspector ${method}: unparseable reply`)); }
      if (message.id !== id) return; // ignore events and replies to other requests
      if (message.error) return fail(new Error(`inspector ${method}: protocol error ${JSON.stringify(message.error)}`));
      settle(message.result);
    };
    const onClose = () => fail(new Error(`inspector ${method}: socket closed before reply`));
    const onError = () => fail(new Error(`inspector ${method}: socket error before reply`));
    const timer = setTimeout(() => fail(new Error(`inspector ${method}: timed out after ${timeoutMs}ms (harness safety failure, not performance acceptance)`)), timeoutMs);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    if (ws.readyState === WebSocket.CLOSED) return fail(new Error(`inspector ${method}: socket already closed`));
    try { ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}) })); }
    catch (error) { fail(new Error(`inspector ${method}: send failed: ${error}`)); }
  });
}

// Run a command in its own detached process group with a hard timeout. On
// timeout the whole group gets SIGTERM and then SIGKILL, which actually
// terminates the command and its children (including workerd processes); the
// promise only settles after the child exits. Resolves with
// {timedOut, code, signal, stdout, stderr}; rejects only if the command could
// not be spawned.
export function runBoundedChild(command, args, options) {
  const { cwd, env, timeoutMs, killGraceMs = 8000 } = options ?? {};
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'runBoundedChild requires timeoutMs');
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const killGroup = signal => { try { process.kill(-child.pid, signal); } catch { /* group already gone */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), killGraceMs);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(result);
    };
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on('close', (code, signal) => finish({ timedOut, code, signal, stdout, stderr }));
  });
}

// Unique per-invocation evidence directory. Uniqueness uses the clock and a
// random suffix; corpus determinism is unaffected.
export function newRunDir(base) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(base, `${stamp}-${randomUUID().slice(0, 8)}`);
}

// Write evidence without ever overwriting another run's evidence: each run has
// its own directory. Creates the directory (and parents) on demand, so a fresh
// checkout without .local works.
export async function writeEvidence(runDir, evidence) {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main harness.
// ---------------------------------------------------------------------------

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HARNESS_URL = pathToFileURL(join(REPO, 'scripts', 'test-memory-tokenizer.mjs')).href;

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.ok, true, `Cannot fetch ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function childEnv(root, home, extra = {}) {
  return { PATH: process.env.PATH, HOME: home, TMPDIR: root,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root,
    ...extra };
}

// The workerd child runs the whole Miniflare phase in its own process group so
// the parent can hard-terminate the group (workerd children included) if any
// phase overruns. It writes partial observations to its result file after each
// step, so an overrun or crash still preserves evidence. No template literals
// inside: it is interpolated into the parent's source as a string.
const WORKERD_CHILD_SOURCE = [
  '// Bounded workerd child: parent kills this whole process group on timeout.',
  "import assert from 'node:assert/strict';",
  "import { readFile, writeFile } from 'node:fs/promises';",
  "import { build } from 'esbuild';",
  "import { Miniflare } from 'miniflare';",
  `import { bounded, inspectorCall, assertParity, BATCH_SIZES, ucs2length, utf16Length } from ${JSON.stringify(HARNESS_URL)};`,
  `const REPO = ${JSON.stringify(REPO)};`,
  `const WORKER_NAME = ${JSON.stringify(WORKER_NAME)};`,
  "const [probeEntryPath, probeBundlePath, casesPath, referencePath, resultPath] = process.argv.slice(2);",
  "const result = { partial: true, steps: [] };",
  "const record = (step, value) => { result.steps.push({ step, ...value }); return writeFile(resultPath, JSON.stringify(result, null, 2) + '\\n'); };",
  "const UUID = '123e4567-e89b-42d3-a456-426614174000';",
  "function memoryPut(text) { return { schema_version: 1, type: 'memory.put', payload: {",
  "  id: UUID, expected_revision: 0, scope: { kind: 'global', id: null }, text,",
  "  source_event_id: UUID, expires_at: null, sensitivity: 'ordinary' } }; }",
  "try {",
  "  await record('start', { pid: process.pid });",
  "  const cases = JSON.parse(await readFile(casesPath, 'utf8'));",
  "  const reference = JSON.parse(await readFile(referencePath, 'utf8'));",
  "  await bounded(build({ entryPoints: [probeEntryPath], outfile: probeBundlePath,",
  "    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',",
  "    loader: { '.sql': 'text' }, external: ['cloudflare:*', 'node:*'], logLevel: 'silent' }),",
  `    ${180000}, 'esbuild bundle');`,
  "  result.bundleBytes = (await readFile(probeBundlePath)).length;",
  "  await record('bundle', { bytes: result.bundleBytes });",
  "  const contents = await readFile(probeBundlePath, 'utf8');",
  "  const mainModule = 'probe.mjs';",
  "  const workerdStart = Date.now();",
  "  const mf = new Miniflare({ workers: [{ config: { name: WORKER_NAME, type: 'worker',",
  "    compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],",
  "    manifest: { mainModule, modules: { [mainModule]: { type: 'esm', contents } } } } }],",
  "    inspectorPort: 0, telemetry: { enabled: false } });",
  "  try {",
  "    const worker = await bounded(mf.getWorker(WORKER_NAME), 60000, 'getWorker');",
  "    const health = await bounded(worker.fetch('https://probe.example/probe/health').then(r => r.json()), 30000, 'health fetch');",
  "    assert.equal(health.ok, true);",
  "    assert.equal(health.appEntry, 'object', 'actual application entry module must be bundled');",
  "    assert.equal(health.control, 'function', 'actual application control class must be bundled');",
  "    result.readyMs = Date.now() - workerdStart;",
  "    await record('health', { readyMs: result.readyMs });",
  "    const inspectorWs = await bounded(mf.getInspectorURL(WORKER_NAME), 15000, 'inspector url');",
  "    const targets = await bounded(fetch('http://' + inspectorWs.host + '/json/list').then(r => r.json()), 15000, 'inspector target list');",
  "    const target = targets.find(t => new URL(t.webSocketDebuggerUrl).pathname === '/core:user:' + WORKER_NAME);",
  "    assert.ok(target, 'named user worker inspector target not found: ' + targets.map(t => t.title).join(', '));",
  "    const ws = await bounded(new Promise((openResolve, openReject) => {",
  "      const socket = new WebSocket(target.webSocketDebuggerUrl);",
  "      socket.addEventListener('open', () => openResolve(socket));",
  "      socket.addEventListener('error', () => openReject(new Error('inspector socket open failed')));",
  "    }), 15000, 'inspector socket open');",
  "    const heapBefore = await bounded(inspectorCall(ws, 'Runtime.getHeapUsage', { timeoutMs: 15000, id: 1 }), 20000, 'heap usage before');",
  "    result.heapUsedBefore = heapBefore.usedSize; result.heapTotalBefore = heapBefore.totalSize;",
  "    const parityStart = Date.now();",
  "    const workerdEnc = await bounded(worker.fetch('https://probe.example/probe/encode',",
  "      { method: 'POST', body: JSON.stringify({ records: cases.map(c => c.text), full: true }) }).then(r => r.json()), 300000, 'workerd parity encode');",
  "    assertParity(cases, reference.encodings, workerdEnc.encodings, 'workerd');",
  "    result.parityMs = Date.now() - parityStart; result.parityCases = cases.length;",
  "    await record('parity', { cases: cases.length, ms: result.parityMs });",
  "    const validate = {};",
  "    const boundaryIds = ['maxAscii', 'oneOverAscii', 'maxBmp', 'oneOverBmp', 'maxAstral', 'oneOverAstral', 'maxMixed', 'oneOverMixed'];",
  "    for (const id of boundaryIds) {",
  "      const text = cases.find(c => c.id === id).text;",
  "      assert.equal(ucs2length(text), id.startsWith('max') ? 16000 : 16001, 'boundary case accounting for ' + id);",
  "      const v = await bounded(worker.fetch('https://probe.example/probe/validate',",
  "        { method: 'POST', body: JSON.stringify({ text }) }).then(r => r.json()), 30000, 'validate ' + id);",
  "      assert.equal(v.valid, id.startsWith('max'), 'schema validation boundary wrong for ' + id);",
  "      if (!id.startsWith('max')) assert.equal(v.code, 'INVALID_INPUT', 'over-limit ' + id + ' must be rejected by the real schema');",
  "      validate[id] = v;",
  "    }",
  "    result.schemaBoundary = validate;",
  "    await record('boundary', { validate });",
  "    const record_ = cases.find(c => c.id === 'maxAstral');",
  "    assert.equal(ucs2length(record_.text), 16000, 'max record ucs2length');",
  "    assert.equal(utf16Length(record_.text), 32000, 'max record UTF-16 length');",
  "    const expectedCount = reference.encodings[cases.findIndex(c => c.id === 'maxAstral')].length;",
  "    result.batches = {};",
  "    for (const size of BATCH_SIZES) {",
  "      const batchStart = Date.now();",
  "      const res = await bounded(worker.fetch('https://probe.example/probe/encode',",
  "        { method: 'POST', body: JSON.stringify({ records: Array.from({ length: size }, () => record_.text), full: false }) }).then(r => r.json()),",
  "        600000, 'batch ' + size + ' encode');",
  "      const batchMs = Date.now() - batchStart;",
  "      assert.equal(res.counts.length, size, 'batch record count');",
  "      for (const count of res.counts) assert.equal(count, expectedCount, 'batch token count mismatch');",
  "      result.batches[size] = { records: size, ms: batchMs, tokensPerRecord: expectedCount };",
  "      await record('batch-' + size, result.batches[size]);",
  "    }",
  "    const heapAfter = await bounded(inspectorCall(ws, 'Runtime.getHeapUsage', { timeoutMs: 15000, id: 2 }), 20000, 'heap usage after');",
  "    result.heapUsedAfter = heapAfter.usedSize; result.heapTotalAfter = heapAfter.totalSize;",
  "    ws.close();",
  "    result.partial = false;",
  "    await record('done', { heapUsedAfter: result.heapUsedAfter, heapTotalAfter: result.heapTotalAfter });",
  "  } finally {",
  "    await bounded(mf.dispose(), 30000, 'miniflare dispose');",
  "  }",
  "  process.exitCode = 0;",
  "} catch (error) {",
  "  result.error = String(error && error.stack || error);",
  "  try { await writeFile(resultPath, JSON.stringify(result, null, 2) + '\\n'); } catch {}",
  "  console.error(result.error);",
  "  process.exitCode = 1;",
  "}",
].join('\n');

const PY_REFERENCE_SCRIPT = `
import json, sys, tiktoken
data = json.load(open(sys.argv[1], encoding="utf-8"))
enc = tiktoken.get_encoding("o200k_base")
encodings = [enc.encode_ordinary(t) for t in data["texts"]]
json.dump({"version": tiktoken.__version__, "encodings": encodings}, sys.stdout)
sys.stdout.write("\\n")
`;

const WORKERD_CHILD_TIMEOUT_MS = 3000000; // > sum of the child's internal bounds, so the child classifies its own overruns first.

async function main() {
  const started = Date.now();
  const evidence = {
    harness: 'scripts/test-memory-tokenizer.mjs',
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    pins: { candidate: CANDIDATE, reference: REFERENCE, ranks: RANKS },
    limitations: [
      'used/total JS heap (Runtime.getHeapUsage) is not total isolate memory',
      'wall-clock startup/latency is not billed CPU time',
      'local workerd is not deployed acceptance',
      'timings are observations, not thresholds or product acceptance',
      'timeouts are harness safety failures, never performance results',
      'the app has a per-record memory-text limit only; no total-memory-count bound is claimed',
    ],
  };
  const runDir = newRunDir(join(REPO, '.local', 'memory-tokenizer-harness'));
  evidence.runDir = runDir;
  const root = await mkdtemp(join(tmpdir(), 'hehebot-tokenizer-'));
  let retained = false;
  try {
    const home = join(root, 'home');
    await mkdir(home, { mode: 0o700 });
    const npmEnv = childEnv(root, home, {
      npm_config_userconfig: join(home, 'empty.npmrc'),
      npm_config_globalconfig: join(home, 'global.npmrc'),
      npm_config_cache: join(home, 'cache'),
    });
    await writeFile(npmEnv.npm_config_userconfig, '', { mode: 0o600 });
    await writeFile(npmEnv.npm_config_globalconfig, '', { mode: 0o600 });

    // Phase 1: pinned candidate artifact.
    console.log(`[1/7] candidate artifact ${CANDIDATE.name}@${CANDIDATE.version}`);
    const tarball = await fetchBytes(CANDIDATE.tarball);
    assert.equal(sha512sri(tarball), CANDIDATE.integrity, 'candidate tarball SRI mismatch');
    // Negative artifact control: altered bytes cannot pass the same gate.
    assert.notEqual(sha512sri(Buffer.concat([tarball, Buffer.from('changed')])), CANDIDATE.integrity);
    const packument = await (await fetch('https://registry.npmjs.org/gpt-tokenizer', { signal: AbortSignal.timeout(30000) })).json();
    const versionMeta = packument.versions[CANDIDATE.version];
    assert.ok(versionMeta, 'candidate version missing from registry');
    assert.equal(versionMeta.gitHead, CANDIDATE.gitHead, 'candidate gitHead mismatch');
    assert.equal(versionMeta.dist.integrity, CANDIDATE.integrity, 'registry SRI disagrees with pin');
    evidence.candidate = { gitHead: versionMeta.gitHead, sri: CANDIDATE.integrity, tarballBytes: tarball.length };

    // Phase 2: disposable install, no lifecycle scripts, bounded group.
    console.log('[2/7] disposable candidate install (no lifecycle scripts)');
    const install = join(root, 'install');
    await mkdir(install, { mode: 0o700 });
    await writeFile(join(install, 'package.json'), JSON.stringify({ name: 'disposable-tokenizer-probe', private: true }));
    await writeFile(join(install, 'hehebot-gpt-tokenizer.tgz'), tarball);
    const npmInstall = await runBoundedChild('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', './hehebot-gpt-tokenizer.tgz'], { cwd: install, env: npmEnv, timeoutMs: 180000 });
    assert.equal(npmInstall.code, 0, `npm install failed: ${npmInstall.stderr}`);
    assert.equal(npmInstall.timedOut, false, 'npm install timed out (harness safety failure)');
    const installed = JSON.parse(await readFile(join(install, 'node_modules/gpt-tokenizer/package.json')));
    assert.equal(installed.name, CANDIDATE.name);
    assert.equal(installed.version, CANDIDATE.version);
    assert.equal(Object.keys(installed.dependencies ?? {}).length, 0, 'candidate must have no runtime dependencies');
    evidence.candidateInstall = { version: installed.version, runtimeDependencies: 0 };

    // Phase 3: deterministic corpus.
    console.log('[3/7] deterministic corpus');
    const cases = buildCorpus();
    const again = buildCorpus();
    assert.deepEqual(cases, again, 'corpus is not deterministic');
    const corpusJson = JSON.stringify({ texts: cases.map(c => c.text) });
    const corpusSha256 = sha256hex(Buffer.from(corpusJson));
    evidence.corpus = { cases: cases.length, sha256: corpusSha256 };
    console.log(`      ${cases.length} cases, corpus sha256 ${corpusSha256}`);
    await writeFile(join(root, 'corpus.json'), corpusJson);
    await writeFile(join(root, 'cases.json'), JSON.stringify(cases));

    // Phase 4: official reference vectors (independent generation, bounded group).
    console.log(`[4/7] reference ${REFERENCE.package}==${REFERENCE.version} o200k_base encode_ordinary`);
    const cacheDir = join(root, 'ranks');
    await mkdir(cacheDir, { mode: 0o700 });
    const ranks = await fetchBytes(RANKS.url);
    assert.equal(sha256hex(ranks), RANKS.sha256, 'o200k_base ranks hash mismatch');
    assert.notEqual(sha256hex(Buffer.concat([ranks, Buffer.from('x')])), RANKS.sha256, 'ranks hash sanity');
    // tiktoken cache layout: file name is sha1(url); tiktoken re-validates the
    // SHA-256 assertion itself when loading the encoding.
    const ranksName = createHash('sha1').update(RANKS.url).digest('hex');
    await writeFile(join(cacheDir, ranksName), ranks);
    const pyEnv = childEnv(root, home, { XDG_CACHE_HOME: join(home, 'xdg'), TIKTOKEN_CACHE_DIR: cacheDir, UV_CACHE_DIR: join(home, 'uv') });
    const venv = join(root, 'pyref');
    await mkdir(venv, { mode: 0o700 });
    let uvAvailable = true;
    const uvCheck = await runBoundedChild('uv', ['--version'], { env: pyEnv, timeoutMs: 30000 }).catch(() => null);
    uvAvailable = uvCheck !== null && uvCheck.code === 0;
    if (uvAvailable) {
      const venvOut = await runBoundedChild('uv', ['venv', '--python', 'python3', join(venv, '.venv')], { env: pyEnv, timeoutMs: 180000 });
      assert.equal(venvOut.code, 0, `uv venv failed: ${venvOut.stderr}`);
      const pipOut = await runBoundedChild('uv', ['pip', 'install', '--python', join(venv, '.venv', 'bin', 'python'), `${REFERENCE.package}==${REFERENCE.version}`], { env: pyEnv, timeoutMs: 300000 });
      assert.equal(pipOut.code, 0, `uv pip install failed: ${pipOut.stderr}`);
    } else {
      const venvOut = await runBoundedChild('python3', ['-m', 'venv', join(venv, '.venv')], { env: pyEnv, timeoutMs: 180000 });
      assert.equal(venvOut.code, 0, `python3 -m venv failed: ${venvOut.stderr}`);
      const pipOut = await runBoundedChild(join(venv, '.venv', 'bin', 'pip'), ['install', `${REFERENCE.package}==${REFERENCE.version}`], { env: pyEnv, timeoutMs: 300000 });
      assert.equal(pipOut.code, 0, `pip install failed: ${pipOut.stderr}`);
    }
    const python = join(venv, '.venv', 'bin', 'python');
    await writeFile(join(venv, 'reference.py'), PY_REFERENCE_SCRIPT);
    const referencePath = join(root, 'reference.json');
    const referenceRun = await runBoundedChild(python, [join(venv, 'reference.py'), join(root, 'corpus.json')], { env: pyEnv, timeoutMs: 300000 });
    assert.equal(referenceRun.code, 0, `reference generation failed: ${referenceRun.stderr}`);
    assert.equal(referenceRun.timedOut, false, 'reference generation timed out (harness safety failure)');
    const reference = JSON.parse(referenceRun.stdout);
    await writeFile(referencePath, JSON.stringify(reference));
    assert.equal(reference.version, REFERENCE.version, 'reference version mismatch');
    assert.equal(reference.encodings.length, cases.length, 'reference case count mismatch');
    evidence.reference = { package: REFERENCE.package, version: reference.version, ranksSha256: RANKS.sha256, cases: reference.encodings.length };
    // Discriminating-power control: each discriminator pair must produce
    // different reference encodings, otherwise the corpus would not test the
    // token boundaries it claims to test.
    const byId = new Map(cases.map((c, i) => [c.id, reference.encodings[i]]));
    for (const [id1, , id2] of discriminatorPairs()) {
      assert.notDeepEqual(byId.get(id1), byId.get(id2), `discriminator pair ${id1}/${id2} tokenizes identically; corpus is not discriminating`);
    }
    evidence.corpus.discriminatorPairs = discriminatorPairs().length;

    // Phase 5: candidate in Node (parity path 1) + negative parity control.
    console.log('[5/7] candidate parity in Node');
    const nodeRunner = `
import { readFile, writeFile } from 'node:fs/promises';
import { encode, setMergeCacheSize } from 'gpt-tokenizer/encoding/o200k_base';
setMergeCacheSize(0);
const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
const encodings = data.texts.map(t => encode(t, { allowedSpecial: new Set(), disallowedSpecial: new Set() }));
await writeFile(process.argv[3], JSON.stringify({ encodings }));
`;
    await writeFile(join(install, 'node-runner.mjs'), nodeRunner);
    const nodeOutPath = join(root, 'node-encodings.json');
    const nodeRun = await runBoundedChild(process.execPath, [join(install, 'node-runner.mjs'), join(root, 'corpus.json'), nodeOutPath], { cwd: install, env: npmEnv, timeoutMs: 300000 });
    assert.equal(nodeRun.code, 0, `node runner failed: ${nodeRun.stderr}`);
    assert.equal(nodeRun.timedOut, false, 'node runner timed out (harness safety failure)');
    const nodeEncodings = JSON.parse(await readFile(nodeOutPath)).encodings;
    assertParity(cases, reference.encodings, nodeEncodings, 'node');
    // Negative parity control: a corrupted expected token must be detected.
    const corrupted = corruptExpectation(cases, reference.encodings);
    assert.throws(() => assertParity(cases, corrupted.expected, nodeEncodings, 'negative-control'), new RegExp(corrupted.caseId));
    assert.throws(() => assertParity(cases, corrupted.expected, nodeEncodings, 'negative-control'), new RegExp(`token index ${corrupted.index}`));
    evidence.nodeParity = { cases: cases.length, corruptedCase: corrupted.caseId, corruptedIndex: corrupted.index, detected: true };
    console.log(`      ${cases.length} cases match; corrupted ${corrupted.caseId}[${corrupted.index}] (${corrupted.from}->${corrupted.to}) detected`);

    // Phase 6: candidate + actual application module in real local workerd,
    // executed by a bounded child process group (see WORKERD_CHILD_SOURCE).
    console.log('[6/7] workerd load harness (Miniflare, real app module bundled)');
    const probeEntry = join(install, 'probe-entry.mjs');
    const probeSource = `// Probe-only worker: tokenizes through the candidate and validates memory.put
// payloads with the real application command validator. It never calls any
// application or provider route: only /probe/* is served, everything else 404s.
import appEntry, { PersonalControl } from ${JSON.stringify(join(REPO, 'src/worker/index.ts'))};
import { parseCommand } from ${JSON.stringify(join(REPO, 'src/core/control.ts'))};
import { encode, setMergeCacheSize } from 'gpt-tokenizer/encoding/o200k_base';
setMergeCacheSize(0);
const UUID = '123e4567-e89b-42d3-a456-426614174000';
function memoryPut(text) {
  return { schema_version: 1, type: 'memory.put', payload: {
    id: UUID, expected_revision: 0, scope: { kind: 'global', id: null }, text,
    source_event_id: UUID, expires_at: null, sensitivity: 'ordinary' } };
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/probe/health') {
      return Response.json({ ok: true, appEntry: typeof appEntry, control: typeof PersonalControl });
    }
    if (url.pathname === '/probe/encode') {
      const { records, full } = await request.json();
      const encodings = records.map(t => encode(t, { allowedSpecial: new Set(), disallowedSpecial: new Set() }));
      return Response.json(full ? { encodings } : { counts: encodings.map(e => e.length) });
    }
    if (url.pathname === '/probe/validate') {
      const { text } = await request.json();
      try { parseCommand(memoryPut(text)); return Response.json({ valid: true }); }
      catch (error) { return Response.json({ valid: false, name: error && error.name, code: error && error.code }); }
    }
    return new Response('not found', { status: 404 });
  },
};
`;
    await writeFile(probeEntry, probeSource);
    const childScript = join(runDir, 'workerd-child.mjs');
    await mkdir(runDir, { recursive: true });
    await writeFile(childScript, WORKERD_CHILD_SOURCE);
    const childResultPath = join(runDir, 'workerd-result.json');
    const probeBundlePath = join(root, 'probe-bundle.mjs');
    const workerdChild = await runBoundedChild(process.execPath, [childScript, probeEntry, probeBundlePath, join(root, 'cases.json'), referencePath, childResultPath], { cwd: REPO, env: childEnv(root, home), timeoutMs: WORKERD_CHILD_TIMEOUT_MS });
    await writeFile(join(runDir, 'workerd-child.stdout'), workerdChild.stdout || '');
    await writeFile(join(runDir, 'workerd-child.stderr'), workerdChild.stderr || '');
    if (workerdChild.timedOut) {
      throw new Error(`workerd phase timed out after ${WORKERD_CHILD_TIMEOUT_MS}ms (harness safety failure, not performance acceptance); process group terminated; partial observations in ${childResultPath}`);
    }
    let workerdResult = null;
    try { workerdResult = JSON.parse(await readFile(childResultPath, 'utf8')); } catch { /* no result file */ }
    if (workerdChild.code !== 0) {
      throw new Error(`workerd child exited ${workerdChild.code}: ${(workerdResult && workerdResult.error) || workerdChild.stderr}`);
    }
    assert.ok(workerdResult && !workerdResult.partial, 'workerd child result incomplete');
    evidence.workerd = {
      runtime: 'local workerd via installed Miniflare (bounded child process group)',
      bundleBytes: workerdResult.bundleBytes,
      readyMs: workerdResult.readyMs,
      appModule: 'src/worker/index.ts + src/core/control.ts bundled (not called)',
      parityCases: workerdResult.parityCases,
      parityMs: workerdResult.parityMs,
      heapUsedBefore: workerdResult.heapUsedBefore,
      heapTotalBefore: workerdResult.heapTotalBefore,
      heapUsedAfter: workerdResult.heapUsedAfter,
      heapTotalAfter: workerdResult.heapTotalAfter,
      batches: workerdResult.batches,
      schemaBoundary: workerdResult.schemaBoundary,
    };
    console.log(`      ready ${workerdResult.readyMs}ms, parity ${workerdResult.parityCases} cases in ${workerdResult.parityMs}ms, bundle ${workerdResult.bundleBytes} bytes`);
    console.log(`      JS heap used/total before workload: ${workerdResult.heapUsedBefore}/${workerdResult.heapTotalBefore}, after: ${workerdResult.heapUsedAfter}/${workerdResult.heapTotalAfter}`);
    console.log(`      batches (max-size records): ${BATCH_SIZES.map(s => `${s} records in ${workerdResult.batches[s].ms}ms`).join(', ')}`);

    // Phase 7: summary. Timings above are observations only, not thresholds.
    console.log('[7/7] summary');
    evidence.completedAt = new Date().toISOString();
    evidence.totalMs = Date.now() - started;
    evidence.result = 'pass';
    evidence.disposableFixtureRemoved = true;
    await writeEvidence(runDir, evidence);
    console.log(`evidence: ${join(runDir, 'evidence.json')}`);
    console.log(JSON.stringify({ result: 'pass', cases: cases.length, totalMs: evidence.totalMs }, null, 2));
    console.log('limitations: JS heap is not isolate memory; wall-clock is not billed CPU; local workerd is not deployed acceptance; timings are observations, not thresholds; timeouts are safety failures, never performance acceptance; no total-memory-count bound is claimed.');
  } catch (error) {
    evidence.result = 'fail';
    evidence.failedAt = new Date().toISOString();
    evidence.failure = String(error && error.stack || error);
    evidence.disposableFixtureRemoved = false;
    evidence.disposableFixtureRetained = root;
    retained = true;
    await writeEvidence(runDir, evidence).catch(() => {});
    console.error(`FAIL: ${evidence.failure}`);
    console.error(`evidence preserved in ${runDir}; disposable fixture retained at ${root}`);
    process.exitCode = 1;
  } finally {
    // Owned workers are terminated by the child's dispose plus the group kill;
    // the disposable fixture is removed only on success and retained on failure.
    if (!retained) await rm(root, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
