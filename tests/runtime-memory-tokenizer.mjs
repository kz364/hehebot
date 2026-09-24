import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countMemory } from '../runtime/memory-tokenizer.mjs';

// Offline unit tests for the runtime memory tokenizer. The pinned candidate
// (gpt-tokenizer@4.0.0, narrow `gpt-tokenizer/encoding/o200k_base` import,
// merge cache 0, special literals as ordinary text) must be installed at the
// repository root for the counting tests; nothing here installs anything or
// touches the network.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_PATH = join(REPO, 'runtime', 'memory-tokenizer.mjs');
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const TOKENIZER_ID = 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1';
const OBSERVE = Symbol.for('hehebot.memory-tokenizer.observe');
const observe = () => countMemory[OBSERVE]();

// Expected token counts were computed independently with the official OpenAI
// tiktoken 0.11.0 Python package, o200k_base encode_ordinary (TIKTOKEN_CACHE_DIR
// ranks pinned to sha256 446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d),
// never with the candidate under test. Lone surrogates were passed through
// Python str unchanged; every expected value was cross-checked against the
// candidate once during verification, but the expectations below remain
// reference-derived only.

// Fast, asymmetric shapes: multilingual text, combining marks, emoji ZWJ
// sequences, lone and reversed surrogates, special literals as ordinary text,
// astral text, and per-bucket asymmetry.
const FAST_REFERENCE_CASES = [
  { id: 'both-empty', global: '', scoped: '', global_tokens: 0, scoped_tokens: 0 },
  { id: 'hello', global: 'Hello, world!', scoped: '', global_tokens: 4, scoped_tokens: 0 },
  {
    id: 'indonesian',
    global: 'Selamat pagi! Apa kabar hari ini? Saya ingat kamu menyukai kopi tanpa gula.',
    scoped: '',
    global_tokens: 20,
    scoped_tokens: 0,
  },
  { id: 'chinese', global: '你好，世界！这是一个记忆分词测试。', scoped: '', global_tokens: 12, scoped_tokens: 0 },
  { id: 'arabic', global: 'صباح الخير، كيف حالك اليوم؟', scoped: '', global_tokens: 9, scoped_tokens: 0 },
  // Explicit escapes so the exact decomposed form (NFD, matching the
  // reference computation) cannot be normalized away by editors.
  { id: 'combining-decomposed', global: 'e\u0301cole supe\u0301rieure', scoped: '', global_tokens: 8, scoped_tokens: 0 },
  { id: 'emoji-zwj-family', global: '👨‍👩‍👧‍👦', scoped: '', global_tokens: 11, scoped_tokens: 0 },
  { id: 'lone-high', global: 'a\ud800b', scoped: '', global_tokens: 3, scoped_tokens: 0 },
  { id: 'lone-low-pair', global: '\udc00\ud800', scoped: '', global_tokens: 1, scoped_tokens: 0 },
  // The end-of-text delimiter compared as ordinary text, never as a control
  // token; explicit escapes keep the literal unambiguous.
  { id: 'special-endoftext-literal', global: '<\u007cendoftext\u007c>', scoped: '', global_tokens: 7, scoped_tokens: 0 },
  {
    id: 'special-chat-literals',
    global: '<|im_start|>assistant\nHow can I help you today?<|im_end|>',
    scoped: '',
    global_tokens: 20,
    scoped_tokens: 0,
  },
  { id: 'astral-repeat-100', global: '𝐀'.repeat(100), scoped: '', global_tokens: 200, scoped_tokens: 0 },
  {
    id: 'asymmetric-buckets',
    global: '你好，世界！这是一个记忆分词测试。',
    scoped: 'صباح الخير، كيف حالك اليوم؟',
    global_tokens: 12,
    scoped_tokens: 9,
  },
];

// Slow cases: exactly the 131072 combined UTF-8 byte limit in every byte-width
// composition (ASCII, BMP, astral, lone surrogates as U+FFFD, and split
// across both buckets).
const LIMIT_REFERENCE_CASES = [
  { id: 'max-ascii-131072b', global: 'x'.repeat(131072), scoped: '', global_tokens: 16384, scoped_tokens: 0 },
  { id: 'max-bmp-131072b', global: '中'.repeat(43690) + 'ab', scoped: '', global_tokens: 43691, scoped_tokens: 0 },
  { id: 'max-astral-131072b', global: '𝐀'.repeat(32768), scoped: '', global_tokens: 65536, scoped_tokens: 0 },
  {
    id: 'split-ascii-half-half',
    global: 'x'.repeat(65536),
    scoped: 'x'.repeat(65536),
    global_tokens: 8192,
    scoped_tokens: 8192,
  },
  {
    id: 'max-lone-surrogate-131072b',
    global: '\ud800'.repeat(43690) + 'ab',
    scoped: '',
    global_tokens: 5463,
    scoped_tokens: 0,
  },
];

test('countMemory returns exact reference token counts for asymmetric Unicode and special literals', async () => {
  assert.ok(observe() && Number.isSafeInteger(observe().activeWorkers));
  const baseline = observe().activeWorkers;
  for (const testCase of FAST_REFERENCE_CASES) {
    const result = await countMemory({
      selected_model: 'gpt-5.1-codex-mini-2026-08-07',
      global: testCase.global,
      scoped: testCase.scoped,
    });
    assert.deepEqual(result, {
      schema_version: 1,
      selected_model: 'gpt-5.1-codex-mini-2026-08-07',
      tokenizer: TOKENIZER_ID,
      global_tokens: testCase.global_tokens,
      scoped_tokens: testCase.scoped_tokens,
    }, `case ${testCase.id}`);
  }
  assert.equal(observe().activeWorkers, baseline);
});

test('countMemory returns exact reference token counts at the combined 131072-byte limit in every byte-width composition', async () => {
  const baseline = observe().activeWorkers;
  for (const testCase of LIMIT_REFERENCE_CASES) {
    const result = await countMemory({ selected_model: 'gpt-5.1', global: testCase.global, scoped: testCase.scoped });
    assert.deepEqual(result, {
      schema_version: 1,
      selected_model: 'gpt-5.1',
      tokenizer: TOKENIZER_ID,
      global_tokens: testCase.global_tokens,
      scoped_tokens: testCase.scoped_tokens,
    }, `case ${testCase.id}`);
  }
  assert.equal(observe().activeWorkers, baseline);
});

test('countMemory rejects one byte over the combined limit in every composition and never starts a worker', async () => {
  const baseline = observe().activeWorkers;
  const overLimitInputs = [
    { name: 'ascii global one over', global: 'x'.repeat(131073), scoped: '' },
    { name: 'ascii scoped one over', global: '', scoped: 'x'.repeat(131073) },
    { name: 'ascii spill from global to scoped', global: 'x'.repeat(131072), scoped: 'x' },
    { name: 'ascii split one over', global: 'x'.repeat(65537), scoped: 'x'.repeat(65536) },
    { name: 'astral max plus one ascii byte', global: '𝐀'.repeat(32768) + 'x', scoped: '' },
    { name: 'astral one char over', global: '𝐀'.repeat(32769), scoped: '' },
    { name: 'astral over in scoped', global: '', scoped: '𝐀'.repeat(32769) },
    { name: 'bmp one over', global: '中'.repeat(43691), scoped: '' },
    { name: 'lone surrogate one over (U+FFFD accounting)', global: '\ud800'.repeat(43691), scoped: '' },
  ];
  for (const over of overLimitInputs) {
    await assert.rejects(
      () => countMemory({ selected_model: 'gpt-5.1', global: over.global, scoped: over.scoped }),
      error => error.code === 'INVALID_INPUT' && /131072/.test(error.message),
      over.name,
    );
  }
  assert.equal(observe().activeWorkers, baseline, 'no worker may be started for over-limit input');
});

test('countMemory validates selected_model strictly and echoes it without deciding eligibility', async () => {
  const baseline = observe().activeWorkers;
  const invalidModels = ['', 'x'.repeat(129), 'has space', 'bad/slash', 'bad:colon', 'bad+plus', 123, null, true];
  for (const selected_model of invalidModels) {
    await assert.rejects(
      () => countMemory({ selected_model, global: '', scoped: '' }),
      error => error.code === 'INVALID_INPUT',
      `model ${JSON.stringify(selected_model)}`,
    );
  }
  assert.equal(observe().activeWorkers, baseline, 'no worker may be started for invalid model ids');
  // A 128-character id at the pattern boundary is valid and echoed only: any
  // well-shaped id is counted, including one that is not a real model, since
  // selection and eligibility are not this unit's decisions.
  const boundary = 'm'.repeat(128);
  const result = await countMemory({ selected_model: boundary, global: 'x', scoped: '' });
  assert.equal(result.selected_model, boundary);
  assert.equal(result.global_tokens, 1);
  const fake = await countMemory({ selected_model: 'not-a-real-model', global: 'x', scoped: '' });
  assert.equal(fake.selected_model, 'not-a-real-model');
  assert.equal(fake.global_tokens, 1);
});

test('countMemory validates the input shape strictly and never starts a worker for bad input', async () => {
  const baseline = observe().activeWorkers;
  const invalidInputs = [
    undefined,
    null,
    'string',
    42,
    [],
    [{ selected_model: 'gpt-5.1', global: '', scoped: '' }],
    { selected_model: 'gpt-5.1', global: '', scoped: '', extra: 1 },
    { selected_model: 'gpt-5.1', global: '' },
    { selected_model: 'gpt-5.1', scoped: '' },
    { global: '', scoped: '' },
    { selected_model: 'gpt-5.1', global: 123, scoped: '' },
    { selected_model: 'gpt-5.1', global: null, scoped: '' },
    { selected_model: 'gpt-5.1', global: '', scoped: [] },
    { selected_model: 'gpt-5.1', global: {}, scoped: '' },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(() => countMemory(input), error => error.code === 'INVALID_INPUT');
  }
  assert.equal(observe().activeWorkers, baseline, 'no worker may be started for invalid input');
});

test('countMemory validates options strictly and never starts a worker for bad options', async () => {
  const baseline = observe().activeWorkers;
  const validInput = { selected_model: 'gpt-5.1', global: '', scoped: '' };
  const invalidOptions = [
    null,
    42,
    'fast',
    [],
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 60001 },
    { timeoutMs: 1.5 },
    { timeoutMs: '30000' },
    { timeoutMs: Number.NaN },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { timeoutMs: 30000, extra: true },
    { signal: 'AbortSignal' },
    { signal: {} },
    { signal: new AbortController() },
  ];
  for (const options of invalidOptions) {
    await assert.rejects(() => countMemory(validInput, options), error => error.code === 'INVALID_OPTIONS');
  }
  assert.equal(observe().activeWorkers, baseline, 'no worker may be started for invalid options');
  // Both timeout boundaries are accepted option values: 60000ms completes the
  // tiny count, and the 1ms deadline is a real deadline that fires during
  // worker startup (startup alone far exceeds 1ms).
  assert.equal((await countMemory(validInput, { timeoutMs: 60000 })).global_tokens, 0);
  await assert.rejects(
    () => countMemory(validInput, { timeoutMs: 1 }),
    error => error.code === 'TOKENIZER_TIMEOUT',
  );
});

test('a pre-aborted signal rejects immediately without starting a worker', async () => {
  const baseline = observe().activeWorkers;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => countMemory({ selected_model: 'gpt-5.1', global: 'x', scoped: '' }, { signal: controller.signal }),
    error => error.code === 'TOKENIZER_ABORTED' && error.name === 'AbortError',
  );
  assert.equal(observe().activeWorkers, baseline);
});

test('timeout terminates and awaits the owned worker and leaves the unit usable', async () => {
  const baseline = observe().activeWorkers;
  await assert.rejects(
    () => countMemory({ selected_model: 'gpt-5.1', global: '𝐀'.repeat(16384), scoped: '' }, { timeoutMs: 1 }),
    error => error.code === 'TOKENIZER_TIMEOUT' && /^memory tokenizer worker timed out after 1ms/.test(error.message),
  );
  // The observation count only decreases once terminate() has been awaited,
  // so a return to baseline proves the owned worker actually stopped.
  assert.equal(observe().activeWorkers, baseline);
  const result = await countMemory({ selected_model: 'gpt-5.1', global: 'Hello, world!', scoped: '' });
  assert.deepEqual(result, {
    schema_version: 1,
    selected_model: 'gpt-5.1',
    tokenizer: TOKENIZER_ID,
    global_tokens: 4,
    scoped_tokens: 0,
  });
});

test('aborting mid-count terminates the owned worker and rejects with TOKENIZER_ABORTED', async () => {
  const baseline = observe().activeWorkers;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 300);
  try {
    await assert.rejects(
      () => countMemory({ selected_model: 'gpt-5.1', global: '𝐀'.repeat(16384), scoped: '' }, { signal: controller.signal }),
      error => error.code === 'TOKENIZER_ABORTED' && error.name === 'AbortError',
    );
  } finally {
    clearTimeout(abortTimer);
  }
  assert.equal(observe().activeWorkers, baseline);
});

test('the supervisor event loop stays responsive during real tokenization work', async () => {
  let ticks = 0;
  const interval = setInterval(() => { ticks += 1; }, 10);
  try {
    const result = await countMemory({ selected_model: 'gpt-5.1', global: '𝐀'.repeat(16384), scoped: '' }, { timeoutMs: 60000 });
    assert.equal(result.global_tokens, 32768);
    assert.equal(result.scoped_tokens, 0);
  } finally {
    clearInterval(interval);
  }
  // Real work runs for seconds in the owned worker; a blocked supervisor
  // event loop would keep the 10ms timer from firing at all.
  assert.ok(ticks >= 20, `supervisor event loop was blocked during tokenization: only ${ticks} timer ticks`);
});

test('concurrent counts run in independent owned workers and return their own exact counts', async () => {
  const [a, b] = await Promise.all([
    countMemory({ selected_model: 'gpt-5.1', global: 'Hello, world!', scoped: '' }),
    countMemory({ selected_model: 'gpt-5.1', global: '你好，世界！这是一个记忆分词测试。', scoped: '' }),
  ]);
  assert.deepEqual(a, {
    schema_version: 1, selected_model: 'gpt-5.1', tokenizer: TOKENIZER_ID, global_tokens: 4, scoped_tokens: 0,
  });
  assert.deepEqual(b, {
    schema_version: 1, selected_model: 'gpt-5.1', tokenizer: TOKENIZER_ID, global_tokens: 12, scoped_tokens: 0,
  });
  assert.equal(observe().activeWorkers, 0);
});

// ---------------------------------------------------------------------------
// Bounded subprocess checks: an owned worker that was not really terminated
// keeps its host process alive, so a subprocess exiting (or being killed by a
// bound shorter than the natural work) proves actual termination.
// ---------------------------------------------------------------------------

async function runBoundedNode(scriptPath, { timeoutMs, killGraceMs = 2000 } = {}) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('a timed-out owned worker is terminated so its host process can exit before natural completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hehebot-e06-timeout-'));
  try {
    const script = join(dir, 'run.mjs');
    await writeFile(script, `import { countMemory } from ${JSON.stringify(MODULE_URL)};
// Natural completion of this synchronous encode takes far longer than the
// harness bound, so the process only exits if the owned worker was terminated.
try {
  await countMemory({ selected_model: 'gpt-5.1', global: 'x'.repeat(131072), scoped: '' }, { timeoutMs: 1 });
  console.log('UNEXPECTED-RESOLVE');
  process.exitCode = 1;
} catch (error) {
  if (error.code !== 'TOKENIZER_TIMEOUT') { console.log('UNEXPECTED-CODE ' + error.code); process.exitCode = 1; }
  else console.log('TERMINATED');
}
`);
    const result = await runBoundedNode(script, { timeoutMs: 20000 });
    assert.equal(result.timedOut, false, 'subprocess was killed by the harness bound');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /TERMINATED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an aborted owned worker is terminated so its host process can exit before natural completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hehebot-e06-abort-'));
  try {
    const script = join(dir, 'run.mjs');
    await writeFile(script, `import { countMemory } from ${JSON.stringify(MODULE_URL)};
const controller = new AbortController();
setTimeout(() => controller.abort(), 300);
try {
  await countMemory({ selected_model: 'gpt-5.1', global: 'x'.repeat(131072), scoped: '' }, { signal: controller.signal });
  console.log('UNEXPECTED-RESOLVE');
  process.exitCode = 1;
} catch (error) {
  if (error.code !== 'TOKENIZER_ABORTED') { console.log('UNEXPECTED-CODE ' + error.code); process.exitCode = 1; }
  else console.log('ABORTED');
}
`);
    const result = await runBoundedNode(script, { timeoutMs: 20000 });
    assert.equal(result.timedOut, false, 'subprocess was killed by the harness bound');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ABORTED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a successful count leaves no live resource: the host process exits on its own', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hehebot-e06-exit-'));
  try {
    const script = join(dir, 'run.mjs');
    await writeFile(script, `import { countMemory } from ${JSON.stringify(MODULE_URL)};
const result = await countMemory({ selected_model: 'gpt-5.1', global: 'Hello, world!', scoped: '你好，世界！这是一个记忆分词测试。' });
if (result.global_tokens !== 4 || result.scoped_tokens !== 12) {
  console.log('WRONG-COUNT ' + result.global_tokens + '/' + result.scoped_tokens);
  process.exitCode = 1;
} else {
  console.log('CLEAN-EXIT');
}
`);
    const result = await runBoundedNode(script, { timeoutMs: 20000 });
    assert.equal(result.timedOut, false, 'subprocess was killed by the harness bound');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /CLEAN-EXIT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the module performs no network, filesystem, credential, or external-process actions', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const forbiddenPatterns = [
    [/node:http/, 'http client'],
    [/node:https/, 'https client'],
    [/node:net\b/, 'raw sockets'],
    [/node:tls/, 'tls'],
    [/node:dns/, 'dns'],
    [/node:fs/, 'filesystem'],
    [/node:child_process/, 'child processes'],
    [/\bfetch\s*\(/, 'fetch'],
    [/XMLHttpRequest/, 'XHR'],
    [/\bWebSocket\b/, 'websocket'],
    [/undici/, 'undici'],
    [/process\.env/, 'environment variables'],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    assert.ok(!pattern.test(source), `module source must not use ${label}`);
  }
  const allowedSpecifiers = new Set([
    'node:worker_threads',
    'gpt-tokenizer/encoding/o200k_base',
    'gpt-tokenizer/package.json',
  ]);
  const specifiers = [
    ...source.matchAll(/from\s+'([^']+)'/g),
    ...source.matchAll(/import\(\s*'([^']+)'/g),
  ].map(match => match[1]);
  assert.ok(specifiers.length >= 3, 'expected the worker_threads static import plus the two tokenizer dynamic imports');
  for (const specifier of specifiers) {
    assert.ok(allowedSpecifiers.has(specifier), `unexpected module specifier: ${specifier}`);
  }
  assert.deepEqual([...new Set(specifiers)].sort(), [...allowedSpecifiers].sort());
});
