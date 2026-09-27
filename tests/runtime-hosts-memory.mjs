import assert from 'node:assert/strict';
import test from 'node:test';
import { loadHost, HOST_NAMES } from '../runtime/hosts/index.mjs';
import { createMemoryCounter, memoryTokenizerMap } from '../runtime/memory-read.mjs';

test('runtime hosts are a registry; unknown names fail closed', async () => {
  assert.ok(HOST_NAMES.includes('sprites') && HOST_NAMES.includes('local'));
  const local = await loadHost('local');
  assert.equal(typeof local.createService, 'function'); assert.equal(local.holdWake, undefined);
  await assert.rejects(loadHost('nope'), { code: 'UNKNOWN_RUNTIME_HOST' });
});
test('tokenizer map is config: add, remove, reject unknown encodings', async () => {
  const map = memoryTokenizerMap({ 'gpt-5.6-luna': 'o200k_base', 'gpt-5': null });
  assert.equal(map.get('gpt-5.6-luna'), 'o200k_base'); assert.equal(map.has('gpt-5'), false); assert.equal(map.has('gpt-5.5'), true);
  assert.throws(() => memoryTokenizerMap({ 'gpt-x': 'cl100k_base' }), { code: 'INVALID_MEMORY_TOKENIZERS' });
  const counter = createMemoryCounter(map);
  assert.equal(counter.supports('gpt-5.6-luna'), true);
  assert.throws(() => counter({ selected_model: 'gpt-5', global: '', scoped: '' }), { code: 'MEMORY_MODEL_UNSUPPORTED' });
});
