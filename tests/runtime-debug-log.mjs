import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDebugLog } from '../runtime/debug-log.mjs';

const tmp = async () => mkdtemp(join(tmpdir(), 'hehebot-debug-log-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('disabled logger is a no-op: writes nothing and never creates the logs directory', async () => {
  const stateDirectory = await tmp();
  try {
    const log = createDebugLog({ enabled: false, stateDirectory });
    assert.equal(log.enabled, false);
    log.log('control', 'rpc', { type: 'heartbeat' });
    await log.rotate();
    await wait(20);
    await assert.rejects(readdir(join(stateDirectory, 'logs')));
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});

test('enabled logger writes one JSON line per call to a per-day file', async () => {
  const stateDirectory = await tmp();
  try {
    const now = () => Date.parse('2026-09-28T03:00:00.000Z');
    const log = createDebugLog({ enabled: true, stateDirectory, now });
    log.log('control', 'rpc', { type: 'heartbeat', ms: 12, outcome: 'ok' });
    log.log('lifecycle', 'boot', { boot_id: 'x' });
    await wait(50);
    const path = join(stateDirectory, 'logs', 'debug-2026-09-28.jsonl');
    const lines = (await readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].component, 'control'); assert.equal(lines[0].event, 'rpc');
    assert.deepEqual(lines[0].details, { type: 'heartbeat', ms: 12, outcome: 'ok' });
    assert.equal(lines[0].ts, '2026-09-28T03:00:00.000Z');
    const info = await stat(path);
    assert.equal((info.mode & 0o777), 0o600);
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});

test('scrubs keys that look like secrets, tokens or message content, one level deep', async () => {
  const stateDirectory = await tmp();
  try {
    const log = createDebugLog({ enabled: true, stateDirectory, now: () => Date.parse('2026-09-28T00:00:00.000Z') });
    log.log('control', 'rpc', { type: 'complete', token: 'sekret', access_token: 'sekret2', password: 'p', text: 'hello world',
      message: 'hi', body: { text: 'nested' }, payload: { a: 1 }, run_id: 'abc', ms: 5 });
    await wait(50);
    const raw = await readFile(join(stateDirectory, 'logs', 'debug-2026-09-28.jsonl'), 'utf8');
    assert.ok(!raw.includes('sekret'));
    assert.ok(!raw.includes('hello world'));
    assert.ok(!raw.includes('"hi"'));
    const line = JSON.parse(raw.trim());
    assert.deepEqual(line.details, { type: 'complete', run_id: 'abc', ms: 5 });
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});

test('caps a single day file and drops further lines rather than growing unbounded', async () => {
  const stateDirectory = await tmp();
  try {
    const now = () => Date.parse('2026-09-28T00:00:00.000Z');
    const log = createDebugLog({ enabled: true, stateDirectory, now, maxFileBytes: 100 });
    for (let i = 0; i < 20; i++) log.log('control', 'rpc', { type: 'heartbeat', i, padding: 'x'.repeat(20) });
    await wait(80);
    const raw = await readFile(join(stateDirectory, 'logs', 'debug-2026-09-28.jsonl'), 'utf8');
    assert.ok(Buffer.byteLength(raw) < 400); // far less than the unbounded 20-line total
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});

test('rotate() removes files older than the retention window and keeps recent ones', async () => {
  const stateDirectory = await tmp();
  try {
    const logsDir = join(stateDirectory, 'logs');
    const log = createDebugLog({ enabled: true, stateDirectory, now: () => Date.parse('2026-09-28T00:00:00.000Z'), retainDays: 7 });
    log.log('control', 'rpc', {}); // ensures the directory exists
    await wait(30);
    await writeFile(join(logsDir, 'debug-2026-09-01.jsonl'), '{}\n'); // 27 days old, out of the 7-day window
    await writeFile(join(logsDir, 'debug-2026-09-25.jsonl'), '{}\n'); // 3 days old, kept
    await log.rotate();
    const names = await readdir(logsDir);
    assert.ok(!names.includes('debug-2026-09-01.jsonl'));
    assert.ok(names.includes('debug-2026-09-25.jsonl'));
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
