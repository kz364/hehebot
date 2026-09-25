import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { fixture, bot, otherBot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { countMemory } from '../runtime/memory-tokenizer.mjs';
import validateRuntime from '../src/generated/validate-runtime.js';
import {MEMORY_READ_POLICY,AgentCommandBoundary} from '../src/core/agent-commands';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, directory: string;
let nativeCalls: number, lose: string | undefined, nativeMessages: any[], nativeModels: string[];
beforeEach(async () => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
  directory = await mkdtemp(join(tmpdir(), 'hehebot-bridge-'));
  nativeCalls = 0; lose = undefined; nativeMessages = []; nativeModels = [];
});
afterEach(async () => { f.close(); await rm(directory, { recursive: true, force: true }); });
function enqueue() {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic bridge request' } }).resource_id!;
}
function bridge(testMode = true, journal = new FileJournal(join(directory, 'bridge'))) {
  const native = new CodexAdapter({ cwd: directory, testMode, journal: new FileJournal(join(directory, 'native')), rpc: async (method: string, params: any) => {
    if (method === 'thread/start') { nativeModels.push(params.model); return { thread: { id: 'native-bridge-thread' } }; }
    if (method === 'turn/start') {
      nativeCalls++;
      nativeMessages.push(JSON.parse(params.input[0].text));
      if (lose === 'native') throw new Error('lost native admission response');
      return { turn: { id: 'native-bridge-result' } };
    }
    throw new Error('Unexpected native call');
  } });
  const control = { request: async (type: string, p: any) => {
    let result;
    if (type === 'memory-prepare') result = life.prepareMemory(p.identity, p.persona_models, p.memory_read_personas);
    else if (type === 'claim') result = life.claim(p.identity, p.persona_models, p.memory_budget, p.memory_read_personas);
    else if (type === 'submitted') result = life.submitted(p.identity, p.run_id, p.attempt, p.native_ref);
    else if (type === 'complete') result = life.complete(p.identity, p.run_id, p.attempt, p.result);
    else throw new Error('Unexpected control call');
    if (lose === type) throw new Error('lost acknowledgment after durable mutation');
    return result;
  } };
  const personas = { [otherBot]: { agentId: 'other', model: 'different-model' }, [bot]: { agentId: 'chief-of-staff', model: 'gpt-5.5' } };
  return Object.assign(new ExecutionBridge({ control, native, journal, identity,
    installationId: 'synthetic-installation', personas }), { control, journal, personas });
}
function settled(row: any) {
  return { attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: true, toolsSettled: true,
    childrenSettled: true, effectsSettled: true, outputCommitted: true,
    result: { status: 'completed', text: 'Durably returned to the portal' } };
}

it('counts the exact prepared arrays before claim and carries their receipt to native input', async () => {
  const id = enqueue(), executor = bridge();
  executor.memoryCounter = async (input: any) => {
    expect(f.store.run(id).current_attempt).toBe(0);
    expect(await executor.journal.get(executor.cursor)).toBeNull();
    expect(input).toEqual({ selected_model: 'gpt-5.5', global: '[]', scoped: '[]' });
    return countMemory(input);
  };
  expect((await executor.claimNext()).phase).toBe('running');
  expect(nativeMessages[0].memory_budget).toMatchObject({ run_id: id, attempt: 1,
    selected_model: 'gpt-5.5', global_tokens: 1, scoped_tokens: 1 });
  expect(nativeMessages[0].memories).toEqual([]);
});

it.each([true,false])('counts and emits disclosed summaries only for captured host retrieval=%s', async host => {
  const persona=f.store.get(bot);f.store.put(bot,'persona',{...persona.body,tool_policy_ids:[MEMORY_READ_POLICY]},persona.revision,'owner',f.core.now());
  const id=randomUUID(),source=randomUUID(),text='Distinct raw source 73. '.repeat(80);
  f.store.event(source,bot,'message.user','owner',null,{text:'Source'},f.core.now());
  const source_sha256=createHash('sha256').update(JSON.stringify([1,id,1,'persona',bot,text,source,null,'ordinary',false])).digest('hex');
  expect(f.accept({schema_version:1,type:'memory.put',payload:{id,expected_revision:0,scope:{kind:'persona',id:bot},text,
    source_event_id:source,expires_at:null,sensitivity:'ordinary',explicit_constraint:false,
    summary:{schema_version:1,source_sha256,text:'Owner summary 29.'}}}).status).toBe('applied');
  const run=enqueue(),executor=bridge(),request=executor.control.request;
  Object.assign(executor.personas[bot],{allowedTools:host?['hehebot_read_memory']:[]});
  let counted:any;
  executor.control.request=async (type:string,payload:any)=>{
    if(['memory-prepare','claim'].includes(type)){
      expect(validateRuntime({type,payload})).toBe(true);
      expect(payload.memory_read_personas).toEqual(host?[bot]:[]);
    }
    return request(type,payload);
  };
  executor.memoryCounter=async (input:any)=>{
    counted=input;
    // A later host configuration edit cannot change this admitted selection.
    Object.assign(executor.personas[bot],{allowedTools:[]});
    return countMemory(input);
  };
  expect((await executor.claimNext()).phase).toBe('running');
  expect(JSON.stringify(nativeMessages[0].memories)).toBe(counted.scoped);
  expect(nativeMessages[0].memories[0].body.text).toBe(host?'Owner summary 29.':text);
  if(host){
    expect(JSON.stringify(nativeMessages[0])).not.toContain('Distinct raw source 73');
    expect(nativeMessages[0].memories[0].representation).toMatchObject({kind:'owner_summary',source_sha256,source_code_points:text.length});
    const boundary=new AgentCommandBoundary(f.core,life);
    const read=boundary.prepareMemoryRead({identity,run_id:run,attempt:1,read_id:randomUUID(),memory_id:id,revision:1,offset:0,limit:23});
    expect(JSON.parse(read.text).memory.text).toBe('Distinct raw source 73.');
  }
});

it('preserves asymmetric bucket framing, metadata and explicit constraints without hydrating foreign memory', async () => {
  const source = randomUUID();
  f.store.event(source, bot, 'message.user', 'owner', null, { text: 'Owner constraints' }, f.core.now());
  const records = [
    { scope: { kind: 'global' as const, id: null }, text: 'Global α', explicit_constraint: true },
    { scope: { kind: 'persona' as const, id: bot }, text: 'Scoped 東京, never send without approval.', explicit_constraint: true },
    { scope: { kind: 'persona' as const, id: otherBot }, text: 'Foreign must not enter either bucket.' },
  ].map(body => ({ id: randomUUID(), expected_revision: 0, source_event_id: source,
    expires_at: null, sensitivity: 'ordinary' as const, ...body }));
  for (const payload of records) expect(f.accept({ schema_version: 1, type: 'memory.put', payload }).status).toBe('applied');
  enqueue(); const executor = bridge(); let captured: any;
  executor.memoryCounter = async (input: any) => {
    captured = input;
    expect(JSON.parse(input.global)).toMatchObject([{ id: records[0].id, revision: 1, body: records[0] }]);
    expect(JSON.parse(input.scoped)).toMatchObject([{ id: records[1].id, revision: 1, body: records[1] }]);
    return { schema_version: 1, selected_model: 'gpt-5.5', tokenizer: 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1',
      global_tokens: 137, scoped_tokens: 219 };
  };
  expect((await executor.claimNext()).phase).toBe('running');
  expect(nativeMessages[0].memory_budget).toMatchObject({ global_tokens: 137, scoped_tokens: 219 });
  expect(nativeMessages[0].memories).toHaveLength(2);
  expect(JSON.stringify(nativeMessages[0].memories.filter((m: any) => m.body.scope.kind === 'global'))).toBe(captured.global);
  expect(JSON.stringify(nativeMessages[0].memories.filter((m: any) => m.body.scope.kind !== 'global'))).toBe(captured.scoped);
});

it.each([null, ...['MEMORY_PREPARATION_LIMIT', 'CONTEXT_PREPARATION_LIMIT'].map(reason => ({ blocked: true as const, run_id: 'bounded-run', reason }))])('does not count or claim when preparation returns %j', async reply => {
  const executor = bridge(); let calls = 0;
  executor.memoryCounter = async () => { throw new Error('must not count'); };
  executor.control.request = async (type: string) => { expect(type).toBe('memory-prepare'); calls++; return reply; };
  expect((await executor.claimNext()).phase).toBe('complete');
  expect(calls).toBe(1); expect(nativeCalls).toBe(0);
});

it.each(['TOKENIZER_TIMEOUT', 'TOKENIZER_ABORTED', 'TOKENIZER_WORKER_FAILED'])('never claims or falls back after %s', async code => {
  const id = enqueue(), executor = bridge();
  executor.memoryCounter = async () => { throw Object.assign(new Error(code), { code }); };
  await expect(executor.claimNext()).rejects.toMatchObject({ code });
  expect(f.store.run(id).current_attempt).toBe(0);
  expect(await executor.journal.get(executor.cursor)).toBeNull();
  expect(nativeCalls).toBe(0);
});

it('an over-budget receipt blocks visibly before an attempt rather than dropping memory', async () => {
  const id = enqueue(), executor = bridge();
  executor.memoryCounter = async () => ({ schema_version: 1, selected_model: 'gpt-5.5',
    tokenizer: 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1', global_tokens: 4001, scoped_tokens: 2 });
  expect((await executor.claimNext()).phase).toBe('complete');
  expect(f.store.run(id)).toMatchObject({ status: 'waiting', error_code: 'MEMORY_BUDGET_EXCEEDED', current_attempt: 0 });
  expect(nativeCalls).toBe(0);
});

it('lost budgeted claim acknowledgment keeps uncertainty and never recounts or reclaims', async () => {
  const id = enqueue(), executor = bridge(); let counts = 0;
  executor.memoryCounter = async (input: any) => { counts++; return countMemory(input); };
  lose = 'claim';
  expect((await executor.claimNext()).phase).toBe('claim_unknown');
  expect(f.store.run(id).current_attempt).toBe(1);
  lose = undefined;
  expect((await executor.claimNext()).phase).toBe('claim_unknown');
  expect(counts).toBe(1); expect(nativeCalls).toBe(0);
});

it.each(['snapshot', 'receipt', 'preparation'])('refuses changed %s bytes rather than submitting mismatched memory', async mutation => {
  enqueue(); const executor = bridge(), request = executor.control.request;
  executor.memoryCounter = countMemory;
  executor.control.request = async (type: string, payload: any) => {
    const reply: any = await request(type, payload);
    if (type === 'memory-prepare' && mutation === 'preparation') reply.global = '[ ]';
    if (type === 'claim') {
      const context = JSON.parse(reply.run.context_json);
      if (mutation === 'snapshot') context.memories = [{ body: { scope: { kind: 'global' }, text: 'uncounted' } }];
      if (mutation === 'receipt') delete context.memory_budget;
      reply.run.context_json = JSON.stringify(context);
    }
    return reply;
  };
  await expect(executor.claimNext()).rejects.toMatchObject({ code: mutation === 'preparation' ? 'INVALID_MEMORY_PREPARATION' : 'MEMORY_CLAIM_MISMATCH' });
  expect(nativeCalls).toBe(0);
});

it('binds the host-selected model into Worker custody and native input without trusting context text', async () => {
  const id = enqueue(), executor = bridge(), request = executor.control.request;
  expect(JSON.parse(f.store.run(id).context_json)).not.toHaveProperty('selected_model');
  f.db.exec("UPDATE runs SET context_json=json_set(context_json,'$.selected_model','untrusted-prior-model') WHERE id=?", id);
  executor.control.request = async (type: string, payload: any) => {
    if (type === 'claim') {
      expect(payload.persona_models).toEqual({ [otherBot]: 'different-model', [bot]: 'gpt-5.5' });
      expect(validateRuntime({ type, payload })).toBe(true);
      executor.personas[bot].model = 'changed-after-claim';
    }
    return request(type, payload);
  };
  const row = await executor.claimNext();
  expect(row.phase).toBe('running');
  expect(JSON.parse(f.store.run(id).context_json).selected_model).toBe('gpt-5.5');
  expect(nativeMessages[0].selected_model).toBe('gpt-5.5');
  expect(nativeModels).toEqual(['gpt-5.5']);
  expect(nativeCalls).toBe(1);
});

it('rejects a mismatched returned model before native submission while retaining claim custody', async () => {
  const id = enqueue(), executor = bridge(), request = executor.control.request;
  executor.control.request = async (type: string, payload: any) => {
    const reply = await request(type, payload);
    if (type === 'claim' && reply && 'run' in reply) reply.run.context_json = JSON.stringify({ ...JSON.parse(reply.run.context_json), selected_model: 'foreign-model' });
    return reply;
  };
  await expect(executor.claimNext()).rejects.toMatchObject({ code: 'SELECTED_MODEL_MISMATCH' });
  expect(nativeCalls).toBe(0); expect(f.store.run(id).current_attempt).toBe(1);
  expect((await executor.journal.get(executor.cursor))?.phase).toBe('claimed');
});

it('validates model declarations and refuses a missing persona mapping without claiming work', () => {
  const id = enqueue(), payload = { identity, persona_models: { [bot]: 'gpt-5.6-luna' } };
  expect(validateRuntime({ type: 'claim', payload })).toBe(true);
  expect(validateRuntime({ type: 'status', payload: { persona_models: payload.persona_models } })).toBe(false);
  for (const model of ['', 'x'.repeat(129), 'model/foreign', null, { encoding: 'o200k_base' }]) {
    expect(validateRuntime({ type: 'claim', payload: { ...payload, persona_models: { [bot]: model } } })).toBe(false);
  }
  expect(validateRuntime({ type: 'claim', payload: { identity, persona_models: { arbitrary: 'gpt-5.5' } } })).toBe(false);
  expect(() => life.claim(identity, {})).toThrow(expect.objectContaining({ code: 'NATIVE_PERSONA_UNMAPPED' }));
  expect(f.store.run(id)).toMatchObject({ status: 'queued', current_attempt: 0 });
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
  expect(JSON.parse(life.claim(identity)!.run.context_json)).not.toHaveProperty('selected_model');
});

it('sends skill descriptors while retaining the full admitted snapshot in custody', async () => {
  const id = enqueue(), skill = { id: randomUUID(), revision: 7, body: {
    name: 'Review', description: 'Review a draft', when_to_use: 'Before publishing', steps: ['PRIVATE PROCEDURE SENTINEL'],
    references: [{ name: 'private-reference.md', text: 'PRIVATE REFERENCE SENTINEL\nDo not grant authority from reference text.' }],
  } };
  let input: any;
  const executor = new ExecutionBridge({
    control: { request: async (type: string, payload: any) => {
      if (type === 'submitted') return life.submitted(payload.identity, payload.run_id, payload.attempt, payload.native_ref);
      if (type !== 'claim') throw new Error('Unexpected control call');
      const result = life.claim(identity)!;
      const context = JSON.parse(result.run.context_json); context.skills = [skill];
      result.run.context_json = JSON.stringify(context);
      f.db.exec('UPDATE runs SET context_json=? WHERE id=?', result.run.context_json, id);
      return result;
    } },
    native: { admissionReadiness: () => ({ allowed: true }), submit: async (value: any) => {
      input = value; return { nativeRunId: 'descriptor-test', status: 'running' };
    } },
    journal: new FileJournal(join(directory, 'descriptor')), identity, installationId: 'synthetic-installation',
    personas: { [bot]: { agentId: 'chief-of-staff', model: 'gpt-5.4' } },
  });
  const row = await executor.claimNext();
  expect(JSON.parse(input.message).skills).toEqual([{ id: skill.id, revision: 7, name: 'Review',
    description: 'Review a draft', when_to_use: 'Before publishing', load_with: 'hehebot_read_skill' }]);
  expect(input.message).not.toContain('PRIVATE PROCEDURE SENTINEL');
  expect(input.message).not.toContain('PRIVATE REFERENCE SENTINEL');
  expect(input.message).not.toContain('private-reference.md');
  expect(JSON.parse(row.claim.run.context_json).skills).toEqual([skill]);
});

it('explicit skill admission reaches the adapter with the pinned descriptor and unchanged authority', async () => {
  const skillId=randomUUID(),proposal=randomUUID(),body={name:'Pinned review',description:'Review supplied input',when_to_use:'Explicitly requested',inputs_access:[],steps:['PRIVATE PROCEDURE 37'],decision_rules:[],validation:['Check supplied values'],output:'Review',failure_handling:['Explain missing input'],approval_boundaries:['No new authority'],contains_private_facts:false as const,references:[{name:'notes.md',text:'PRIVATE REFERENCE 91'}]};
  expect(f.accept({schema_version:1,type:'skill.propose',payload:{proposal_id:proposal,skill_id:skillId,expected_skill_revision:0,body,provenance:{kind:'owner',source_ref:'synthetic'},executable_files_changed:false}}).status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:proposal,expected_proposal_revision:1,decision:'approve'}}).status).toBe('applied');
  const receipt=f.accept({schema_version:1,type:'skill.run',payload:{skill_id:skillId,expected_skill_revision:1,persona_id:bot,expected_persona_revision:1,text:'Review 17 against 43.'}});
  expect(receipt.status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.delete',payload:{id:skillId,expected_revision:1}}).status).toBe('applied');
  const row=await bridge().claimNext(),context=JSON.parse(row.claim.run.context_json);
  expect(row.claim.run.id).toBe(receipt.resource_id);expect(nativeCalls).toBe(1);
  expect(nativeMessages[0]).toMatchObject({instruction:'Review 17 against 43.',skill_invocation:{skill_id:skillId,skill_revision:1}});
  expect(nativeMessages[0].skills).toEqual([{id:skillId,revision:1,name:body.name,description:body.description,when_to_use:body.when_to_use,load_with:'hehebot_read_skill'}]);
  expect(JSON.stringify(nativeMessages)).not.toMatch(/PRIVATE PROCEDURE|PRIVATE REFERENCE|notes\.md/);
  expect(context.skills).toEqual([expect.objectContaining({id:skillId,revision:1,body})]);
  expect(context.authorization_policy_ids).toEqual([]);expect(context.persona.body.tool_policy_ids).toEqual([]);
  expect(f.db.all('SELECT * FROM skill_enablements')).toEqual([]);
});

it('real SQLite claim → native adapter/journal → completion publishes exactly one attributed reply', async () => {
  const id = enqueue(), executor = bridge();
  const row = await executor.claimNext();
  expect(row.phase).toBe('running'); expect(f.store.run(id).status).toBe('running');
  await executor.complete(settled(row)); await executor.complete(settled(row));
  expect(nativeCalls).toBe(1);
  expect(f.store.run(id).status).toBe('completed');
  expect(f.store.conversationEvents(bot, f.core.now(), undefined, 100).filter(e => e.type === 'run.result').map(e => e.payload.text)).toEqual(['Durably returned to the portal']);
});

it.each(['journal-read', 'result-write', 'control-await'])('completion detaches caller custody before %s mutation', async boundary => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  const observation = { ...settled(row), result: { status: 'waiting', text: 'Original question 43',
    checkpoint: { cursor: 17, steps: ['review-29'] } } };
  const expected = { status: 'waiting', text: 'Original question 43', checkpoint: { cursor: 17, steps: ['review-29'] } };
  const mutate = () => {
    observation.result.text = 'Changed question 97';
    observation.result.checkpoint.cursor = 83;
    observation.result.checkpoint.steps.push('unreviewed-103');
    observation.nativeRunId = 'foreign-native'; observation.childrenSettled = false;
  };
  const get = executor.journal.get.bind(executor.journal);
  executor.journal.get = async (key: string) => {
    const value = await get(key);
    if (boundary === 'journal-read') mutate();
    return value;
  };
  const update = executor.journal.update.bind(executor.journal);
  executor.journal.update = async (key: string, patch: any) => {
    const value = await update(key, patch);
    if (boundary === 'result-write' && patch.phase === 'complete_pending') mutate();
    return value;
  };
  const request = executor.control.request;
  executor.control.request = async (type: string, payload: any) => {
    if (type === 'complete') {
      if (boundary === 'control-await') { await Promise.resolve(); mutate(); }
      expect(payload.result).toEqual(expected);
    }
    return request(type, payload);
  };
  const completed = await executor.complete(observation);
  expect(completed.phase).toBe('complete'); expect(completed.result).toEqual(expected);
  expect((await get(executor.cursor)).result).toEqual(expected);
  expect(JSON.parse(f.store.run(id).checkpoint_json!)).toEqual(expected.checkpoint);
  expect(f.store.conversationEvents(bot, f.core.now(), undefined, 100).filter(e => e.type === 'run.result').map(e => e.payload.text)).toEqual([expected.text]);
  const before = f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
  await bridge().complete({ ...settled(row), result: expected });
  expect(f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n).toBe(before);
  expect(nativeCalls).toBe(1);
});

it('a caller cannot upgrade incomplete settlement while completion awaits the journal', async () => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  const observation = { ...settled(row), effectsSettled: false };
  const get = executor.journal.get.bind(executor.journal);
  executor.journal.get = async (key: string) => { const value = await get(key); observation.effectsSettled = true; return value; };
  await expect(executor.complete(observation)).rejects.toMatchObject({ code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  expect(await get(executor.cursor)).toEqual(row);
  expect(f.store.run(id).status).toBe('running'); expect(f.db.all('SELECT * FROM outbox')).toEqual([]);
});

it.each(['cycle', 'bigint'])('non-JSON %s completion rejects before journal/control work and releases the busy guard', async kind => {
  enqueue(); const executor = bridge(), row = await executor.claimNext();
  const checkpoint: any = kind === 'bigint' ? { cursor: 1n } : {};
  if (kind === 'cycle') checkpoint.self = checkpoint;
  const get = executor.journal.get.bind(executor.journal), request = executor.control.request;
  let reads = 0, requests = 0;
  executor.journal.get = async (key: string) => { reads++; return get(key); };
  executor.control.request = async (type: string, payload: any) => { requests++; return request(type, payload); };
  await expect(executor.complete({ ...settled(row), result: { status: 'waiting', text: 'Invalid checkpoint', checkpoint } })).rejects.toMatchObject({ code: 'INVALID_NATIVE_RESULT' });
  expect(reads).toBe(0); expect(requests).toBe(0); expect(await get(executor.cursor)).toEqual(row);
  expect((await executor.complete(settled(row))).phase).toBe('complete');
});

it('clears the prior native attempt before publishing custody of another claimed run', async () => {
  const journal = new FileJournal(join(directory, 'bridge'));
  enqueue(); const executor = bridge(true, journal), first = await executor.claimNext();
  await executor.complete(settled(first));
  const nextId = enqueue(), snapshots: any[] = [];
  const update = journal.update.bind(journal);
  journal.update = async (key: string, patch: any) => {
    const row = await update(key, patch);
    if (key === executor.cursor && ['claim_unknown', 'claimed'].includes(row.phase)) snapshots.push(structuredClone(row));
    return row;
  };
  const next = await executor.claimNext();
  expect(snapshots.map(row => row.phase)).toEqual(['claim_unknown', 'claimed']);
  expect(snapshots.map(row => row.attemptId)).toEqual([null, null]);
  expect(snapshots.map(row => row.nativeRunId)).toEqual([null, null]);
  expect(snapshots[1].claim.run.id).toBe(nextId);
  expect(next.attemptId).not.toBe(first.attemptId);
  expect(nativeCalls).toBe(2);
});

it.each(['claim', 'native', 'submitted'])('lost %s acknowledgment survives journal reconstruction without resubmission', async loss => {
  const id = enqueue(); lose = loss;
  const before = await bridge().claimNext();
  lose = undefined;
  const after = await bridge().claimNext();
  expect(after.phase).toBe(before.phase);
  expect(after.phase).toBe(loss === 'claim' ? 'claim_unknown' : loss === 'native' ? 'submission_unknown' : 'submitted_unknown');
  expect(nativeCalls).toBe(loss === 'claim' ? 0 : 1);
  expect(f.db.all('SELECT attempt FROM attempts WHERE run_id=?', id)).toHaveLength(1);
});

it.each(['before', 'after'])('reconstructs an exact submitted receipt after failure %s Worker registration without another native turn', async timing => {
  const id = enqueue(), executor = bridge();
  if (timing === 'after') lose = 'submitted';
  else {
    const request = executor.control.request;
    executor.control.request = async (type: string, payload: any) => {
      if (type === 'submitted') throw new Error('request never arrived');
      return request(type, payload);
    };
  }
  const row = await executor.claimNext(); expect(row.phase).toBe('submitted_unknown');
  expect(f.store.run(id).status).toBe(timing === 'before' ? 'claimed' : 'running');
  const changes = f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n;
  lose = undefined; const restored = bridge(), calls: string[] = [], request = restored.control.request;
  restored.control.request = async (type: string, payload: any) => { calls.push(type); return request(type, payload); };
  const acknowledged = await restored.acknowledgeSubmission();
  expect(acknowledged).toEqual({ ...row, phase: 'running' }); expect(calls).toEqual(['submitted']);
  expect(nativeCalls).toBe(1); expect(f.store.run(id).status).toBe('running');
  if (timing === 'after') expect(f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n).toBe(changes);
  expect(f.db.all('SELECT attempt FROM attempts WHERE run_id=?', id)).toEqual([{ attempt: 1 }]);
});

it.each(['claim', 'native'])('does not turn %s uncertainty into a submission registration', async loss => {
  enqueue(); lose = loss; const executor = bridge(), row = await executor.claimNext();
  lose = undefined; const before = f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n;
  await expect(bridge().acknowledgeSubmission()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  expect(await executor.journal.get(executor.cursor)).toEqual(row);
  expect(f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n).toBe(before);
  expect(nativeCalls).toBe(loss === 'native' ? 1 : 0);
});

it.each(['stale-epoch', 'changed-native', 'lost-reply'])('keeps exact submitted uncertainty after %s reconciliation failure', async failure => {
  const id = enqueue(); lose = 'submitted'; const executor = bridge(), row = await executor.claimNext(); lose = undefined;
  if (failure === 'stale-epoch') f.db.exec('UPDATE lifecycle SET epoch=2');
  if (failure === 'changed-native') f.db.exec("UPDATE attempts SET native_run_ref='different-native' WHERE run_id=?", id);
  if (failure === 'lost-reply') lose = 'submitted';
  await expect(bridge().acknowledgeSubmission()).rejects.toThrow();
  expect(await executor.journal.get(executor.cursor)).toEqual(row); expect(nativeCalls).toBe(1);
});

it('does not resurrect a cancelled task when recovering its already registered submission', async () => {
  const id = enqueue(); lose = 'submitted'; const executor = bridge(); await executor.claimNext(); lose = undefined;
  f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Exact task only' } });
  const before = ['runs', 'attempts', 'events', 'lifecycle'].map(table => f.db.all(`SELECT * FROM ${table}`));
  expect((await bridge().acknowledgeSubmission()).phase).toBe('running');
  expect(['runs', 'attempts', 'events', 'lifecycle'].map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
  expect(f.store.run(id).status).toBe('cancelling'); expect(nativeCalls).toBe(1);
});

it.each(['completed', 'waiting', 'retryable_failure'] as const)('lost %s completion acknowledgment replays the persisted attempt result without another turn', async kind => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  const observation = { ...settled(row), result: kind === 'waiting'
    ? { status: 'waiting', text: 'Needs an owner decision', checkpoint: { cursor: 71, question: 'Which draft?' } }
    : kind === 'retryable_failure'
      ? { status: 'failed', text: 'Temporary read failure', error_code: 'TEMPORARY_UNAVAILABLE' }
      : settled(row).result };
  lose = 'complete'; await expect(executor.complete(observation)).rejects.toThrow('lost acknowledgment');
  expect(f.store.run(id).status).toBe(kind === 'completed' ? 'completed' : 'waiting');
  const before = ['runs', 'attempts', 'outbox', 'events', 'retry_queue', 'lifecycle'].map(table => f.db.all(`SELECT * FROM ${table}`));
  lose = undefined; const replay = await bridge().complete(observation);
  expect(replay.phase).toBe('complete');
  expect(['runs', 'attempts', 'outbox', 'events', 'retry_queue', 'lifecycle'].map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
  expect(nativeCalls).toBe(1);
  expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  await expect(bridge().complete({ ...observation, result: { ...observation.result, text: 'Different reply' } })).rejects.toMatchObject({ code: 'RESULT_CONFLICT' });
});

it.each(['owner', 'automatic'] as const)('%s retry passes the saved checkpoint as data without leaking it into another task or authority', async mode => {
  const id = enqueue(), executor = bridge(), first = await executor.claimNext();
  const checkpoint = { cursor: 43, completed_step_ids: ['step-19'], authorization_policy_ids: ['ungranted'] };
  await executor.complete({ ...settled(first), result: { status: mode === 'owner' ? 'waiting' : 'failed', text: 'Paused', checkpoint,
    ...(mode === 'automatic' ? { error_code: 'TEMPORARY_UNAVAILABLE' } : {}) } });
  expect(JSON.parse(f.store.run(id).checkpoint_json!)).toEqual(checkpoint);
  if (mode === 'owner') expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: id, expected_attempt: 1 } }).status).toBe('applied');
  else { f.setNow('2026-09-10T00:00:11.000Z'); life.retryDue(); }
  const restored = bridge(), next = await restored.claimNext();
  expect(next.claim.run.id).toBe(id); expect(next.claim.run.current_attempt).toBe(2);
  expect(nativeMessages[0]).not.toHaveProperty('durable_checkpoint');
  expect(nativeMessages[1].durable_checkpoint).toEqual(checkpoint);
  expect(nativeMessages[1].authorization_policy_ids).toEqual([]);
  expect(JSON.parse(next.claim.run.context_json)).not.toHaveProperty('durable_checkpoint');
  await restored.complete(settled(next)); const other = enqueue();
  expect((await bridge().claimNext()).claim.run.id).toBe(other);
  expect(nativeMessages[2]).not.toHaveProperty('durable_checkpoint'); expect(nativeCalls).toBe(3);
});

it('root completion cannot bypass child/tool/effect/output settlement or exact identity', async () => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  for (const field of ['toolsSettled', 'childrenSettled', 'effectsSettled', 'outputCommitted']) {
    await expect(executor.complete({ ...settled(row), [field]: false })).rejects.toMatchObject({ code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  }
  await expect(executor.complete({ ...settled(row), nativeRunId: 'sibling' })).rejects.toMatchObject({ code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  expect(f.store.run(id).status).toBe('running');
  expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
});

it('stale epoch blocks completion even with a local settled receipt', async () => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  f.db.exec('UPDATE lifecycle SET epoch=2');
  await expect(executor.complete(settled(row))).rejects.toMatchObject({ code: 'STALE_EPOCH' });
  expect(f.store.run(id).status).toBe('running');
  expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
});

it('production compatibility gate prevents even claiming a queued job', async () => {
  const id = enqueue();
  await expect(bridge(false).claimNext()).rejects.toMatchObject({ code: 'COMPATIBILITY_GATE_BLOCKED' });
  expect(nativeCalls).toBe(0); expect(f.store.run(id).status).toBe('queued');
  expect(f.db.all('SELECT * FROM attempts')).toHaveLength(0);
});

it('text-only completion sends the exact wire receipt, replays it, and rejects changed proof', async () => {
  const journal = new FileJournal(join(directory, 'text-only-bridge')), calls: any[] = [];
  const executor = new ExecutionBridge({ control: { request: async (type: string, payload: any) => { calls.push({ type, payload }); return {}; } },
    native: { admissionReadiness: () => ({ allowed: true }), submit: async () => ({}) }, journal, identity,
    installationId: 'synthetic-installation', personas: { [bot]: { agentId: 'assistant', model: 'model' } } });
  const attemptId = 'text-only-attempt', text = 'Exact verified answer', pin = {
    profile_version: 'codex-text-only-v1', profile_sha256: 'a'.repeat(64) };
  await journal.putIfAbsent(executor.cursor, { phase: 'running', identity, attemptId, nativeRunId: 'turn-1', nativeThreadId: 'thread-1',
    claim: { submission_key: `${randomUUID()}:1`, text_only: pin, run: { id: randomUUID(), current_attempt: 1 } } });
  const row: any = await journal.get(executor.cursor); row.claim.submission_key = `${row.claim.run.id}:1`; await journal.write(executor.cursor, row);
  const receipt = { ...pin, thread_id: 'thread-1', turn_id: 'turn-1', output_sha256: createHash('sha256').update(text).digest('hex') };
  const observation = { attemptId, nativeRunId: 'turn-1', rootSettled: true, toolsSettled: true, childrenSettled: true,
    effectsSettled: true, outputCommitted: true, result: { status: 'completed', text }, text_only_receipt: receipt };
  await executor.complete(observation); await executor.complete(observation);
  expect(calls).toEqual([{ type: 'complete', payload: { identity, run_id: row.claim.run.id, attempt: 1,
    result: observation.result, text_only_receipt: receipt } }]);
  await expect(executor.complete({ ...observation, text_only_receipt: { ...receipt, output_sha256: 'b'.repeat(64) } }))
    .rejects.toMatchObject({ code: 'TEXT_ONLY_RECEIPT_MISMATCH' });
});
