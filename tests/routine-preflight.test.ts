import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bot, fixture, otherBot, routine } from './helpers';

type Fixture = ReturnType<typeof fixture>;
type BlockerCode = 'CAPABILITY_UNAVAILABLE' | 'NOT_FOUND' | 'FORBIDDEN' | 'RESOURCE_BUSY';
type RoutinePreflight = {
  routine_id: string; routine_revision: number; persona_id: string; observed_at: string; enabled: boolean;
  schedule: { cron: string; timezone: string } | null; next_times: string[]; policy: ReturnType<typeof routine>['policy'];
  manual_run: { command_allowed: boolean; blockers: Array<{ code: BlockerCode; message: string }>; execution_enabled: boolean };
  limitations: string[];
};

let f: Fixture;
beforeEach(() => { f = fixture(true); });
afterEach(() => f.close());

function save(payload = routine()) {
  expect(f.accept({ schema_version: 1, type: 'routine.put', payload }).status).toBe('applied');
  return payload;
}

function preflight(id: string) {
  return (f.core as typeof f.core & { routinePreflight(id: string): RoutinePreflight }).routinePreflight(id);
}

function durableSnapshot() {
  const tables = f.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return tables.map(({ name }) => ({ name, rows: f.db.all(`SELECT * FROM "${name}" ORDER BY rowid`) }));
}

function commandCode(id: string, revision = 1) {
  return f.accept({ schema_version: 1, type: 'routine.run', payload: { id, expected_revision: revision } }).error?.code;
}

function expectBlocked(id: string, code: BlockerCode, revision = 1) {
  const result = preflight(id);
  expect(result.manual_run.command_allowed).toBe(false);
  expect(result.manual_run.blockers.map(blocker => blocker.code)).toContain(code);
  expect(result.manual_run.blockers.find(blocker => blocker.code === code)?.message).toEqual(expect.any(String));
  expect(commandCode(id, revision)).toBe(code);
}

describe('routine manual-run preflight', () => {
  it('returns the current routine contract and a three-time preview for a paused routine without admitting execution', () => {
    const r = save(routine({ enabled: false, schedule: { cron: '23 9 * * 1-5', timezone: 'Asia/Jakarta' } }));
    const before = durableSnapshot();
    const tick = vi.spyOn(f.core, 'tick');
    let generated = 0;
    f.core.options.uuid = () => { generated++; throw new Error('read generated a UUID'); };

    expect(preflight(r.id)).toEqual({
      routine_id: r.id,
      routine_revision: 1,
      persona_id: r.persona_id,
      observed_at: '2026-09-10T00:00:00.000Z',
      enabled: false,
      schedule: r.schedule,
      next_times: ['2026-09-10T02:23:00.000Z', '2026-09-11T02:23:00.000Z', '2026-09-14T02:23:00.000Z'],
      policy: r.policy,
      manual_run: { command_allowed: true, blockers: [], execution_enabled: true },
      limitations: expect.arrayContaining([expect.any(String)]),
    });
    expect(generated).toBe(0);
    expect(tick).not.toHaveBeenCalled();
    expect(durableSnapshot()).toEqual(before);
  });

  it('reports execution readiness independently and previews no times for a null schedule', () => {
    f.close(); f = fixture(false);
    const r = routine({ enabled: false, schedule: null });
    f.store.put(r.id, 'routine', r, 0, 'owner', f.core.now());
    const result = preflight(r.id);
    expect(result).toMatchObject({ schedule: null, next_times: [], manual_run: { command_allowed: true, blockers: [], execution_enabled: false } });
    expect(result.limitations).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(commandCode(r.id)).toBeUndefined();
  });

  it('returns the recorded revision and edited fields rather than the caller\'s original object', () => {
    const first = save(routine({ enabled: true }));
    const edited = { ...first, expected_revision: 1, enabled: false, name: 'Recorded edit', policy: { ...first.policy, overlap: 'skip' as const } };
    expect(f.accept({ schema_version: 1, type: 'routine.put', payload: edited }).status).toBe('applied');
    expect(preflight(first.id)).toMatchObject({ routine_revision: 2, enabled: false, policy: edited.policy });
    expect(commandCode(first.id, 2)).toBeUndefined();
  });

  it.each([
    ['archived', (personaId: string) => f.db.exec("UPDATE objects SET body_json=json_set(body_json,'$.archived',json('true')) WHERE id=?", personaId)],
    ['deleted', (personaId: string) => f.db.exec('UPDATE objects SET deleted_at=? WHERE id=?', f.core.now(), personaId)],
    ['missing', (_personaId: string) => f.db.exec("UPDATE objects SET body_json=json_set(body_json,'$.persona_id',?) WHERE id=?", randomUUID(), f.store.list('routine')[0].id)],
  ])('blocks a routine whose persona is %s with the command-equivalent capability code', (_case, mutate) => {
    const r = save(); mutate(r.persona_id);
    expectBlocked(r.id, _case==='archived'?'CAPABILITY_UNAVAILABLE':'NOT_FOUND');
  });

  it('reports revoked action policy and routine.run rejects the same code', () => {
    const policy = randomUUID(); f.core.options.actionPolicyIds.push(policy);
    const r = save(routine({ action_policy_ids: [policy] }));
    f.core.options.actionPolicyIds = [];
    expectBlocked(r.id, 'FORBIDDEN');
  });

  it('does not turn a successful observation into authorization after grants change', () => {
    const policy=randomUUID();f.core.options.actionPolicyIds.push(policy);
    const r=save(routine({action_policy_ids:[policy]}));
    expect(preflight(r.id).manual_run.command_allowed).toBe(true);
    f.core.options.actionPolicyIds=[];
    expect(commandCode(r.id)).toBe('FORBIDDEN');
    expect(f.db.all('SELECT id FROM runs WHERE routine_id=?',r.id)).toHaveLength(0);
  });

  it.each(['queued', 'waiting', 'claimed', 'running', 'finishing', 'cancelling', 'recovery_required'] as const)(
    'blocks exact-routine %s work as busy', status => {
      const r = save();
      const run = f.core.enqueue(r.persona_id, 'asymmetric active run', null, r.id, null);
      f.db.exec('UPDATE runs SET status=? WHERE id=?', status, run);
      expectBlocked(r.id, 'RESOURCE_BUSY');
    },
  );

  it.each(['completed', 'failed', 'cancelled'] as const)('does not block for terminal %s work or a nonterminal sibling', status => {
    const target = save(), sibling = save(routine({ persona_id: otherBot }));
    const old = f.core.enqueue(target.persona_id, 'terminal target', null, target.id, null);
    f.db.exec('UPDATE runs SET status=? WHERE id=?', status, old);
    const unrelated = f.core.enqueue(sibling.persona_id, 'busy sibling', null, sibling.id, null);
    f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", unrelated);
    expect(preflight(target.id).manual_run).toMatchObject({ command_allowed: true, blockers: [] });
  });

  it('does not create request-side effects, while the later accepted command creates exactly one run', () => {
    const r = save();
    const before = durableSnapshot();
    expect(preflight(r.id).manual_run.command_allowed).toBe(true);
    expect(preflight(r.id).manual_run.command_allowed).toBe(true);
    expect(durableSnapshot()).toEqual(before);
    expect(f.accept({ schema_version: 1, type: 'routine.run', payload: { id: r.id, expected_revision: 1 } }).status).toBe('applied');
    expect(f.db.all('SELECT id FROM runs WHERE routine_id=?', r.id)).toHaveLength(1);
  });

  it('throws for missing, deleted, and non-routine identifiers', () => {
    expect(() => preflight(randomUUID())).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    const deleted = save();
    expect(f.accept({ schema_version: 1, type: 'routine.delete', payload: { id: deleted.id, expected_revision: 1 } }).status).toBe('applied');
    expect(() => preflight(deleted.id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => preflight(bot)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
