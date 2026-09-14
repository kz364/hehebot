import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';

test('reopened journal instances serialize intent and updates in the same directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new FileJournal(directory);
  const reopened = new FileJournal(relative(process.cwd(), directory));
  const results = await Promise.all([
    first.putIfAbsent('intent', { owner: 'first' }),
    reopened.putIfAbsent('intent', { owner: 'second' }),
  ]);
  assert.deepEqual(results, [null, { owner: 'first' }]);
  await Promise.all([first.update('intent', { left: 19 }), reopened.update('intent', { right: 43 })]);
  assert.deepEqual(await reopened.get('intent'), { owner: 'first', left: 19, right: 43 });
});

test('failed work does not poison the directory queue or serialize unrelated directories', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new FileJournal(directory), reopened = new FileJournal(directory);
  const other = new FileJournal(join(directory, 'other'));
  await assert.rejects(first.update('missing', {}), /UNKNOWN_ATTEMPT/);
  let release;
  const held = first.serial(() => new Promise(resolve => { release = resolve; }));
  await new Promise(setImmediate);
  try {
    assert.equal(await other.putIfAbsent('independent', { value: 43 }), null);
  } finally { release(); }
  await held;
  assert.equal(await reopened.putIfAbsent('recovered', { value: 19 }), null);
});
