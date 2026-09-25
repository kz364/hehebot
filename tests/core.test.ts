import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, bot, otherBot, routine } from './helpers';
import type { Command, MemoryPut, RoomPut } from '../src/core/types';
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => f.close());
const message = (text = 'Synthetic read-only request'): Command => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
function room(member_ids = [bot, otherBot]) {
  const payload: RoomPut = { id: randomUUID(), expected_revision: 0, name: 'Synthetic room', member_ids, default_responder_id: bot };
  expect(f.accept({ schema_version: 1, type: 'room.put', payload }).status).toBe('applied');
  return payload;
}
function memory(scope: MemoryPut['scope'], text = 'Synthetic memory') {
  const event = randomUUID(); f.store.event(event, null, 'synthetic.source', 'owner', null, {}, f.core.now());
  const payload: MemoryPut = { id: randomUUID(), expected_revision: 0, scope, text, source_event_id: event, expires_at: null, sensitivity: 'ordinary' };
  expect(f.accept({ schema_version: 1, type: 'memory.put', payload }).status).toBe('applied');
  return payload;
}
describe('durable control transactions', () => {
  it('projects recent run metadata without hydrating snapshots for initial or incremental state',()=>{
    const ids=Array.from({length:101},(_,i)=>{
      f.setNow(new Date(Date.parse('2026-09-10T00:00:00.000Z')+i*1000).toISOString());
      return f.core.enqueue(bot,'Private instruction',null,null,null);
    });
    f.db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?),checkpoint_json=?,status='recovery_required' WHERE id=?",
      '界'.repeat(400000),JSON.stringify({private_checkpoint:'x'.repeat(1100000)}),ids[100]);
    const before=f.db.all('SELECT * FROM runs ORDER BY id');
    const expected=ids.slice(1).reverse().map(id=>{
      const {context_json,checkpoint_json,...metadata}=f.store.run(id);return metadata;
    });
    for(const after of [undefined,f.store.sequence()]){
      const read=vi.spyOn(f.db,'all');
      try{
        const state=f.core.state(after);
        const index=read.mock.calls.findIndex(([sql])=>sql.includes('FROM runs ORDER BY created_at DESC LIMIT 100'));
        expect(index).toBeGreaterThanOrEqual(0);
        expect(read.mock.results[index].value).toEqual(expected);
        expect(state.runs).toEqual(expected);
        expect(state.recovery).toMatchObject([{run_id:ids[100],attempt:0,can_recover:false}]);
        // This fixture disables execution: the other 100 runs remain waiting.
        expect(state.summary).toMatchObject({queued_runs:0,blocked_runs:101});
      }finally{read.mockRestore();}
    }
    expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);
  });
  it('creates an independent minimal role profile without copying source work, memory or authority',()=>{
    const run=f.accept(message()).resource_id!,r=routine();f.accept({schema_version:1,type:'routine.put',payload:r});memory({kind:'persona',id:bot},'Source-private preference');
    const tables=['runs','attempts','effects','resource_locks','lifecycle','schedule_state','skill_enablements','task_followups','runtime_metadata'],before=tables.map(table=>f.db.all(`SELECT * FROM ${table}`));
    const id=randomUUID(),key=randomUUID(),payload={id,expected_revision:0,name:'Independent copy',role:'Travel researcher',instructions:'Only public information.',tool_policy_ids:[],archived:false};
    const command:Command={schema_version:1,type:'persona.put',payload};const receipt=f.accept(command,key);expect(receipt.status).toBe('applied');expect(f.accept(command,key)).toEqual(receipt);
    expect(f.store.get(id).body).toMatchObject({role:'Travel researcher',tool_policy_ids:[]});
    expect(f.core.context(id,'Read',null,null).memories).toEqual([]);expect(f.core.context(id,'Read',null,null).skills).toEqual([]);
    expect(f.store.run(run).persona_id).toBe(bot);expect(tables.map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
    expect(f.accept({schema_version:1,type:'persona.put',payload:{...payload,id:randomUUID(),tool_policy_ids:[randomUUID()]}})).toMatchObject({status:'rejected',error:{code:'FORBIDDEN'}});
  });
  it('accepts blocked work visibly while runtime is unverified', () => {
    const receipt = f.accept(message()); expect(receipt.status).toBe('applied');
    expect(f.store.run(receipt.resource_id!)).toMatchObject({ status: 'waiting', error_code: 'CAPABILITY_UNAVAILABLE' });
    expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')[0]).toEqual({ desired_state: 'STOP', queue_sequence: 0 });
  });
  it('enabled synthetic execution queues work and invalidates a draining stop', () => {
    f.close(); f = fixture(true);
    f.db.exec("UPDATE lifecycle SET phase='DRAINING',stop_token='synthetic-stop'");
    const receipt = f.accept(message());
    expect(f.store.run(receipt.resource_id!).status).toBe('queued');
    expect(f.db.all('SELECT phase,desired_state,queue_sequence,stop_token FROM lifecycle')[0]).toEqual({ phase: 'READY', desired_state: 'RUN', queue_sequence: 1, stop_token: null });
  });
  it('same owner/key/body is one receipt and run; changed body conflicts', () => {
    const key = randomUUID(), first = f.accept(message(), key);
    expect(f.accept(message(), key)).toEqual(first);
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
    expect(() => f.accept(message('Different content'), key)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });
  it('rolls back events and work after semantic failure, retaining rejected receipt', () => {
    const r = room();
    const before = f.store.sequence();
    // Schema allows at least this fan-out; all three are valid members before action budget fails.
    const third = '33333333-3333-4333-8333-333333333333';
    f.accept({ schema_version: 1, type: 'room.put', payload: { ...r, expected_revision: 1, member_ids: [bot, otherBot, third] } });
    const count = f.store.sequence();
    const receipt = f.accept({ schema_version: 1, type: 'room.publish', payload: { room_id: r.id, kind: 'action_request', recipient_ids: [bot, otherBot, third], text: 'Synthetic action', references: [], cause_id: randomUUID() } });
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'INVALID_INPUT' } });
    expect(f.store.sequence()).toBe(count); expect(count).toBeGreaterThan(before);
    expect(f.db.all('SELECT * FROM consumer_cursors')).toHaveLength(0); expect(f.db.all('SELECT * FROM runs')).toHaveLength(0);
  });
  it('guards revisions and disallowed tool policies atomically', () => {
    const body = f.store.get(bot, 'persona').body;
    const update = { ...body, expected_revision: 1, instructions: 'Changed synthetic instruction' } as unknown as Extract<Command, { type: 'persona.put' }>['payload'];
    expect(f.accept({ schema_version: 1, type: 'persona.put', payload: update }).status).toBe('applied');
    expect(f.accept({ schema_version: 1, type: 'persona.put', payload: update })).toMatchObject({ status: 'rejected', error: { code: 'REVISION_CONFLICT' } });
    expect(f.accept({ schema_version: 1, type: 'persona.put', payload: { ...update, expected_revision: 2, tool_policy_ids: [randomUUID()] } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
    expect(f.store.get(bot).revision).toBe(2);
  });
  it('initial snapshot includes recent timeline events when history exceeds one page', () => {
    for (let i = 0; i < 105; i++) f.store.event(randomUUID(), bot, 'synthetic', 'owner', null, { i }, f.core.now());
    const snapshot = f.core.state();
    expect(snapshot.timeline!.at(-1)!.payload.i).toBe(104);
    expect(snapshot.timeline!.map(e => e.sequence)).toEqual([...snapshot.timeline!.map(e => e.sequence)].sort((a, b) => a - b));
  });
  it('returns pagination cursor at last delivered event, without dropping later events', () => {
    for (let i = 0; i < 5; i++) f.store.event(randomUUID(), bot, 'synthetic', 'owner', null, { i }, f.core.now());
    const first = f.core.state(0, 2);
    expect(first.events).toHaveLength(2); expect(first.next_cursor).toBe(String(first.events.at(-1)!.sequence));
    const second = f.core.state(Number(first.next_cursor), 2);
    expect(second.events.map(e => e.payload.i)).toEqual([2, 3]);
  });
});
describe('scoped context and data-only collaboration', () => {
  it('routine context includes only its own and authorized global/persona memories', () => {
    const r = routine(); expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
    const global = memory({ kind: 'global', id: null }); const own = memory({ kind: 'persona', id: bot });
    const scoped = memory({ kind: 'routine', id: r.id }); memory({ kind: 'persona', id: otherBot });
    expect(f.core.context(bot, 'Synthetic', r.id, null).memories.map(m => m.id).sort()).toEqual([global.id, own.id, scoped.id].sort());
    expect(f.core.context(bot, 'Synthetic', null, null).memories.map(m => m.id).sort()).toEqual([global.id, own.id].sort());
  });
  it('excludes sibling routine memory even when both routines belong to the same persona', () => {
    const a = routine(), b = routine();
    for (const r of [a, b]) expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
    const shared = memory({ kind: 'global', id: null }, 'Shared preference');
    const privateA = memory({ kind: 'routine', id: a.id }, 'Only routine A may retrieve this');
    const privateB = memory({ kind: 'routine', id: b.id }, 'Only routine B may retrieve this');
    const contextA = f.core.context(bot, 'Routine A', a.id, null);
    const contextB = f.core.context(bot, 'Routine B', b.id, null);
    expect(contextA.memories.map(m => m.id).sort()).toEqual([shared.id, privateA.id].sort());
    expect(contextB.memories.map(m => m.id).sort()).toEqual([shared.id, privateB.id].sort());
    expect(contextA.scope_key).not.toBe(contextB.scope_key);
  });
  it('context updates create no run or wake, and enter only recipient context', () => {
    const r = room(); const cause = randomUUID();
    const command: Command = { schema_version: 1, type: 'room.publish', payload: { room_id: r.id, kind: 'context_update', recipient_ids: [bot], text: 'Synthetic update', references: [], cause_id: cause } };
    expect(f.accept(command).status).toBe('applied');
    expect(f.db.all('SELECT * FROM runs')).toHaveLength(0);
    expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')[0]).toEqual({ desired_state: 'STOP', queue_sequence: 0 });
    expect(f.core.context(bot, 'Read', null, r.id).context_events).toHaveLength(1);
    expect(f.core.context(otherBot, 'Read', null, r.id).context_events).toHaveLength(0);
    expect(f.accept(command).resource_id).toBeDefined();
    expect(f.db.all("SELECT * FROM events WHERE type='room.context_update'")).toHaveLength(1);
  });
  it('paginates recipient context after filtering unrelated room events without waking work', () => {
    const r = room();
    const publish = (recipient: string, text: string) => {
      expect(f.accept({ schema_version: 1, type: 'room.publish', payload: {
        room_id: r.id, kind: 'context_update', recipient_ids: [recipient], text,
        references: [], cause_id: randomUUID(),
      } }).status).toBe('applied');
    };
    for (let i = 0; i < 100; i++) {
      publish(otherBot, `Other recipient ${i}`);
      f.store.event(randomUUID(), r.id, 'message.user', 'owner', null, { text: 'Not a context update' }, f.core.now());
    }
    for (let i = 0; i < 101; i++) publish(bot, `Required update ${i}`);
    const first = f.core.context(bot, 'Read', null, r.id).context_events;
    expect(first.map(e => e.payload.text)).toEqual(Array.from({ length: 100 }, (_, i) => `Required update ${i}`));
    f.db.exec('UPDATE consumer_cursors SET consumed_sequence=? WHERE consumer_id=? AND conversation_id=?', first.at(-1)!.sequence, bot, r.id);
    expect(f.core.context(bot, 'Read next', null, r.id).context_events.map(e => e.payload.text)).toEqual(['Required update 100']);
    expect(f.core.context(otherBot, 'Read', null, r.id).context_events.map(e => e.payload.text)).toEqual(Array.from({ length: 100 }, (_, i) => `Other recipient ${i}`));
    expect(f.db.all('SELECT * FROM runs')).toEqual([]);
    expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')).toEqual([{ desired_state: 'STOP', queue_sequence: 0 }]);
  });
  it('rejects nonmember recipients and private-memory cross-recipient sharing', () => {
    const r = room([bot]); const privateMemory = memory({ kind: 'persona', id: otherBot });
    const payload = { room_id: r.id, kind: 'context_update' as const, recipient_ids: [otherBot], text: 'Synthetic', references: [], cause_id: randomUUID() };
    expect(f.accept({ schema_version: 1, type: 'room.publish', payload })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
    expect(f.accept({ schema_version: 1, type: 'room.publish', payload: { ...payload, recipient_ids: [bot], references: [{ kind: 'memory', id: privateMemory.id, revision: 1 }] } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
  });
  it.each(['delete', 'revise', 'expire'])('rechecks room memory references after %s before including update text in new context', change => {
    const r = room(), m = memory({ kind: 'global', id: null }, 'Original private fact 43');
    if (change === 'expire') expect(f.accept({ schema_version: 1, type: 'memory.put', payload: {
      ...m, expected_revision: 1, expires_at: '2026-09-10T00:01:00.000Z',
    } }).status).toBe('applied');
    const revision = change === 'expire' ? 2 : 1;
    const publish = (text: string, references: { kind: 'memory'; id: string; revision: number }[]) => f.accept({ schema_version: 1, type: 'room.publish', payload: {
      room_id: r.id, kind: 'context_update', recipient_ids: [bot], text, references, cause_id: randomUUID(),
    } });
    expect(publish('Original private fact 43', [{ kind: 'memory', id: m.id, revision }]).status).toBe('applied');
    expect(publish('Independent update 71', []).status).toBe('applied');
    expect(f.core.context(bot, 'Before', null, r.id).context_events.map(e => e.payload.text)).toEqual(['Original private fact 43', 'Independent update 71']);
    if (change === 'delete') f.accept({ schema_version: 1, type: 'memory.delete', payload: { id: m.id, expected_revision: revision, purge_transcripts: false } });
    else if (change === 'revise') f.accept({ schema_version: 1, type: 'memory.put', payload: { ...m, expected_revision: revision, scope: { kind: 'persona', id: otherBot }, text: 'Other bot fact 103' } });
    else f.setNow('2026-09-10T00:01:00.000Z'); // Same revision, still physically present.
    const timeline = f.db.all("SELECT * FROM events WHERE type='room.context_update'");
    const context = f.core.context(bot, 'After', null, r.id);
    expect(context.context_events[0].payload).toMatchObject({ context_unavailable: true, references: [] });
    expect(JSON.stringify(context)).not.toContain('Original private fact 43');
    expect(JSON.stringify(context)).not.toContain('Other bot fact 103');
    expect(context.context_events[1].payload.text).toBe('Independent update 71');
    expect(f.db.all("SELECT * FROM events WHERE type='room.context_update'")).toEqual(timeline);
    expect(f.db.all('SELECT * FROM runs')).toEqual([]);
  });
  it('memory delete purges canonical revisions and invalidates captured run context', () => {
    const m = memory({ kind: 'global', id: null }, 'Synthetic secret to erase');
    const run = f.accept(message()).resource_id!;
    expect(f.accept({ schema_version: 1, type: 'memory.delete', payload: { id: m.id, expected_revision: 1, purge_transcripts: false } }).status).toBe('applied');
    expect(() => f.store.get(m.id)).toThrow();
    expect(f.store.run(run)).toMatchObject({ status: 'cancelled', error_code: 'CONTEXT_INVALIDATED' });
    expect(f.store.run(run).context_json).not.toContain(m.text);
    expect(f.db.all<{ payload_json: string }>("SELECT payload_json FROM commands WHERE type='memory.put'").every(r => !r.payload_json.includes(m.text))).toBe(true);
    expect(f.db.all<{ body_json: string }>('SELECT body_json FROM object_revisions WHERE object_id=?', m.id).every(r => !r.body_json.includes(m.text))).toBe(true);
  });
  it('finishing work is cancelled on memory deletion instead of silently retaining context', () => {
    const m = memory({ kind: 'global', id: null });
    const run = f.accept(message()).resource_id!;
    f.db.exec("UPDATE runs SET status='finishing' WHERE id=?", run);
    f.accept({ schema_version: 1, type: 'memory.delete', payload: { id: m.id, expected_revision: 1, purge_transcripts: false } });
    expect(f.store.run(run).status).toBe('cancelling');
    expect(f.store.run(run).context_json).not.toContain(m.text);
  });
  it('rejects a falsely labelled reference kind', () => {
    const r = room();
    const receipt = f.accept({ schema_version: 1, type: 'room.publish', payload: { room_id: r.id, kind: 'context_update', recipient_ids: [bot], text: 'Synthetic', references: [{ kind: 'memory', id: bot, revision: 1 }], cause_id: randomUUID() } });
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'INVALID_INPUT' } });
  });

});
