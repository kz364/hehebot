import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { bot, otherBot, fixture } from './helpers';
import type { MemoryPut } from '../src/core/types';
import { LifecycleCore } from '../src/core/lifecycle';

function memory(f: ReturnType<typeof fixture>, expires_at: string | null) {
  const source = randomUUID();
  f.store.event(source, bot, 'message.user', 'owner', null, { text: 'Synthetic source' }, f.core.now());
  const payload: MemoryPut = { id: randomUUID(), expected_revision: 0, scope: { kind: 'persona', id: bot },
    text: 'Expiry-only private memory', source_event_id: source, expires_at, sensitivity: 'ordinary' };
  expect(f.accept({ schema_version: 1, type: 'memory.put', payload }).status).toBe('applied');
  return payload;
}
const enqueue = (f: ReturnType<typeof fixture>, persona = bot) => f.accept({ schema_version: 1, type: 'message.send',
  payload: { conversation_id: persona, text: 'Use admitted context' } }).resource_id!;

it('compares expiry instants rather than lexical dates with timezone offsets', () => {
  const f = fixture();
  try {
    const future = memory(f, '2026-09-09T21:00:00-04:00'); // 01:00Z, one hour ahead.
    expect(f.core.context(bot, 'test', null, null).memories.map(m => m.id)).toEqual([future.id]);
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: {
      ...future, id: randomUUID(), expires_at: '2026-09-10T08:30:00+09:00',
    } })).toMatchObject({ status: 'rejected', error: { code: 'INVALID_INPUT' } }); // 23:30Z, already expired.
    f.setNow('2026-09-10T01:00:00.000Z');
    expect(f.core.context(bot, 'test', null, null).memories).toEqual([]);
    expect(f.core.expireMemories()).toBe(1);
  } finally { f.close(); }
});

it('purges exactly at expiry while preserving future/unbounded memory and issuing no work', () => {
  const f = fixture();
  try {
    const due = memory(f, '2026-09-10T00:00:00.001Z');
    const later = memory(f, '2026-09-10T00:00:00.002Z'), permanent = memory(f, null);
    expect(f.core.expireMemories()).toBe(0);
    expect(f.core.nextMemoryExpiry()).toBe(due.expires_at);
    f.setNow('2026-09-10T00:00:00.001Z');
    expect(f.core.expireMemories()).toBe(1); expect(f.core.expireMemories()).toBe(0);
    expect(f.core.nextMemoryExpiry()).toBe(later.expires_at);
    expect(f.store.list('memory').map(m => m.id).sort()).toEqual([later.id, permanent.id].sort());
    expect(f.db.all('SELECT body_json,revision FROM objects WHERE id=?', due.id)).toEqual([{ body_json: '{}', revision: 2 }]);
    expect(f.db.all('SELECT body_json FROM object_revisions WHERE object_id=?', due.id)).toEqual([{ body_json: '{}' }]);
    expect(f.db.all("SELECT payload_json FROM commands WHERE type='memory.put' AND resource_id=?", due.id)).toEqual([{ payload_json: '{}' }]);
    expect(f.db.all('SELECT * FROM runs')).toEqual([]);
    expect(f.db.all('SELECT phase,desired_state,queue_sequence FROM lifecycle')).toEqual([{ phase: 'STOPPED', desired_state: 'STOP', queue_sequence: 0 }]);
  } finally { f.close(); }
});

it('invalidates captured context without settling running or uncertain work and its locks/effects', () => {
  const f = fixture(true);
  try {
    const due = memory(f, '2026-09-10T00:01:00.000Z');
    const running = enqueue(f), uncertain = enqueue(f), unrelated = enqueue(f, otherBot);
    f.db.exec("UPDATE runs SET status='running' WHERE id=?", running);
    f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", uncertain);
    f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)', 'calendar-43', uncertain, f.core.now());
    f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','outcome_unknown','policy','digest',?)", randomUUID(), uncertain, 'action-71', f.core.now());
    const prior = f.store.run(unrelated), effects = f.db.all('SELECT * FROM effects'), locks = f.db.all('SELECT * FROM resource_locks');
    f.setNow(due.expires_at!); expect(f.core.expireMemories()).toBe(1);
    expect(f.store.run(running).status).toBe('cancelling');
    expect(f.store.run(uncertain)).toMatchObject({ status: 'recovery_required', error_code: 'CONTEXT_INVALIDATED' });
    expect(f.store.run(uncertain).context_json).not.toContain(due.text);
    expect(f.store.run(unrelated)).toEqual(prior);
    expect(f.db.all('SELECT * FROM effects')).toEqual(effects); expect(f.db.all('SELECT * FROM resource_locks')).toEqual(locks);
  } finally { f.close(); }
});

it.each(['expiry', 'delete'])('later memory %s purges context without extending cancellation grace', method => {
  const f = fixture(true);
  try {
    const first = memory(f, '2026-09-10T00:00:10.000Z');
    const second = memory(f, '2026-09-10T00:00:25.000Z');
    const life = new LifecycleCore(f.store, f.core);
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    const runId = enqueue(f), claim = life.claim(identity)!;
    expect(claim.run.id).toBe(runId); life.submitted(identity, runId, 1, 'native');
    f.setNow(first.expires_at!); expect(f.core.expireMemories()).toBe(1);
    expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', updated_at: first.expires_at });
    f.setNow(second.expires_at!);
    if (method === 'expiry') expect(f.core.expireMemories()).toBe(1);
    else expect(f.accept({ schema_version: 1, type: 'memory.delete', payload: {
      id: second.id, expected_revision: 1, purge_transcripts: false,
    } }).status).toBe('applied');
    expect(JSON.parse(f.store.run(runId).context_json).memories).toEqual([]);
    expect(f.store.run(runId).updated_at).toBe(first.expires_at);
    expect(f.store.list('memory')).toEqual([]);
    f.setNow('2026-09-10T00:00:39.999Z'); life.watchdog(); expect(f.store.run(runId).status).toBe('cancelling');
    f.setNow('2026-09-10T00:00:40.000Z'); life.watchdog();
    expect(f.store.run(runId)).toMatchObject({ status: 'interrupted', error_code: 'CONTEXT_INVALIDATED' });
    expect(f.db.all('SELECT status FROM attempts WHERE run_id=?', runId)).toEqual([{ status: 'running' }]);
    expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  } finally { f.close(); }
});

it('bounds each expiry transaction and leaves remaining due memory discoverable', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 101; i++) memory(f, '2026-09-10T00:01:00.000Z');
    f.setNow('2026-09-10T00:01:00.000Z');
    expect(f.core.expireMemories()).toBe(100);
    expect(f.core.nextMemoryExpiry()).toBe(f.core.now());
    expect(f.core.expireMemories()).toBe(1); expect(f.core.nextMemoryExpiry()).toBeNull();
    expect(f.core.expireMemories()).toBe(0);
  } finally { f.close(); }
});
