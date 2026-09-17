import { describe, expect, it } from 'vitest';
import vectors from '../TEST_VECTORS/commands.json';
import { parseCommand } from '../src/core/control';
import { bot } from './helpers';
describe('versioned command schema', () => {
  it('accepts optional bounded profile role while rejecting account state',()=>{
    const payload={id:bot,expected_revision:0,name:'Minimal',instructions:'Read only.',tool_policy_ids:[],archived:false};
    const command=(extra:unknown)=>({schema_version:1,type:'persona.put',payload:{...payload,...extra as object}});
    expect(()=>parseCommand(command({}))).not.toThrow();expect(()=>parseCommand(command({role:'🧭'.repeat(200)}))).not.toThrow();
    for(const extra of [{role:'x'.repeat(201)},{role:{}},{credentials:'not-a-real-key'},{connector_authority:[bot]},{native_thread_id:bot}])expect(()=>parseCommand(command(extra))).toThrow();
  });
  it('contains all 10 valid command variants and 4 rejection fixtures', () => { expect(vectors.valid).toHaveLength(10); expect(vectors.invalid).toHaveLength(4); });
  it.each(vectors.valid)('accepts $type fixture', (command) => { expect(parseCommand(command)).toEqual(command); });
  it.each(vectors.invalid)('rejects invalid contract %#', ({ command, expected_error }) => { expect(() => parseCommand(command)).toThrowError(expect.objectContaining({ code: expected_error })); });
  it('requires explicit lock release consent for stopped-run recovery, not supplied shutdown proof', () => {
    const command=(payload:unknown)=>({schema_version:1,type:'run.recover',payload});
    const payload={run_id:bot,expected_attempt:1,release_resources:true};
    expect(parseCommand(command(payload))).toEqual(command(payload));
    for(const invalid of [{run_id:bot,expected_attempt:1},{...payload,release_resources:false},{...payload,expected_attempt:0},{...payload,executionStopped:true}]) {
      expect(()=>parseCommand(command(invalid))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
  });
  it('requires an exact stopped-effect decision and bounded reference, without accepting release or shutdown assertions', () => {
    const payload = {run_id:bot,effect_id:bot,expected_attempt:1,expected_request_digest:'digest-19',outcome:'confirmed',evidence_ref:'receipt:43'};
    const command = (payload:unknown) => ({schema_version:1,type:'effect.reconcile',payload});
    expect(parseCommand(command(payload))).toEqual(command(payload));
    for(const change of [{expected_attempt:0},{outcome:'dispatched'},{evidence_ref:''},{evidence_ref:'https://example.invalid/private'},
      {evidence_ref:'x'.repeat(129)},{expected_request_digest:''},{expected_request_digest:'x'.repeat(257)},
      {resources:['mail:17']},{executionStopped:true},{effect_id:'not-a-uuid'}]) {
      expect(() => parseCommand(command({...payload,...change}))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
  });
  it('bounds owner budget policies and requires a revision for one-run overrides', () => {
    const policy = { expected_revision: 0, enabled: true, monthly_cap_cents: 500, optional_routine_ids: [bot] };
    const set = (payload: unknown) => ({ schema_version: 1, type: 'budget.set', payload });
    expect(parseCommand(set(policy))).toEqual(set(policy));
    expect(() => parseCommand(set({ ...policy, optional_routine_ids: [] }))).not.toThrow();
    for (const payload of [{ ...policy, monthly_cap_cents: 0 }, { ...policy, monthly_cap_cents: 500.5 },
      { ...policy, monthly_cap_cents: 1000000001 }, { ...policy, optional_routine_ids: [bot, bot] },
      { ...policy, enabled: 'true' }, { ...policy, grant: true }]) {
      expect(() => parseCommand(set(payload))).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
    const override = (payload: unknown) => ({ schema_version: 1, type: 'budget.override', payload });
    expect(() => parseCommand(override({ run_id: bot, expected_revision: 1 }))).not.toThrow();
    for (const payload of [{ run_id: bot }, { run_id: bot, expected_revision: 0 }, { run_id: bot, expected_revision: 1, all: true }]) {
      expect(() => parseCommand(override(payload))).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
  });
  it('accepts only the exact bounded skill invocation contract', () => {
    const payload = {skill_id:bot,expected_skill_revision:1,persona_id:bot,expected_persona_revision:1,text:'Use the reviewed skill.'};
    const command = (payload: unknown) => ({schema_version:1,type:'skill.run',payload});
    expect(parseCommand(command(payload))).toEqual(command(payload));
    expect(() => parseCommand(command({...payload,text:'😀'.repeat(8192)}))).not.toThrow();
    expect(() => parseCommand(command({...payload,text:'x'.repeat(32768)}))).not.toThrow();
    for (const invalid of [
      {expected_skill_revision:0}, {expected_skill_revision:1.5}, {expected_persona_revision:0},
      {skill_id:'not-a-uuid'}, {persona_id:'not-a-uuid'}, {text:''}, {text:'x'.repeat(32769)},
      {dry_run:true}, {safe_test:true}, {enable:true}, {authority_policy_ids:[bot]},
    ]) {
      expect(() => parseCommand(command({...payload,...invalid}))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
    for (const missing of Object.keys(payload)) {
      const incomplete = {...payload};
      delete incomplete[missing as keyof typeof incomplete];
      expect(() => parseCommand(command(incomplete))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
  });
  it('accepts only the strict task-sourced skill proposal contract', () => {
    const body = {
      name:'Summarize task', description:'A reviewed summary procedure.', when_to_use:'When an owner requests a task summary.',
      inputs_access:['Retained task output'], steps:['Read the retained output.'], decision_rules:[],
      validation:['Check the summary against the retained output.'], output:'A concise summary.',
      failure_handling:['Report unavailable retained output.'], approval_boundaries:['Do not perform effects.'],
      references:[{name:'guide.md',text:'Use only retained task output.'}], contains_private_facts:false as const,
    };
    const payload = {proposal_id:bot,skill_id:bot,expected_skill_revision:0,source_run_id:bot,expected_attempt:1,body};
    const command = (payload: unknown) => ({schema_version:1,type:'skill.propose_from_task',payload});
    expect(parseCommand(command(payload))).toEqual(command(payload));
    for (const missing of Object.keys(payload)) {
      const incomplete = {...payload};
      delete incomplete[missing as keyof typeof incomplete];
      expect(() => parseCommand(command(incomplete))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    }
    for (const change of [
      {proposal_id:'not-a-uuid'}, {skill_id:'not-a-uuid'}, {source_run_id:'not-a-uuid'},
      {expected_skill_revision:-1}, {expected_skill_revision:0.5}, {expected_attempt:0}, {expected_attempt:1.5},
      {provenance:{kind:'task',source_ref:bot}}, {executable_files_changed:false}, {automatic_approval:true},
      {model:'codex'}, {caller_run_id:bot},
    ]) expect(() => parseCommand(command({...payload,...change}))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  });
  it('applies private-fact and reference constraints to task-sourced skill proposals', () => {
    const body = {
      name:'Summarize task', description:'A reviewed summary procedure.', when_to_use:'For summaries.', inputs_access:[],
      steps:['Read retained output.'], decision_rules:[], validation:['Verify output.'], output:'Summary.',
      failure_handling:['Report failure.'], approval_boundaries:['No effects.'], contains_private_facts:false as const,
    };
    const payload = {proposal_id:bot,skill_id:bot,expected_skill_revision:0,source_run_id:bot,expected_attempt:1,body};
    const command = (changedBody: unknown) => ({schema_version:1,type:'skill.propose_from_task',payload:{...payload,body:changedBody}});
    for (const changedBody of [
      {...body,contains_private_facts:true}, {...body,contains_private_facts:false,private_facts:['secret']},
      {...body,references:[{name:'unsafe.exe',text:'text'}]}, {...body,references:[{name:'guide.md',text:''}]},
      {...body,references:[{name:'a.md',text:'a'},{name:'b.md',text:'b'},{name:'c.md',text:'c'},{name:'d.md',text:'d'},{name:'e.md',text:'e'}]},
      {...body,references:[{name:'guide.md',text:'x'.repeat(16001)}]},
    ]) expect(() => parseCommand(command(changedBody))).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  });
  it('keeps legacy skill command serialization unchanged', () => {
    const legacy = {schema_version:1,type:'skill.enable',payload:{skill_id:bot,expected_skill_revision:1,persona_id:bot,enabled:true}};
    expect(JSON.stringify(parseCommand(legacy))).toBe(JSON.stringify(legacy));
  });
  it('enforces UTF-8 byte limit independently of code-point length', () => {
    const message = (text: string) => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
    expect(() => parseCommand(message('😀'.repeat(8192)))).not.toThrow();
    expect(() => parseCommand(message('😀'.repeat(8193)))).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', status: 413 }));
    expect(() => parseCommand(message('x'.repeat(32768)))).not.toThrow();
  });
});
