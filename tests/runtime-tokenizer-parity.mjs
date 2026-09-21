import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, ucs2length, utf16Length, buildCorpus, discriminatorPairs,
  maxRecord, BATCH_SIZES, assertParity, corruptExpectation,
} from '../scripts/test-memory-tokenizer.mjs';

// These tests exercise the harness's own logic offline: corpus determinism,
// contract-boundary accounting, and negative-control sensitivity. They do not
// install packages, download ranks, or start workerd; the full credential-free
// harness run is `node scripts/test-memory-tokenizer.mjs`.

test('importing the harness has no side effects and exports pure helpers', () => {
  assert.equal(typeof buildCorpus, 'function');
  assert.equal(typeof assertParity, 'function');
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
    'maxAscii', 'oneOverAscii', 'maxBmp', 'oneOverBmp', 'maxAstral', 'oneOverAstral', 'maxMixed',
  ];
  for (const id of mustExist) assert.ok(byId.has(id), `missing corpus case ${id}`);
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
  // One-over cases exceed the contract limit in code points.
  for (const id of ['oneOverAscii', 'oneOverBmp', 'oneOverAstral']) {
    assert.equal(ucs2length(byId.get(id)), max + 1, `${id} must be exactly one over`);
  }
  // The batch record is a legal maximum-size record.
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
