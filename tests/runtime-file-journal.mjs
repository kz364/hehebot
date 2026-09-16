import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';

for (const operation of ['putIfAbsent', 'update']) test(`${operation} takes custody before waiting in the directory queue`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-custody-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory);
  if (operation === 'update') await journal.putIfAbsent('intent', { unchanged: 71, remove: 'old', ['__proto__']: 'old data key', nested: { revision: 1 } });
  let release;
  const held = journal.serial(() => new Promise(resolve => { release = resolve; }));
  await new Promise(setImmediate);
  const input = { nested: { revision: 19, values: ['original'] }, remove: undefined, ['__proto__']: undefined };
  const pending = journal[operation]('intent', input);
  input.nested.revision = 43; input.nested.values.push('late'); input.remove = 'restored';
  release(); await held;
  const returned = await pending;
  const expected = { ...(operation === 'update' ? { unchanged: 71 } : {}), nested: { revision: 19, values: ['original'] } };
  assert.deepEqual(await journal.get('intent'), expected);
  assert.deepEqual(returned, operation === 'update' ? expected : null);
});

test('direct write returns the persisted wire value, not the caller reference changed during disk I/O', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-custody-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), input = { nested: { revision: 19 }, absent: undefined };
  const pending = journal.write('intent', input);
  input.nested.revision = 43;
  const returned = await pending;
  assert.deepEqual(returned, { nested: { revision: 19 } });
  assert.deepEqual(await journal.get('intent'), returned);
  returned.nested.revision = 83;
  assert.deepEqual(await journal.get('intent'), { nested: { revision: 19 } });
});

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
  await first.update('intent', { left: undefined, nested: { absent: null } });
  assert.deepEqual(await reopened.get('intent'), { owner: 'first', right: 43, nested: { absent: null } });
});

for (const body of ['null', 'false', '0', '"PRIVATE_SCALAR"', '[]', '{"PRIVATE_BROKEN":']) test(`non-object or malformed stored JSON cannot become a missing intent: ${body[0]}`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), path = join(directory, 'intent.json');
  await writeFile(path, body, { mode: 0o600 }); const before = await stat(path);
  for (const operation of [() => journal.get('intent'), () => journal.putIfAbsent('intent', { replacement: 43 }), () => journal.update('intent', { replacement: 43 })]) {
    await assert.rejects(operation(), { message: 'INVALID_JOURNAL_RECORD', code: 'INVALID_JOURNAL_RECORD' });
    assert.equal(await readFile(path, 'utf8'), body); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(directory), ['intent.json']);
  }
  assert.equal(await journal.get('missing'), null);
  assert.equal(await journal.putIfAbsent('valid', { nested: [null, false, 0] }), null);
  assert.deepEqual(await journal.get('valid'), { nested: [null, false, 0] });
});

test('invalid writes and patches reject before creating artifacts or replacing a valid row', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), cyclic = {}; cyclic.self = cyclic;
  await journal.putIfAbsent('intent', { original: 19 });
  for (const value of [null, false, 0, [], undefined, cyclic, { toJSON: () => null }]) {
    await assert.rejects(journal.write('intent', value), { code: 'INVALID_JOURNAL_RECORD' });
    await assert.rejects(journal.putIfAbsent('new', value), { code: 'INVALID_JOURNAL_RECORD' });
    await assert.rejects(journal.update('intent', value), { code: 'INVALID_JOURNAL_RECORD' });
    assert.deepEqual(await journal.get('intent'), { original: 19 });
    assert.deepEqual(await readdir(directory), ['intent.json']);
  }
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
