import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { bot, otherBot, fixture } from './helpers';
import { LifecycleCore } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { OutputPreviews } from '../src/core/output-preview';
import { EffectLedger } from '../src/core/effects';
import { ResourceLedger } from '../src/core/resources';
import type { Command, MemoryPut } from '../src/core/types';

type Fixture = ReturnType<typeof fixture>;
function remember(f: Fixture, text: string, sensitivity: MemoryPut['sensitivity'] = 'ordinary', persona = bot) {
  const source = randomUUID();
  f.store.event(source, persona, 'message.user', 'owner', null, { text }, f.core.now());
  const memory: MemoryPut = { id: randomUUID(), expected_revision: 0, scope: { kind: 'persona', id: persona },
    text, sensitivity, source_event_id: source, expires_at: null };
  expect(f.accept({ schema_version: 1, type: 'memory.put', payload: memory }).status).toBe('applied');
  return memory;
}
function enqueue(f: Fixture) {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic custody task' } }).resource_id!;
}
function deletion(memory: MemoryPut, revision: number, purge_transcripts: boolean): Command {
  return { schema_version: 1, type: 'memory.delete', payload: { id: memory.id, expected_revision: revision, purge_transcripts } };
}
function boot(f: Fixture) {
  const life = new LifecycleCore(f.store, f.core);
  // Synthetic provider boot precondition only; no provider or native process exists.
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity = life.registerBoot(randomUUID());
  life.ready(identity);
  return { life, identity };
}
function changes(f: Fixture) {
  return f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
}

it.each([false, true])('explicit delete with transcript request=%s erases both revisions, isolates siblings and replays without writes', purge => {
  const f = fixture(purge); // Exercise waiting and queued admission, not a status fixture write.
  try {
    const target = remember(f, 'Synthetic sensitive old-17', 'sensitive');
    const sibling = remember(f, 'Synthetic survivor-83');
    const revised = { ...target, expected_revision: 1, text: 'Synthetic sensitive revised-29' };
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: revised }).status).toBe('applied');
    const run = enqueue(f);
    f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?',JSON.stringify({padding:'x'.repeat(1100000)}),run);
    const beforeRun = f.store.run(run);
    expect(beforeRun.status).toBe(purge ? 'queued' : 'waiting');
    expect(JSON.parse(beforeRun.context_json).memories).toHaveLength(2);
    const originalPut = f.db.all<{ id: string; idempotency_key: ReturnType<typeof randomUUID> }>(
      "SELECT id,idempotency_key FROM commands WHERE type='memory.put' AND resource_id=? AND json_extract(payload_json,'$.expected_revision')=0", target.id)[0];
    const originalReceipt = f.core.receipt(originalPut.id);
    const siblingRows = f.db.all('SELECT * FROM object_revisions WHERE object_id=?', sibling.id);
    const siblingCommands = f.db.all('SELECT * FROM commands WHERE resource_id=?', sibling.id);
    const lifecycle = f.db.all('SELECT * FROM lifecycle');
    const command = deletion(target, 2, purge), key = randomUUID();
    f.setNow('2026-09-10T00:00:07.000Z');
    const read=vi.spyOn(f.db,'all');
    let receipt:ReturnType<typeof f.accept>;
    try{
      receipt=f.accept(command,key);
      const rows=read.mock.calls.flatMap(([sql],i)=>sql.includes("FROM runs WHERE status IN ('queued','claimed','running','finishing','waiting','cancelling','recovery_required','interrupted')")?read.mock.results[i].value:[]);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(['context_json','id','status','updated_at']);
    }finally{read.mockRestore();}
    expect(receipt).toMatchObject({ status: 'applied', resource_id: target.id });
    expect(f.db.all('SELECT body_json,revision,deleted_at FROM objects WHERE id=?', target.id)).toEqual([
      { body_json: '{}', revision: 3, deleted_at: f.core.now() },
    ]);
    expect(f.db.all('SELECT revision,body_json FROM object_revisions WHERE object_id=? ORDER BY revision', target.id)).toEqual([
      { revision: 1, body_json: '{}' }, { revision: 2, body_json: '{}' },
    ]);
    expect(f.db.all("SELECT payload_json FROM commands WHERE type='memory.put' AND resource_id=?", target.id)).toEqual([
      { payload_json: '{}' }, { payload_json: '{}' },
    ]);
    expect(f.db.all('SELECT * FROM object_revisions WHERE object_id=?', sibling.id)).toEqual(siblingRows);
    expect(f.db.all('SELECT * FROM commands WHERE resource_id=?', sibling.id)).toEqual(siblingCommands);
    expect(f.store.run(run)).toEqual({ ...beforeRun, status: 'cancelled', error_code: 'CONTEXT_INVALIDATED',
      updated_at: f.core.now(), context_json: JSON.stringify({ ...JSON.parse(beforeRun.context_json), memories: [f.store.get(sibling.id)] }) });
    expect(f.core.context(bot, 'Fresh task', null, null).memories.map(m => m.id)).toEqual([sibling.id]);
    expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle); // No new runnable work/wake request.
    const notices = f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='memory.deleted'");
    expect(notices.map(row => JSON.parse(row.payload_json))).toEqual([{ id: target.id,
      transcript_cleanup_requested: purge, transcript_cleanup_status: purge ? 'requires_runtime_verification' : 'not_requested' }]);
    // Provenance/source text is deliberately outside canonical-memory erasure.
    expect(f.db.all<{ payload_json: string }>('SELECT payload_json FROM events WHERE id=?', target.source_event_id)[0].payload_json).toContain(target.text);
    const written = changes(f);
    f.setNow('2026-09-10T00:00:23.000Z');
    expect(f.accept(command, key)).toEqual(receipt);
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: target }, originalPut.idempotency_key)).toEqual(originalReceipt);
    expect(changes(f)).toBe(written); // Includes even no-op UPDATEs, not merely identical final rows.
    expect(() => f.store.get(target.id)).toThrow(); // Old put receipt cannot resurrect scrubbed content.
  } finally { f.close(); }
});

it('two different deletes preserve exact cancellation grace, recovery custody, sibling output, effects and locks', () => {
  const f = fixture(true);
  try {
    const first = remember(f, 'Synthetic protected-41', 'sensitive');
    const second = remember(f, 'Synthetic later-delete-67');
    const survivor = remember(f, 'Synthetic retained-103');
    remember(f, 'Other persona only-211', 'ordinary', otherBot);
    f.core.options.delegations = { [bot]: [otherBot] };
    const { life, identity } = boot(f), root = enqueue(f);
    expect(life.claim(identity)!.run.id).toBe(root);
    life.submitted(identity, root, 1, 'native-root-41');
    const ledger = new NativeTaskLedger(f.store, f.core, life);
    const child = (native: string, persona = bot, started = true) => ledger.register(identity, {
      parent_run_id: root, parent_attempt: 1, persona_id: persona, native_run_ref: native,
      native_session_key: `session-${native}`, title: `Synthetic ${native}`,
    }, started).id;
    const uncertain = child('native-uncertain-59'), claimed = child('native-claimed-71', bot, false);
    const unrelated = child('native-sibling-97', otherBot);
    const effects = new EffectLedger(f.store, () => f.core.now());
    const locks = new ResourceLedger(f.store, () => f.core.now());
    for (const [run, resource] of [[root, 'browser:root-41'], [uncertain, 'browser:child-59'], [unrelated, 'browser:sibling-97']]) {
      locks.acquire(run, 1, [resource]);
      const effect = effects.intent({ id: randomUUID(), run_id: run, attempt: 1, action_key: `read-${run}`,
        classification: 'read_only', authorization_ref: 'synthetic-read', request_digest: `digest-${resource}`, provider_idempotency_key: null });
      effects.transition(effect.id, run, 'dispatched', null);
    }
    const previews = new OutputPreviews(f.store, () => f.core.now());
    for (const [run, native] of [[root, 'native-root-41'], [uncertain, 'native-uncertain-59'], [unrelated, 'native-sibling-97']]) {
      previews.record(identity, { run_id: run, attempt: 1, native_ref: native, version: 1, text: `Preview ${run}`, truncated: false }, life);
    }
    f.setNow('2026-09-10T00:00:01.000Z');
    f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: uncertain, reason: 'Synthetic unconfirmed cancellation' } });
    f.setNow('2026-09-10T00:00:31.000Z'); life.watchdog();
    expect(f.store.run(uncertain).status).toBe('interrupted');
    const priorSibling = f.store.run(unrelated), priorPreview = previews.read(unrelated, 1);
    const priorEffects = f.db.all('SELECT * FROM effects ORDER BY id'), priorLocks = f.db.all('SELECT * FROM resource_locks ORDER BY resource_id');
    const attempts = f.db.all('SELECT * FROM attempts ORDER BY run_id'), links = f.db.all('SELECT * FROM native_task_links ORDER BY run_id');
    const lifecycle = f.db.all('SELECT * FROM lifecycle');
    const contexts = [root, claimed, uncertain].map(id => JSON.parse(f.store.run(id).context_json));
    for (const [memory, at] of [[first, '2026-09-10T00:00:37.000Z'], [second, '2026-09-10T00:00:54.000Z']] as const) {
      f.setNow(at);
      expect(f.accept(deletion(memory, 1, true)).status).toBe('applied');
      for (const id of [root, claimed]) expect(f.store.run(id)).toMatchObject({ status: 'cancelling', error_code: 'CONTEXT_INVALIDATED', updated_at: '2026-09-10T00:00:37.000Z' });
      expect(f.store.run(uncertain)).toMatchObject({ status: 'interrupted', error_code: 'CONTEXT_INVALIDATED' });
      expect(f.db.all('SELECT * FROM effects ORDER BY id')).toEqual(priorEffects);
      expect(f.db.all('SELECT * FROM resource_locks ORDER BY resource_id')).toEqual(priorLocks);
    }
    for (const [index, id] of [root, claimed, uncertain].entries()) {
      expect(JSON.parse(f.store.run(id).context_json)).toEqual({ ...contexts[index], memories: [f.store.get(survivor.id)] });
    }
    expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'output-preview:*'")).toEqual([{ key: `output-preview:${unrelated}` }]);
    expect(previews.read(unrelated, 1)).toEqual(priorPreview);
    expect(f.store.run(unrelated)).toEqual(priorSibling);
    expect(f.db.all('SELECT * FROM attempts ORDER BY run_id')).toEqual(attempts);
    expect(f.db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
    expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
    expect(() => life.complete(identity, root, 1, { status: 'completed', text: first.text })).toThrowError(expect.objectContaining({ code: 'CONTEXT_INVALIDATED' }));
    expect(() => life.complete(identity, root, 1, { status: 'cancelled', text: '' })).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }));
    expect(() => previews.record(identity, { run_id: root, attempt: 1, native_ref: 'native-root-41', version: 2, text: first.text, truncated: false }, life)).toThrowError(expect.objectContaining({ code: 'OUTPUT_FENCED' }));
    f.setNow('2026-09-10T00:01:06.999Z'); life.watchdog();
    expect(f.store.run(root).status).toBe('cancelling'); expect(f.store.run(claimed).status).toBe('cancelling');
    f.setNow('2026-09-10T00:01:07.000Z'); life.watchdog();
    for (const id of [root, claimed, uncertain]) expect(f.store.run(id)).toMatchObject({ status: 'interrupted', error_code: 'CONTEXT_INVALIDATED' });
    expect(f.db.all('SELECT run_id,status FROM effects ORDER BY run_id')).toEqual([
      { run_id: root, status: 'outcome_unknown' }, { run_id: uncertain, status: 'outcome_unknown' }, { run_id: unrelated, status: 'dispatched' },
    ].sort((a, b) => a.run_id.localeCompare(b.run_id)));
    expect(f.store.run(unrelated)).toEqual(priorSibling);
    expect(f.db.all('SELECT * FROM attempts ORDER BY run_id')).toEqual(attempts);
    expect(f.db.all('SELECT * FROM resource_locks ORDER BY resource_id')).toEqual(priorLocks);
    expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
    expect(f.db.all('SELECT * FROM outbox')).toEqual([]);
    expect(() => life.prepareSleep(identity)).toThrow();
  } finally { f.close(); }
});

it('discloses retained terminal context, result, checkpoint, source and native-link copies rather than claiming forget everywhere', () => {
  const f = fixture(true);
  try {
    const memory = remember(f, 'Synthetic retained boundary-307', 'sensitive');
    const { life, identity } = boot(f), root = enqueue(f);
    expect(life.claim(identity)!.run.id).toBe(root); life.submitted(identity, root, 1, 'terminal-root-307');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: root,
      parent_attempt: 1, persona_id: bot, native_run_ref: 'terminal-child-401', native_session_key: 'terminal-session-409', title: 'Synthetic child' }, true);
    life.complete(identity, child.id, 1, { status: 'completed', text: memory.text });
    life.complete(identity, root, 1, { status: 'completed', text: memory.text, checkpoint: { synthetic_copy: memory.text } });
    const tables = ['runs', 'attempts', 'outbox', 'native_task_links'];
    const before = tables.map(table => f.db.all(`SELECT * FROM ${table}`));
    const events = f.db.all('SELECT * FROM events ORDER BY sequence');
    expect(f.accept(deletion(memory, 1, true)).status).toBe('applied');
    expect(tables.map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
    for (const id of [root, child.id]) expect(f.store.run(id).context_json).toContain(memory.text);
    expect(f.store.run(root).checkpoint_json).toContain(memory.text);
    expect(f.db.all('SELECT * FROM events ORDER BY sequence').slice(0, events.length)).toEqual(events);
    expect(f.core.context(bot, 'Fresh task', null, null).memories).toEqual([]);
    expect(f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='memory.deleted'").map(row => JSON.parse(row.payload_json).transcript_cleanup_status)).toEqual(['requires_runtime_verification']);
  } finally { f.close(); }
});
