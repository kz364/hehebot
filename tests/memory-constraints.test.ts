import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { fixture, bot, otherBot } from './helpers';
import { LifecycleCore } from '../src/core/lifecycle';
import { AgentCommandBoundary } from '../src/core/agent-commands';

function memory(f: ReturnType<typeof fixture>, overrides = {}) {
  const source = randomUUID();
  f.store.event(source, bot, 'message.user', 'owner', null, { text: 'Synthetic owner source' }, f.core.now());
  return { id: randomUUID(), expected_revision: 0, scope: { kind: 'persona' as const, id: bot },
    text: 'Do not send messages without approval.', source_event_id: source, expires_at: null,
    sensitivity: 'ordinary' as const, ...overrides };
}

it('preserves an explicit constraint through legacy edits; only a current explicit false clears it', () => {
  const f = fixture();
  try {
    const original = memory(f, { explicit_constraint: true });
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: original }).status).toBe('applied');
    const legacy = memory(f); // Existing clients send only the pre-extension fields.
    const edit = { ...legacy, id: original.id, expected_revision: 1, text: 'Require approval for every external message.' };
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: edit }).status).toBe('applied');
    expect(f.store.get(original.id).body).toMatchObject({ text: edit.text, explicit_constraint: true });
    expect(edit).not.toHaveProperty('explicit_constraint'); // Do not mutate command receipt custody.
    const clear = { ...edit, explicit_constraint: false };
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: clear })).toMatchObject({ status: 'rejected', error: { code: 'REVISION_CONFLICT' } });
    expect(f.store.get(original.id).body.explicit_constraint).toBe(true);
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: { ...clear, expected_revision: 2 } }).status).toBe('applied');
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: { ...edit, expected_revision: 3 } }).status).toBe('applied');
    expect(f.store.get(original.id).body.explicit_constraint).toBe(false);
    const revisions = f.db.all<{ body_json: string }>('SELECT body_json FROM object_revisions WHERE object_id=? ORDER BY revision', original.id);
    expect(revisions.map(row => JSON.parse(row.body_json).explicit_constraint)).toEqual([true, true, false, false]);
    expect(f.db.all('SELECT * FROM runs')).toEqual([]);
    expect(f.db.all('SELECT phase,queue_sequence FROM lifecycle')).toEqual([{ phase: 'STOPPED', queue_sequence: 0 }]);
  } finally { f.close(); }
});

it('keeps legacy shape and rejects nonboolean declarations without creating memory', () => {
  const f = fixture();
  try {
    const original = memory(f);
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: original }).status).toBe('applied');
    expect(f.store.get(original.id).body).not.toHaveProperty('explicit_constraint');
    for (const value of ['true', 1, null, { owner: true }]) {
      const payload = memory(f, { explicit_constraint: value });
      expect(() => f.accept({ schema_version: 1, type: 'memory.put', payload })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(() => f.store.get(payload.id)).toThrow();
    }
  } finally { f.close(); }
});

it('rebuilds current constraint revisions at claim without widening scope, expiry or tool authority', () => {
  const f = fixture(true);
  try {
    const own = memory(f, { explicit_constraint: true });
    const foreign = memory(f, { explicit_constraint: true, scope: { kind: 'persona', id: otherBot } });
    const expired = memory(f, { explicit_constraint: true, expires_at: '2026-09-10T00:00:01.000Z' });
    for (const payload of [own, foreign, expired]) expect(f.accept({ schema_version: 1, type: 'memory.put', payload }).status).toBe('applied');
    const run = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic request' } }).resource_id!;
    const queued = JSON.parse(f.store.run(run).context_json);
    expect(queued.memories.map((m: {id: string}) => m.id).sort()).toEqual([own.id, expired.id].sort());
    const changed = { ...own, expected_revision: 1, text: 'Never submit forms without approval.' };
    expect(f.accept({ schema_version: 1, type: 'memory.put', payload: changed }).status).toBe('applied');
    f.setNow('2026-09-10T00:00:01.000Z');
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
    const life = new LifecycleCore(f.store, f.core), identity = life.registerBoot(randomUUID()); life.ready(identity);
    const context = JSON.parse(life.claim(identity, { [bot]: 'gpt-5.6-luna' })!.run.context_json);
    expect(context.selected_model).toBe('gpt-5.6-luna');
    expect(context.memories).toEqual([expect.objectContaining({ id: own.id, revision: 2, body: expect.objectContaining({ text: changed.text, explicit_constraint: true }) })]);
    expect(context.authorization_policy_ids).toEqual([]);
    expect(context.persona.body.tool_policy_ids).toEqual([]);
    expect(() => new AgentCommandBoundary(f.core, life).accept({ identity, run_id: run, attempt: 1,
      idempotency_key: randomUUID(), command: { schema_version: 1, type: 'memory.put', payload: { ...changed, expected_revision: 2, explicit_constraint: false } } as never,
    })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(f.store.get(own.id).body.explicit_constraint).toBe(true);
    expect(f.accept({ schema_version: 1, type: 'memory.delete', payload: { id: own.id, expected_revision: 2, purge_transcripts: false } }).status).toBe('applied');
    expect(f.core.context(bot, 'Next task', null, null).memories).toEqual([]);
    expect(f.store.run(run).status).toBe('cancelling');
  } finally { f.close(); }
});
