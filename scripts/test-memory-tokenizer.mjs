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
// The candidate is installed only into a disposable directory with no lifecycle
// scripts and no inherited credentials; nothing is added to the repository
// dependency tree. Requires network access to registry.npmjs.org, PyPI, and
// openaipublic.blob.core.windows.net (public package/rank downloads only).
// Run from the repository root: node scripts/test-memory-tokenizer.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

const sha256hex = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512sri = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

// ---------------------------------------------------------------------------
// Pure, exported helpers (deterministic corpus + comparison logic). Imported by
// tests/runtime-tokenizer-parity.mjs; importing this file has no side effects.
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
  add('specialLiteralEndoftext', '<|endoftext|> is treated as ordinary text here.');
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
    specials: ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<|endofprompt|>'],
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
  const ranges = [[0x20, 0x7E], [0x4E00, 0x9FFF], [0x0600, 0x06FF], [0x0300, 0x036F], [0x1F300, 0x1F6FF]];
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
  // so the maximum legal record may be 16000 astral code points = 32000 UTF-16
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

  const ids = cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'corpus case ids must be unique');
  return cases;
}

// Maximum-size record used for multi-record batch load cases. The heaviest
// record the current memory-text contract admits is 16000 astral code points.
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
  let caseIndex = cases.findIndex((c, i) => expected[i].length >= 3);
  assert.ok(caseIndex >= 0, 'no case with >=3 tokens to corrupt');
  const index = Math.floor(corrupted[caseIndex].length / 2);
  const from = corrupted[caseIndex][index];
  const to = from === 0 ? 1 : from + 1;
  corrupted[caseIndex][index] = to;
  return { expected: corrupted, caseId: cases[caseIndex].id, index, from, to };
}

// ---------------------------------------------------------------------------
// Main harness.
// ---------------------------------------------------------------------------

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

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

const PY_REFERENCE_SCRIPT = `
import json, sys, tiktoken
data = json.load(open(sys.argv[1], encoding="utf-8"))
enc = tiktoken.get_encoding("o200k_base")
encodings = [enc.encode_ordinary(t) for t in data["texts"]]
json.dump({"version": tiktoken.__version__, "encodings": encodings}, sys.stdout)
sys.stdout.write("\\n")
`;

async function main() {
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
      'the app has a per-record memory-text limit only; no total-memory-count bound is claimed',
    ],
  };
  const failures = [];
  const started = Date.now();
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

    // Phase 2: disposable install, no lifecycle scripts.
    console.log('[2/7] disposable candidate install (no lifecycle scripts)');
    const install = join(root, 'install');
    await mkdir(install, { mode: 0o700 });
    await writeFile(join(install, 'package.json'), JSON.stringify({ name: 'disposable-tokenizer-probe', private: true }));
    await writeFile(join(install, 'hehebot-gpt-tokenizer.tgz'), tarball);
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', './hehebot-gpt-tokenizer.tgz'], { cwd: install, env: npmEnv, timeout: 180000 });
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

    // Phase 4: official reference vectors (independent generation).
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
    try { await run('uv', ['--version'], { env: pyEnv, timeout: 30000 }); }
    catch { uvAvailable = false; }
    if (uvAvailable) {
      await run('uv', ['venv', '--python', 'python3', join(venv, '.venv')], { env: pyEnv, timeout: 180000 });
      await run('uv', ['pip', 'install', '--python', join(venv, '.venv', 'bin', 'python'), `${REFERENCE.package}==${REFERENCE.version}`], { env: pyEnv, timeout: 300000 });
    } else {
      await run('python3', ['-m', 'venv', join(venv, '.venv')], { env: pyEnv, timeout: 180000 });
      await run(join(venv, '.venv', 'bin', 'pip'), ['install', `${REFERENCE.package}==${REFERENCE.version}`], { env: pyEnv, timeout: 300000 });
    }
    const python = join(venv, '.venv', 'bin', 'python');
    await writeFile(join(venv, 'reference.py'), PY_REFERENCE_SCRIPT);
    const referenceOut = await run(python, [join(venv, 'reference.py'), join(root, 'corpus.json')], { env: pyEnv, timeout: 300000, maxBuffer: 256 * 1024 * 1024 });
    const reference = JSON.parse(referenceOut.stdout);
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
    await run(process.execPath, [join(install, 'node-runner.mjs'), join(root, 'corpus.json'), nodeOutPath], { env: npmEnv, cwd: install, timeout: 300000 });
    const nodeEncodings = JSON.parse(await readFile(nodeOutPath)).encodings;
    assertParity(cases, reference.encodings, nodeEncodings, 'node');
    // Negative parity control: a corrupted expected token must be detected.
    const corrupted = corruptExpectation(cases, reference.encodings);
    assert.throws(() => assertParity(cases, corrupted.expected, nodeEncodings, 'negative-control'), new RegExp(corrupted.caseId));
    assert.throws(() => assertParity(cases, corrupted.expected, nodeEncodings, 'negative-control'), new RegExp(`token index ${corrupted.index}`));
    evidence.nodeParity = { cases: cases.length, corruptedCase: corrupted.caseId, corruptedIndex: corrupted.index, detected: true };
    console.log(`      ${cases.length} cases match; corrupted ${corrupted.caseId}[${corrupted.index}] (${corrupted.from}->${corrupted.to}) detected`);

    // Phase 6: candidate + actual application module in real local workerd.
    console.log('[6/7] workerd load harness (Miniflare, real app module bundled)');
    const { build } = await import('esbuild');
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
    const probeBundle = join(root, 'probe-bundle.mjs');
    await build({
      entryPoints: [probeEntry], outfile: probeBundle,
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      loader: { '.sql': 'text' },
      external: ['cloudflare:*', 'node:*'],
      logLevel: 'silent',
    });
    const bundleBytes = (await readFile(probeBundle)).length;
    const { Miniflare } = await import('miniflare');
    const WORKER_NAME = 'hehebot-tokenizer-probe';
    const mainModule = 'probe.mjs';
    const contents = await readFile(probeBundle, 'utf8');
    const workerdStart = Date.now();
    const mf = new Miniflare({
      workers: [{
        config: {
          name: WORKER_NAME,
          type: 'worker',
          compatibilityDate: '2026-09-10',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule, modules: { [mainModule]: { type: 'esm', contents } } },
        },
      }],
      inspectorPort: 0,
      telemetry: { enabled: false },
    });
    try {
      const worker = await mf.getWorker(WORKER_NAME);
      const health = await (await worker.fetch(`https://probe.example/probe/health`)).json();
      const readyMs = Date.now() - workerdStart;
      assert.equal(health.ok, true);
      assert.equal(health.appEntry, 'object', 'actual application entry module must be bundled');
      assert.equal(health.control, 'function', 'actual application control class must be bundled');

      // Heap usage via the exact named user Worker inspector target.
      const inspectorWs = await mf.getInspectorURL(WORKER_NAME);
      const targets = await (await fetch(`http://${inspectorWs.host}/json/list`)).json();
      const target = targets.find(t => new URL(t.webSocketDebuggerUrl).pathname === `/core:user:${WORKER_NAME}`);
      assert.ok(target, `named user worker inspector target not found: ${targets.map(t => t.title).join(', ')}`);
      const heapUsage = await new Promise((resolveHeap, rejectHeap) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' })));
        ws.addEventListener('message', e => { resolveHeap(JSON.parse(e.data).result); ws.close(); });
        ws.addEventListener('error', rejectHeap);
      });
      assert.equal(typeof heapUsage.usedSize, 'number');

      // Parity path 2: the full corpus through real workerd.
      const encodeStart = Date.now();
      const workerdEnc = await (await worker.fetch('https://probe.example/probe/encode', {
        method: 'POST', body: JSON.stringify({ records: cases.map(c => c.text), full: true }),
      })).json();
      const parityMs = Date.now() - encodeStart;
      assertParity(cases, reference.encodings, workerdEnc.encodings, 'workerd');

      // Memory-contract boundary through the real application validator.
      const validate = {};
      for (const id of ['maxAscii', 'oneOverAscii', 'maxBmp', 'oneOverBmp', 'maxAstral', 'oneOverAstral', 'maxMixed']) {
        const c = cases.find(x => x.id === id);
        const v = await (await worker.fetch('https://probe.example/probe/validate', {
          method: 'POST', body: JSON.stringify({ text: c.text }),
        })).json();
        validate[id] = v;
        assert.equal(v.valid, id.startsWith('max'), `schema validation boundary wrong for ${id}`);
        if (!id.startsWith('max')) {
          assert.equal(v.code, 'INVALID_INPUT', `over-limit ${id} must be rejected by the real schema`);
        }
      }
      const record = maxRecord();
      assert.equal(ucs2length(record.text), MEMORY_TEXT_MAX, 'max record ucs2length');
      assert.equal(utf16Length(record.text), 2 * MEMORY_TEXT_MAX, 'max record UTF-16 length');

      // Multi-record batches of maximum-size records.
      const batches = {};
      for (const size of BATCH_SIZES) {
        const batchStart = Date.now();
        const res = await (await worker.fetch('https://probe.example/probe/encode', {
          method: 'POST', body: JSON.stringify({ records: Array.from({ length: size }, () => record.text), full: false }),
        })).json();
        const batchMs = Date.now() - batchStart;
        assert.equal(res.counts.length, size);
        const expectedCount = reference.encodings[cases.findIndex(c => c.id === record.id)].length;
        for (const count of res.counts) assert.equal(count, expectedCount, 'batch token count mismatch');
        batches[size] = { records: size, ms: batchMs, tokensPerRecord: expectedCount };
      }

      const heapAfter = await new Promise((resolveHeap, rejectHeap) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 2, method: 'Runtime.getHeapUsage' })));
        ws.addEventListener('message', e => { resolveHeap(JSON.parse(e.data).result); ws.close(); });
        ws.addEventListener('error', rejectHeap);
      });
      evidence.workerd = {
        runtime: 'local workerd via installed Miniflare',
        bundleBytes,
        readyMs,
        appModule: 'src/worker/index.ts + src/core/control.ts bundled (not called)',
        parityCases: cases.length,
        parityMs,
        heapUsedBefore: heapUsage.usedSize,
        heapTotalBefore: heapUsage.totalSize,
        heapUsedAfter: heapAfter.usedSize,
        heapTotalAfter: heapAfter.totalSize,
        batches,
        schemaBoundary: validate,
      };
      console.log(`      ready ${readyMs}ms, parity ${cases.length} cases in ${parityMs}ms, bundle ${bundleBytes} bytes`);
      console.log(`      JS heap used/total before workload: ${heapUsage.usedSize}/${heapUsage.totalSize}, after: ${heapAfter.usedSize}/${heapAfter.totalSize}`);
      console.log(`      batches (max-size records): ${BATCH_SIZES.map(s => `${s} records in ${batches[s].ms}ms`).join(', ')}`);
    } finally {
      await mf.dispose();
    }

    // Phase 7: summary. Timings above are observations only, not thresholds.
    console.log('[7/7] summary');
    evidence.completedAt = new Date().toISOString();
    evidence.totalMs = Date.now() - started;
    evidence.result = 'pass';
    await writeFile(join(REPO, '.local', 'memory-tokenizer-harness.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ result: 'pass', cases: cases.length, totalMs: evidence.totalMs }, null, 2));
    console.log('limitations: JS heap is not isolate memory; wall-clock is not billed CPU; local workerd is not deployed acceptance; timings are observations, not thresholds; no total-memory-count bound is claimed.');
  } catch (error) {
    failures.push(String(error && error.stack || error));
    evidence.result = 'fail';
    evidence.failures = failures;
    try {
      await mkdir(join(REPO, '.local'), { recursive: true });
      await writeFile(join(REPO, '.local', 'memory-tokenizer-harness-failure.json'), JSON.stringify(evidence, null, 2) + '\n');
    } catch { /* evidence best-effort */ }
    retained = true;
    console.error(`FAIL: ${failures[0]}`);
    console.error(`disposable environment retained for inspection: ${root}`);
    process.exitCode = 1;
  } finally {
    if (!retained) await rm(root, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
