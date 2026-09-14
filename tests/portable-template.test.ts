import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportTemplate, planTemplate } from '../scripts/portable-template.mjs';
import type { Command, PersonaPut, RoutinePut, SkillBody } from '../src/core/types';
import { bot, fixture, routine } from './helpers';

const skill: SkillBody = { name: 'Compare asymmetric inputs', description: 'Compare supplied values.', when_to_use: 'For a reviewed comparison',
  inputs_access: ['Selected input'], steps: ['Compare 19 to 43'], decision_rules: [], validation: ['Keep the values distinct'],
  output: 'Comparison', failure_handling: ['Report ambiguity'], approval_boundaries: ['Never submit externally'], contains_private_facts: false };
function source() {
  const f = fixture();
  const toolPolicy = randomUUID(), actionPolicy = randomUUID();
  f.core.options.toolPolicyIds.push(toolPolicy); f.core.options.actionPolicyIds.push(actionPolicy);
  const persona = f.store.get<PersonaPut>(bot);
  expect(f.accept({ schema_version: 1, type: 'persona.put', payload: {
    ...persona.body, expected_revision: persona.revision, tool_policy_ids: [toolPolicy],
  } }).status).toBe('applied');
  const scheduled = routine({ schedule: { cron: '4 9 * * 1', timezone: 'Asia/Jakarta' }, instructions: 'Compare 19 to 43.',
    action_policy_ids: [actionPolicy] });
  expect(f.accept({ schema_version: 1, type: 'routine.put', payload: scheduled }).status).toBe('applied');
  const skillId = randomUUID(), proposalId = randomUUID();
  f.accept({ schema_version: 1, type: 'skill.propose', payload: { skill_id: skillId, proposal_id: proposalId, expected_skill_revision: 0,
    body: skill, provenance: { kind: 'owner', source_ref: 'test' }, executable_files_changed: false } });
  f.accept({ schema_version: 1, type: 'skill.review', payload: { proposal_id: proposalId, expected_proposal_revision: 1, decision: 'approve' } });
  return { f, scheduled, skillId, selected: [scheduled.id, skillId, bot] };
}

it('round-trips selected meaning into a clean SQLite control without schedules, grants, history or automatic skill approval', () => {
  const { f, scheduled, skillId, selected } = source(), target = fixture();
  try {
    const state = f.core.state();
    const bundle = exportTemplate({ ...state, credentials: 'SECRET_CANARY', events: [{ text: 'HISTORY_CANARY' }] }, selected);
    expect(JSON.stringify(bundle)).not.toMatch(/SECRET_CANARY|HISTORY_CANARY/);
    const namespace = randomUUID(), plan = planTemplate(bundle, namespace);
    expect(planTemplate(JSON.parse(JSON.stringify(bundle)), namespace)).toEqual(plan);
    expect(planTemplate(bundle, randomUUID()).commands[0].command.payload.id).not.toBe(plan.commands[0].command.payload.id);
    expect(plan.commands[0].command.type).toBe('persona.put');
    for (const entry of plan.commands) {
      const receipt = target.accept(entry.command as Command, entry.idempotency_key);
      expect(receipt.status).toBe('applied');
      expect(target.accept(entry.command as Command, entry.idempotency_key)).toEqual(receipt);
    }
    const importedPersona = plan.commands.find((entry: { command: Command }) => entry.command.type === 'persona.put')!.command.payload.id;
    const importedRoutine = target.store.list<RoutinePut>('routine')[0];
    expect(importedRoutine.body).toEqual({ ...scheduled, id: importedRoutine.id, persona_id: importedPersona,
      expected_revision: 0, enabled: false, action_policy_ids: [] });
    expect(importedPersona).not.toBe(bot); expect(importedRoutine.id).not.toBe(scheduled.id);
    expect(target.store.get<PersonaPut>(importedPersona).body.tool_policy_ids).toEqual([]);
    expect(target.core.state().skill_proposals).toHaveLength(1);
    expect(target.core.state().skill_proposals![0]).toMatchObject({ body: skill, status: 'pending', expected_skill_revision: 0 });
    expect(target.store.list('skill')).toEqual([]);
    expect(target.db.all('SELECT * FROM skill_enablements')).toEqual([]);
    expect(target.db.all('SELECT * FROM runs')).toEqual([]);
    expect(target.db.all('SELECT * FROM schedule_state')).toEqual([]);
    expect(f.store.get<RoutinePut>(scheduled.id).body.enabled).toBe(true);
    expect(f.store.get(skillId).revision).toBe(1);
  } finally { f.close(); target.close(); }
});

it('rejects unknown semantics and forged authority even when an attacker recomputes the checksum', () => {
  const { f, selected } = source();
  try {
    const bundle = exportTemplate(f.core.state(), selected), namespace = randomUUID();
    const reseal = (value: typeof bundle) => { const { sha256: _hash, ...content } = value; value.sha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex'); return value; };
    for (const mutate of [
      (value: typeof bundle) => { value.commands.find((command: Command) => command.type === 'routine.put')!.payload.enabled = true; },
      (value: typeof bundle) => { value.commands.find((command: Command) => command.type === 'routine.put')!.payload.action_policy_ids = [randomUUID()]; },
      (value: typeof bundle) => { value.commands.find((command: Command) => command.type === 'persona.put')!.payload.tool_policy_ids = [randomUUID()]; },
      (value: typeof bundle) => { value.commands.find((command: Command) => command.type === 'skill.propose')!.payload.executable_files_changed = true; },
      (value: typeof bundle) => { value.commands.push(value.commands[0]); },
      (value: typeof bundle) => { value.commands = value.commands.filter((command: Command) => command.type !== 'persona.put'); },
    ]) {
      const changed = structuredClone(bundle); mutate(changed);
      expect(() => planTemplate(reseal(changed), namespace)).toThrow('INVALID_TEMPLATE');
    }
    expect(() => planTemplate({ ...bundle, schema_version: 2 }, namespace)).toThrow('INVALID_TEMPLATE');
    expect(() => planTemplate({ ...bundle, files: [{ path: '../../escape' }] }, namespace)).toThrow('INVALID_TEMPLATE');
    const changed = structuredClone(bundle); changed.commands[0].payload.name = 'Changed';
    expect(() => planTemplate(changed, namespace)).toThrow('INVALID_TEMPLATE');
    expect(() => exportTemplate(f.core.state(), [selected[0]])).toThrow('INVALID_TEMPLATE');
  } finally { f.close(); }
});

it('CLI creates private review artifacts without overwriting source or existing output', async () => {
  const { f, selected } = source(), directory = await mkdtemp(join(tmpdir(), 'hehebot-template-'));
  try {
    const input = join(directory, 'state.json'), output = join(directory, 'template.json'), plan = join(directory, 'plan.json');
    const bytes = JSON.stringify(f.core.state()); await writeFile(input, bytes, { mode: 0o600 });
    const run = (...args: string[]) => promisify(execFile)(process.execPath, ['scripts/portable-template.mjs', ...args]);
    const exported = await run('export', input, selected.join(','), output);
    expect(JSON.parse(exported.stdout)).toMatchObject({ commands: 3, executed: false });
    await run('plan', output, randomUUID(), plan);
    expect((await stat(output)).mode & 0o777).toBe(0o600); expect((await stat(plan)).mode & 0o777).toBe(0o600);
    const before = await readFile(output);
    await expect(run('export', input, selected.join(','), output)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(output)).toEqual(before); expect(await readFile(input, 'utf8')).toBe(bytes);
    const link = join(directory, 'linked.json'), rejected = join(directory, 'rejected.json');
    await symlink(input, link);
    await expect(run('export', link, selected.join(','), rejected)).rejects.toMatchObject({ code: 1 });
    await chmod(input, 0o644);
    await expect(run('export', input, selected.join(','), rejected)).rejects.toMatchObject({ code: 1 });
    await expect(stat(rejected)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { f.close(); await rm(directory, { recursive: true, force: true }); }
});
