import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { RootChildEffects, type RootChildEffectIntent, type RootChildEffectResult } from '../src/core/root-child-effects';
import type { ContextSnapshot, RunStatus } from '../src/core/types';
import { fixture, bot, otherBot, routine } from './helpers';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, native: NativeTaskLedger, boundary: RootChildEffects;
let root: string, child: string, sibling: string, grandchild: string;
const policy = 'connector:calendar-write';
function context(id: string, patch: Partial<ContextSnapshot>) {
 const current = JSON.parse(f.store.run(id).context_json) as ContextSnapshot;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?', JSON.stringify({ ...current, ...patch }), id);
}
function status(id: string, value: RunStatus) { f.db.exec('UPDATE runs SET status=? WHERE id=?', value, id); }
function spawn(parent: string, persona = bot) {
 const ref = randomUUID();
 const run = native.register(identity, { parent_run_id: parent, parent_attempt: 1, persona_id: persona,
  native_run_ref: ref, native_session_key: `synthetic:${ref}`, title: 'Synthetic descendant' });
 life.submitted(identity, run.id, 1, ref); return run.id;
}
function intent(id = child): RootChildEffectIntent {
 return { identity, root_run_id: root, root_attempt: 1, resources: ['calendar:z', 'browser:a'],
  effect: { id: randomUUID(), run_id: id, attempt: 1, action_key: randomUUID(), classification: 'mutation',
   authorization_ref: policy, request_digest: 'synthetic-request-73', provider_idempotency_key: null } };
}
function result(input: RootChildEffectIntent, state: RootChildEffectResult['status'], receipt: RootChildEffectResult['receipt'] = null): RootChildEffectResult {
 return { identity: input.identity, root_run_id: input.root_run_id, root_attempt: input.root_attempt,
  run_id: input.effect.run_id, attempt: input.effect.attempt, effect_id: input.effect.id, status: state, receipt };
}
const locks = () => f.db.all('SELECT resource_id,run_id,attempt FROM resource_locks ORDER BY resource_id');
const effects = () => f.db.all('SELECT * FROM effects ORDER BY id');
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));

beforeEach(() => {
 f = fixture(true); life = new LifecycleCore(f.store, f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=7,lease_until='2026-09-10T00:02:00.000Z'");
 identity = life.registerBoot(randomUUID()); life.ready(identity);
 root = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic root' } }).resource_id!;
 expect(life.claim(identity)?.run.id).toBe(root); life.submitted(identity, root, 1, 'root-native-19');
 context(root, { authorization_policy_ids: [policy, 'root-only'] });
 native = new NativeTaskLedger(f.store, f.core, life);
 child = spawn(root); context(child, { authorization_policy_ids: [policy] });
 sibling = spawn(root); grandchild = spawn(child);
 boundary = new RootChildEffects(f.store, f.core, life);
});
afterEach(() => f.close());

it('retains only consumed lineage metadata after existing effect authority validation',()=>{
 const input=intent(grandchild);boundary.intent(input);
 for(const id of [root,child,grandchild]){
  const original=f.store.run(id).context_json;
  const snapshot=original.slice(0,-1)+`,"scope_key":${JSON.stringify(JSON.parse(original).scope_key)},"padding":"${'界'.repeat(400000)}"}`;
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const held=locks();
 // Inspect retained lineage, not SQL hydration: full ambiguous authority still
 // must be parsed before this metadata-only result can be trusted.
 const admitted=vi.spyOn(boundary as unknown as {admitted(...args:unknown[]):{lineage:unknown[]}},'admitted');
 try{
  boundary.transition(result(input,'outcome_unknown'));
  expect(admitted.mock.results[0].value.lineage.map((row:unknown)=>Object.keys(row as object).sort()))
   .toEqual(Array.from({length:3},()=>['current_attempt','id','status']));
  expect(admitted.mock.results[0].value.lineage).toEqual([grandchild,child,root].map(id=>({id,current_attempt:1,status:'running'})));
 }finally{admitted.mockRestore();}
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:'outcome_unknown'})]);
 expect(locks()).toEqual(held);
});

it.each(['intent','replay','outcome'] as const)('hydrates root authority once but parses independently during %s',mode=>{
 const input=intent(grandchild);if(mode!=='intent')boundary.intent(input);
 const original=f.store.run(root).context_json;
 const snapshot=original.slice(0,-1)+`,"scope_key":${JSON.stringify(JSON.parse(original).scope_key)},"padding":"${'界'.repeat(100000)}"}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,root);
 const read=vi.spyOn(f.db,'all'),parse=vi.spyOn(JSON,'parse');
 try{
  if(mode==='outcome')boundary.transition(result(input,'outcome_unknown'));else boundary.intent(input);
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{id?:string;context_json?:string}>;
  expect(rows.filter(row=>row.id===root&&'context_json' in row)).toHaveLength(1);
  // Do not reuse the parsed object: JS reference equality remains independent.
  expect(parse.mock.calls.filter(([text])=>text===snapshot)).toHaveLength(2);
 }finally{parse.mockRestore();read.mockRestore();}
 expect(f.store.run(root).context_json).toBe(snapshot);
});

it('omits admission byte-count work from existing replay and late-outcome authority SQL',()=>{
 const input=intent(grandchild);boundary.intent(input);boundary.transition(result(input,'outcome_unknown'));
 const snapshots=new Map<string,string>();
 for(const id of [root,child,grandchild]){
  const original=f.store.run(id).context_json;
  const snapshot=original.slice(0,-1)+`,"scope_key":${JSON.stringify(JSON.parse(original).scope_key)},"padding":"${'界'.repeat(400000)}"}`;
  snapshots.set(id,snapshot);f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const held=locks(),read=vi.spyOn(f.db,'all');
 try{
  expect(boundary.intent(input).status).toBe('outcome_unknown');
  boundary.transition(result(input,'confirmed',{evidence:'no-unused-byte-inspection'}));
  const queries=read.mock.calls.filter(([sql])=>sql.includes('AS authority_bytes'));
  expect(queries.length).toBeGreaterThan(0);
  for(const [sql] of queries)expect(sql).not.toContain('length(CAST(context_json AS BLOB))');
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{authority_bytes?:number}>;
  expect(rows.filter(row=>'authority_bytes' in row).every(row=>row.authority_bytes===0)).toBe(true);
 }finally{read.mockRestore();}
 rejects(()=>boundary.intent(intent(grandchild)),'CONTEXT_PREPARATION_LIMIT');
 rejects(()=>boundary.intent({...input,effect:{...input.effect,request_digest:'different'}}),'IDEMPOTENCY_CONFLICT');
 for(const [id,snapshot] of snapshots)expect(f.store.run(id).context_json).toBe(snapshot);
 expect(locks()).toEqual(held);
});

it.each(['x','界'])('bounds aggregate new-action authority hydration at 4MiB (%s) without restricting existing effects',unit=>{
 const parent=spawn(grandchild),leaf=spawn(parent),input=intent(leaf);boundary.intent(input);
 const snapshots=new Map<string,string>();
 // Each of five rows is read once: 3*1MiB + (1MiB-2048) + 2048 = 4MiB.
 for(const [id,size] of [[root,1048576],[child,1048576],[grandchild,1048576],[parent,1046528],[leaf,2048]] as const){
  const original=f.store.run(id).context_json;
  const empty=original.slice(0,-1)+`,"scope_key":${JSON.stringify(JSON.parse(original).scope_key)},"padding":""}`;
  const remaining=size-Buffer.byteLength(empty),width=Buffer.byteLength(unit);
  const snapshot=empty.slice(0,-2)+unit.repeat(Math.floor(remaining/width))+'x'.repeat(remaining%width)+'"}';
  expect(Buffer.byteLength(snapshot)).toBe(size);snapshots.set(id,snapshot);
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 expect(boundary.intent(intent(leaf)).status).toBe('intent');
 const over=snapshots.get(parent)!.slice(0,-2)+'x"}';snapshots.set(parent,over);
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',over,parent);
 const before=effects(),held=locks(),read=vi.spyOn(f.db,'all');
 try{
  rejects(()=>boundary.intent(intent(leaf)),'CONTEXT_PREPARATION_LIMIT');
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{id?:string;context_json?:string|null}>;
  const bodies=rows.filter(row=>'context_json' in row);
  expect(bodies.filter(row=>row.context_json===null)).toEqual([expect.objectContaining({id:child})]);
  expect(bodies.reduce((bytes,row)=>bytes+(typeof row.context_json==='string'?Buffer.byteLength(row.context_json):0),0)).toBe(3145729);
 }finally{read.mockRestore();}
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
 expect(boundary.intent(input).id).toBe(input.effect.id);
 boundary.transition(result(input,'outcome_unknown'));
 expect(boundary.intent(input).status).toBe('outcome_unknown');
 rejects(()=>boundary.intent({...input,effect:{...input.effect,request_digest:'different'}}),'IDEMPOTENCY_CONFLICT');
 boundary.transition(result(input,'confirmed',{evidence:'retained-aggregate-custody'}));
 for(const [id,snapshot] of snapshots)expect(f.store.run(id).context_json).toBe(snapshot);
 expect(locks()).toEqual(held);
});

it.each(['x','界','😀'])('bounds new-action fallback hydration at 1MiB UTF-8 (%s) without blocking existing custody',unit=>{
 const input=intent(grandchild);boundary.intent(input);
 const base=f.store.run(root).context_json;
 const scope=JSON.parse(base).scope_key;
 // A duplicate selected key intentionally exercises the original JS fallback.
 const empty=base.slice(0,-1)+`,"scope_key":${JSON.stringify(scope)},"padding":""}`;
 const bytes=1048576-Buffer.byteLength(empty),width=Buffer.byteLength(unit);
 const padding=unit.repeat(Math.floor(bytes/width))+'x'.repeat(bytes%width);
 const exact=empty.slice(0,-2)+padding+'"}',over=empty.slice(0,-2)+padding+'x"}';
 expect(Buffer.byteLength(exact)).toBe(1048576);expect(Buffer.byteLength(over)).toBe(1048577);
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',exact,root);
 expect(boundary.intent(intent(grandchild)).status).toBe('intent');
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',over,root);
 const before=effects(),held=locks(),read=vi.spyOn(f.db,'all');
 try{
  rejects(()=>boundary.intent(intent(grandchild)),'CONTEXT_PREPARATION_LIMIT');
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{id?:string;context_json?:string|null}>;
  expect(rows.filter(row=>row.id===root&&'context_json' in row)).toEqual([expect.objectContaining({context_json:null})]);
 }finally{read.mockRestore();}
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
 // Attempt authorization retains precedence over overflow.
 rejects(()=>boundary.intent({...intent(grandchild),root_attempt:2}),'REVISION_CONFLICT');
 expect(boundary.intent(input).id).toBe(input.effect.id);
 boundary.transition(result(input,'outcome_unknown'));
 expect(boundary.intent(input).status).toBe('outcome_unknown');
 rejects(()=>boundary.intent({...input,effect:{...input.effect,request_digest:'different'}}),'IDEMPOTENCY_CONFLICT');
 boundary.transition(result(input,'confirmed',{evidence:'retained-oversized-fallback'}));
 expect(f.store.run(root).context_json).toBe(over);expect(locks()).toEqual(held);
});

it.each(['root-policy','selected-policy','intermediate-fallback','selected-fallback'])('refuses oversized %s before hydration without changing custody',kind=>{
 const id=kind==='root-policy'?root:kind==='intermediate-fallback'?child:grandchild;
 const original=f.store.run(id).context_json,parsed=JSON.parse(original),padding='界'.repeat(400000);
 const snapshot=kind.endsWith('policy')?JSON.stringify({...parsed,authorization_policy_ids:[policy,padding]}):
  original.slice(0,-1)+`,"scope_key":${JSON.stringify(parsed.scope_key)},"padding":"${padding}"}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 const before=effects(),held=locks(),read=vi.spyOn(f.db,'all');
 try{
  rejects(()=>boundary.intent(intent(grandchild)),'CONTEXT_PREPARATION_LIMIT');
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{id?:string;context_json?:string|null}>;
  expect(rows.filter(row=>row.id===id&&'context_json' in row)).toEqual([expect.objectContaining({context_json:null})]);
 }finally{read.mockRestore();}
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);expect(f.store.run(id).context_json).toBe(snapshot);
});

it.each(['array','duplicates','object'] as const)('omits unused intermediate %s policies during intent without changing root/child grants',shape=>{
 const original=f.store.run(child).context_json,padding='界'.repeat(400000)+'\n';
 let snapshot=JSON.stringify({...JSON.parse(original),authorization_policy_ids:shape==='object'?{padding}:[padding]});
 if(shape==='duplicates')snapshot=snapshot.slice(0,-1)+',"authorization_policy_ids":[]}';
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 const read=vi.spyOn(f.db,'all');
 try{
  expect(boundary.intent(intent(grandchild)).status).toBe('intent');
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{id?:string;context_json?:string}>;
  const bodies=rows.filter(row=>row.id===child&&typeof row.context_json==='string');
  expect(bodies.length).toBeGreaterThan(0);
  for(const row of bodies){
   expect(Buffer.byteLength(row.context_json!)).toBeLessThan(8192);
   expect(JSON.parse(row.context_json!)).not.toHaveProperty('authorization_policy_ids');
  }
 }finally{read.mockRestore();}
 expect(f.store.run(child).context_json).toBe(snapshot);
 const before=effects(),held=locks();
 context(root,{authorization_policy_ids:[]});
 rejects(()=>boundary.intent(intent(grandchild)),'FORBIDDEN');
 context(root,{authorization_policy_ids:[policy]});context(grandchild,{authorization_policy_ids:[]});
 rejects(()=>boundary.intent(intent(grandchild)),'FORBIDDEN');
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
});

it.each(['array','duplicates','object'] as const)('omits unused %s policy bodies from late outcomes without relaxing intent authority',shape=>{
 const input=intent(grandchild);boundary.intent(input);
 const padding='界'.repeat(400000)+'\n',snapshots=new Map<string,string>();
 for(const id of [root,child,grandchild]){
  let snapshot=JSON.stringify({...JSON.parse(f.store.run(id).context_json),authorization_policy_ids:shape==='object'?{padding}:[padding]});
  if(shape==='duplicates')snapshot=snapshot.slice(0,-1)+',"authorization_policy_ids":[]}';
  snapshots.set(id,snapshot);f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const held=locks(),read=vi.spyOn(f.db,'all');
 try{
  boundary.transition(result(input,'outcome_unknown'));
  boundary.transition(result(input,'confirmed',{evidence:'late-policy-independent-outcome'}));
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{context_json?:string}>;
  const bodies=rows.filter(row=>typeof row.context_json==='string');expect(bodies.length).toBeGreaterThan(0);
  for(const row of bodies){
   expect(Buffer.byteLength(row.context_json!)).toBeLessThan(8192);
   expect(JSON.parse(row.context_json!)).not.toHaveProperty('authorization_policy_ids');
  }
 }finally{read.mockRestore();}
 const before=effects();
 rejects(()=>boundary.intent(intent(grandchild)),'CONTEXT_PREPARATION_LIMIT');
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
 for(const [id,snapshot] of snapshots)expect(f.store.run(id).context_json).toBe(snapshot);
 // Below the preparation ceiling the original malformed/denied semantics remain.
 for(const id of [root,child,grandchild]){
  const small={...JSON.parse(snapshots.get(id)!),authorization_policy_ids:shape==='object'?{}:[]};
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(small),id);
 }
 if(shape==='object')expect(()=>boundary.intent(intent(grandchild))).toThrow(TypeError);
 else rejects(()=>boundary.intent(intent(grandchild)),'FORBIDDEN');
});

it.each([
 {field:'persona',value:`{"id":"foreign","id":"${bot}"}`,allowed:true},
 {field:'persona',value:`{"id":"${bot}","id":"foreign"}`,allowed:false},
 {field:'persona',value:`{"\\u0069d":"${bot}"}`,allowed:true},
 {field:'persona',value:`{"id\\u0000":"foreign","id":"${bot}"}`,allowed:true},
 {field:'persona',value:`{"id\\u0000":"${bot}","id":"foreign"}`,allowed:false},
 {field:'persona',value:'{"id":null}',allowed:false},
 {field:'routine',value:'{"id":"foreign","id":null}',allowed:true},
 {field:'routine',value:'{"id":null,"id":"foreign"}',allowed:false},
 {field:'routine',value:'{}',allowed:true},
 {field:'routine',value:'{"id":null}',allowed:true},
])('preserves nested $field representation $value',({field,value,allowed})=>{
 const existing=intent();boundary.intent(existing);
 const fields=JSON.parse(f.store.run(child).context_json);delete fields[field];
 const snapshot=JSON.stringify(fields).slice(0,-1)+`,"${field}":${value}}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 const fresh=intent();fresh.resources=[];fresh.effect.classification='read_only';
 if(allowed){expect(boundary.intent(fresh).status).toBe('intent');boundary.transition(result(existing,'outcome_unknown'));}
 else{
  const before=effects(),held=locks();
  rejects(()=>boundary.intent(fresh),'FORBIDDEN');
  rejects(()=>boundary.transition(result(existing,'outcome_unknown')),'FORBIDDEN');
  expect(effects()).toEqual(before);expect(locks()).toEqual(held);
 }
 expect(f.store.run(child).context_json).toBe(snapshot);
});

it.each(['persona','routine'].flatMap(field=>['intent','outcome'].map(mode=>({field,mode}))))('projects $field body during child $mode',({field,mode})=>{
 if(field==='routine'){
  const scheduled=routine({enabled:false});f.store.put(scheduled.id,'routine',scheduled,0,'owner',f.core.now());
  for(const id of [root,child,grandchild]){
   f.db.exec('UPDATE runs SET routine_id=? WHERE id=?',scheduled.id,id);
   context(id,{routine:f.store.get(scheduled.id,'routine'),scope_key:`${bot}/routine/${scheduled.id}`});
  }
 }
 const input=intent(grandchild);if(mode==='outcome')boundary.intent(input);
 const snapshots=new Map<string,string>();
 for(const id of mode==='intent'?[root,child]:[root,child,grandchild]){
  const parsed=JSON.parse(f.store.run(id).context_json);
  parsed[field].body={padding:'界'.repeat(400000)+'\n"\\\ud800'};
  const snapshot=JSON.stringify(parsed);snapshots.set(id,snapshot);
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const read=vi.spyOn(f.db,'all');
 try{
  if(mode==='intent')expect(boundary.intent(input).status).toBe('intent');
  else boundary.transition(result(input,'outcome_unknown'));
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{context_json?:string}>;
  const bodies=rows.filter(row=>typeof row.context_json==='string');expect(bodies.length).toBeGreaterThan(0);
  for(const row of bodies)expect(Buffer.byteLength(row.context_json!)).toBeLessThan(8192);
 }finally{read.mockRestore();}
 for(const [id,snapshot] of snapshots)expect(f.store.run(id).context_json).toBe(snapshot);
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:mode==='intent'?'intent':'outcome_unknown'})]);
 expect(locks()).toHaveLength(2);
});

it.each(['room_id','scope_key','persona','authorization_policy_ids'])('preserves escaped authority key %s',key=>{
 const input=intent();boundary.intent(input);
 const snapshot=f.store.run(child).context_json.replace(`"${key}":`,`"\\u${key.charCodeAt(0).toString(16).padStart(4,'0')}${key.slice(1)}":`);
 expect(snapshot).toContain('\\u');
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 expect(boundary.intent(input)).toEqual({id:input.effect.id,status:'intent'});
 boundary.transition(result(input,'outcome_unknown'));
 expect(f.store.run(child).context_json).toBe(snapshot);
});

it.each([false,true])('keeps last-key authority with escaped duplicate room key (allowed=%s)',allowed=>{
 const input=intent();boundary.intent(input);
 const original=JSON.stringify({...JSON.parse(f.store.run(child).context_json),room_id:allowed?'foreign':null});
 const snapshot=original.replace('"room_id":','"\\u0072oom_id":').slice(0,-1)+`,"room_id":${allowed?'null':'"foreign"'}}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 if(allowed)boundary.transition(result(input,'outcome_unknown'));
 else rejects(()=>boundary.transition(result(input,'outcome_unknown')),'FORBIDDEN');
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:allowed?'outcome_unknown':'intent'})]);
 expect(f.store.run(child).context_json).toBe(snapshot);
});

it.each([false,true])('does not confuse NUL-suffixed room keys with authority (allowed=%s)',allowed=>{
 const input=intent();boundary.intent(input);
 const fields=JSON.parse(f.store.run(child).context_json);delete fields.room_id;
 const snapshot=JSON.stringify(fields).slice(0,-1)+`,"room_id\\u0000":${allowed?'"foreign"':'null'},"room_id":${allowed?'null':'"foreign"'}}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 if(allowed)boundary.transition(result(input,'outcome_unknown'));
 else rejects(()=>boundary.transition(result(input,'outcome_unknown')),'FORBIDDEN');
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:allowed?'outcome_unknown':'intent'})]);
 expect(f.store.run(child).context_json).toBe(snapshot);
});

it.each(['escape','duplicate','number','null','nul'] as const)('retains original authority representation for %s fallback',kind=>{
 const input=intent();boundary.intent(input);
 const original=f.store.run(child).context_json;
 const snapshot=kind==='escape'?original.replace('/personal','\\u002fpersonal'):
  kind==='duplicate'?original.slice(0,-1)+',"room_id":null}':
  kind==='number'?JSON.stringify({...JSON.parse(original),room_id:0}):kind==='null'?'null':original+'\u0000ignored';
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 const read=vi.spyOn(f.db,'all');
 try{
  if(kind==='number')rejects(()=>boundary.transition(result(input,'outcome_unknown')),'FORBIDDEN');
  else if(kind==='null'||kind==='nul')expect(()=>boundary.transition(result(input,'outcome_unknown'))).toThrow(kind==='null'?TypeError:SyntaxError);
  else boundary.transition(result(input,'outcome_unknown'));
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{context_json?:string}>;
  expect(rows.some(row=>row.context_json===snapshot)).toBe(true);
 }finally{read.mockRestore();}
 expect(f.store.run(child).context_json).toBe(snapshot);
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:kind==='escape'||kind==='duplicate'?'outcome_unknown':'intent'})]);
});

it.each(['intent','outcome'].flatMap(mode=>[false,true].map(escaped=>({mode,escaped}))))('projects irrelevant context bodies during child $mode (escaped=$escaped)',({mode,escaped})=>{
 const input=intent(grandchild);
 if(mode==='outcome')boundary.intent(input);
 const snapshots=new Map<string,string>();
 for(const id of mode==='intent'?[root,child]:[root,child,grandchild]){
  const snapshot=JSON.stringify({...JSON.parse(f.store.run(id).context_json),memories:[{body:'界'.repeat(400000)+(escaped?'\n"\\\ud800':'')}]});
  expect(snapshot.includes('\\')).toBe(escaped);
  snapshots.set(id,snapshot);f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const read=vi.spyOn(f.db,'all');
 try{
  if(mode==='intent')expect(boundary.intent(input).status).toBe('intent');
  else boundary.transition(result(input,'outcome_unknown'));
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]) as Array<{context_json?:string}>;
  const contexts=rows.filter(row=>typeof row.context_json==='string');
  expect(contexts.length).toBeGreaterThan(0);
  for(const row of contexts)expect(Buffer.byteLength(row.context_json!)).toBeLessThan(8192);
 }finally{read.mockRestore();}
 for(const [id,snapshot] of snapshots)expect(f.store.run(id).context_json).toBe(snapshot);
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,status:mode==='intent'?'intent':'outcome_unknown'})]);
 expect(locks()).toHaveLength(2);
});

it.each(['room_id','scope_key','persona'] as const)('keeps last-key %s authority for admission and late outcomes',field=>{
 const input=intent();boundary.intent(input);
 const original=f.store.run(child).context_json;
 const good=field==='room_id'?'null':field==='scope_key'?JSON.stringify(`${bot}/personal`):`{"id":"${otherBot}","id":"${bot}"}`;
 const bad=field==='room_id'?'"foreign"':field==='scope_key'?'"foreign"':`{"id":"${bot}","id":"${otherBot}"}`;
 for(const allowed of [false,true]){
  const snapshot=original.slice(0,-1)+`,"${field}":${allowed?bad:good},"${field}":${allowed?good:bad}}`;
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
  const fresh=intent();fresh.resources=[];fresh.effect.classification='read_only';
  if(allowed){
   expect(boundary.intent(fresh).status).toBe('intent');
   boundary.transition(result(input,'outcome_unknown'));
  }else{
   const before=effects(),held=locks();
   rejects(()=>boundary.intent(fresh),'FORBIDDEN');
   rejects(()=>boundary.transition(result(input,'outcome_unknown')),'FORBIDDEN');
   expect(effects()).toEqual(before);expect(locks()).toEqual(held);
  }
  expect(f.store.run(child).context_json).toBe(snapshot);
 }
});

it.each([
 {rootRoom:'{}',childRoom:'{}',scope:'room/[object Object]',allowed:false},
 {rootRoom:'[]',childRoom:'[]',scope:'room/',allowed:false},
 {rootRoom:'false',childRoom:'0',scope:'personal',allowed:false},
 {rootRoom:'-0',childRoom:'0',scope:'personal',allowed:true},
 {rootRoom:'1e999',childRoom:'1e999',scope:'room/Infinity',allowed:true},
])('preserves JS room equality/coercion ($rootRoom vs $childRoom)',({rootRoom,childRoom,scope,allowed})=>{
 const input=intent();boundary.intent(input);
 for(const [id,room] of [[root,rootRoom],[child,childRoom]]){
  const fields=JSON.parse(f.store.run(id).context_json);delete fields.room_id;delete fields.scope_key;
  const original=JSON.stringify(fields);
  const snapshot=original.slice(0,-1)+`,"room_id":${room},"scope_key":${JSON.stringify(`${bot}/${scope}`)}}`;
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,id);
 }
 const fresh=intent();fresh.resources=[];fresh.effect.classification='read_only';
 const before=effects(),held=locks();
 if(allowed){
  expect(boundary.intent(fresh).status).toBe('intent');
  boundary.transition(result(input,'outcome_unknown'));
 }else{
  rejects(()=>boundary.intent(fresh),'FORBIDDEN');
  rejects(()=>boundary.transition(result(input,'outcome_unknown')),'FORBIDDEN');
  expect(effects()).toEqual(before);
 }
 expect(locks()).toEqual(held);
});

it('bounds new intent ancestry at 64 runs without blocking deeper existing outcomes',()=>{
 let parent=root,first='';
 for(let depth=2;depth<=64;depth++){parent=spawn(parent);if(depth===2)first=parent;}
 const allowed=intent(parent);allowed.resources=[];allowed.effect.classification='read_only';
 expect(boundary.intent(allowed).status).toBe('intent');
 // Admit on a short path, then retain the same exact task/attempt custody in a
 // deeper historical tree. Existing records must remain reconcilable.
 const legacy=spawn(root),existing=intent(legacy);existing.resources=[];existing.effect.classification='read_only';
 boundary.intent(existing);
 f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?',parent,legacy);
 f.db.exec('UPDATE native_task_links SET parent_run_id=? WHERE run_id=?',parent,legacy);
 const pending=intent(legacy);pending.resources=[];pending.effect.classification='read_only';
 const before=effects(),held=locks(),authorize=vi.spyOn(life,'authorizeAttempt');
 try{
  rejects(()=>boundary.intent(pending),'ANCESTRY_PREPARATION_LIMIT');
  // Root custody plus no more than 64 lineage attempts are authorized.
  expect(authorize.mock.calls.length).toBeLessThanOrEqual(65);
 }finally{authorize.mockRestore();}
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
 expect(boundary.intent(existing)).toEqual({id:existing.effect.id,status:'intent'});
 boundary.transition(result(existing,'outcome_unknown'));
 expect(boundary.intent(existing)).toEqual({id:existing.effect.id,status:'outcome_unknown'});
 boundary.transition(result(existing,'confirmed',{evidence:'retained-deep-custody'}));
 expect(effects()).toEqual(expect.arrayContaining([expect.objectContaining({id:existing.effect.id,status:'confirmed'})]));
 rejects(()=>boundary.intent({...pending,effect:{...pending.effect,action_key:allowed.effect.action_key}}),'IDEMPOTENCY_CONFLICT');
 // The existing-key exception is not a shortcut around the 65th ancestor.
 f.db.exec('UPDATE native_task_links SET parent_attempt=2 WHERE run_id=?',first);
 rejects(()=>boundary.intent(existing),'STALE_EPOCH');
 rejects(()=>boundary.transition(result(existing,'confirmed',{evidence:'retained-deep-custody'})),'STALE_EPOCH');
});

it.each([false,true])('omits retained receipt during expired child replay (conflict=%s)',conflict=>{
 const input=intent(grandchild);boundary.intent(input);
 const receipt={evidence:'界'.repeat(400000)};
 boundary.transition(result(input,'outcome_unknown',receipt));
 f.db.exec('UPDATE attempts SET deadline_at=?',f.core.now());
 const before=effects(),held=locks(),read=vi.spyOn(f.db,'all');
 try{
  const replay={...input,effect:{...input.effect,request_digest:conflict?'different-request':input.effect.request_digest}};
  if(conflict)rejects(()=>boundary.intent(replay),'IDEMPOTENCY_CONFLICT');
  else expect(boundary.intent(replay)).toEqual({id:input.effect.id,status:'outcome_unknown'});
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]);
  expect(rows.some(row=>Object.prototype.hasOwnProperty.call(row,'receipt_json'))).toBe(false);
 }finally{read.mockRestore();}
 expect(effects()).toEqual(before);expect(locks()).toEqual(held);
});

it.each(['intent','replay','outcome'] as const)('omits ancestor checkpoints during child effect %s',mode=>{
 const input=intent(grandchild);
 if(mode!=='intent')boundary.intent(input);
 const checkpoint=JSON.stringify({padding:'界'.repeat(400000)});
 for(const id of [root,child,grandchild])f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?',checkpoint,id);
 const read=vi.spyOn(f.db,'all');
 try{
  if(mode==='outcome')boundary.transition(result(input,'outcome_unknown'));
  else expect(boundary.intent(input)).toEqual({id:input.effect.id,status:'intent'});
  const rows=read.mock.results.flatMap(entry=>entry.type==='return'?entry.value:[]);
  expect(rows.some(row=>Object.prototype.hasOwnProperty.call(row,'checkpoint_json'))).toBe(false);
 }finally{read.mockRestore();}
 for(const id of [root,child,grandchild])expect(f.store.run(id).checkpoint_json).toBe(checkpoint);
 expect(effects()).toEqual([expect.objectContaining({id:input.effect.id,run_id:grandchild,status:mode==='outcome'?'outcome_unknown':'intent'})]);
 expect(locks()).toHaveLength(2);
});

it('reuses the selected child policy parse and omits unused policies during reconciliation', () => {
 const stored=f.store.run(child).context_json;
 const snapshot=stored.slice(0,-1)+`,"padding":"${'x'.repeat(1000000)}","authorization_policy_ids":[],"authorization_policy_ids":["${policy}"]}`;
 expect(Buffer.byteLength(snapshot)).toBeLessThan(1048576);
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 const input=intent(),parse=vi.spyOn(JSON,'parse');
 try{
  expect(boundary.intent(input)).toEqual({id:input.effect.id,status:'intent'});
  // One boundary parse plus the independent EffectLedger authorization parse.
  expect(parse.mock.calls.filter(([text])=>text===snapshot)).toHaveLength(2);
  parse.mockClear();
  boundary.transition(result(input,'outcome_unknown'));
  expect(parse.mock.calls.filter(([text])=>text===snapshot)).toHaveLength(0);
 }finally{parse.mockRestore();}
 expect(f.store.run(child).context_json).toBe(snapshot);
 expect(effects()).toEqual([expect.objectContaining({run_id:child,status:'outcome_unknown'})]);
 expect(locks()).toHaveLength(2);
});

it('refuses oversized new child intent without losing existing effect outcome custody',()=>{
 const existing=intent();boundary.intent(existing);
 const stored=f.store.run(child).context_json;
 const snapshot=stored.slice(0,-1)+`,"padding":"${'界'.repeat(400000)}"}`;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',snapshot,child);
 const pending=intent();pending.resources=['calendar:new'];
 const held=locks(),before=effects();
 rejects(()=>boundary.intent(pending),'CONTEXT_PREPARATION_LIMIT');
 expect(locks()).toEqual(held);expect(effects()).toEqual(before);
 boundary.transition(result(existing,'outcome_unknown'));
 expect(effects()).toEqual([expect.objectContaining({id:existing.effect.id,status:'outcome_unknown'})]);
 expect(locks()).toEqual(held);expect(f.store.run(child).context_json).toBe(snapshot);
});

it('checks child attempt custody before parsing a null historical context', () => {
 f.db.exec("UPDATE runs SET context_json='null' WHERE id=?",child);
 f.db.exec('UPDATE attempts SET boot_id=? WHERE run_id=?',randomUUID(),child);
 rejects(()=>boundary.intent(intent()),'STALE_EPOCH');
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});

it('records child-owned intent and canonical locks after root completion; envelope binds original custody and request', () => {
 life.complete(identity, root, 1, { status: 'completed', text: 'Root result is not descendant settlement' });
 const input = intent(grandchild);
 const receipt = boundary.intent(input);
 expect(receipt).toEqual({ id: input.effect.id, status: 'intent' });
 expect(locks()).toEqual(input.resources.slice().sort().map(resource_id => ({ resource_id, run_id: grandchild, attempt: 1 })));
 const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const expected = `root-child-v1:${sha([7, identity.boot_id, root, 1, grandchild, 1])}:${sha(['synthetic-request-73', ['browser:a', 'calendar:z']])}`;
 expect(f.db.all<{ request_digest: string }>('SELECT request_digest FROM effects')[0].request_digest).toBe(expected);
 expect(f.store.run(root).status).toBe('completed'); expect(f.store.run(child).status).toBe('running');
 rejects(() => life.prepareSleep(identity), 'SLEEP_DENIED');
});

it('allows only admissible root states and running selected children', () => {
 for (const value of ['claimed', 'running', 'finishing', 'completed'] as const) {
  status(root, value); const input = intent(); input.resources = []; input.effect.classification = 'read_only'; expect(boundary.intent(input).status).toBe('intent');
 }
 const before = effects();
 for (const value of ['queued', 'waiting', 'failed', 'cancelling', 'cancelled', 'recovery_required'] as const) {
  status(root, value); rejects(() => boundary.intent(intent()), 'REVISION_CONFLICT');
 }
 status(root, 'running');
 for (const value of ['claimed', 'finishing', 'completed', 'waiting', 'failed', 'cancelling', 'cancelled', 'recovery_required'] as const) {
  status(child, value); rejects(() => boundary.intent(intent()), 'REVISION_CONFLICT');
 }
 expect(effects()).toEqual(before); expect(locks()).toEqual([]);
});

it('requires policy in both stored snapshots, not current persona configuration, with a read-only exception', () => {
 const input = intent();
 input.effect.authorization_ref = 'root-only'; rejects(() => boundary.intent(input), 'FORBIDDEN');
 context(child, { authorization_policy_ids: ['child-only'] }); input.effect.authorization_ref = 'child-only';
 rejects(() => boundary.intent(input), 'FORBIDDEN');
 context(root, { authorization_policy_ids: [] }); input.effect.classification = 'read_only'; input.resources = [];
 expect(boundary.intent(input).status).toBe('intent'); expect(locks()).toEqual([]);
 const mutation = intent(); mutation.effect.classification = 'idempotent';
 context(root, { authorization_policy_ids: [policy] }); context(child, { authorization_policy_ids: [policy] });
 rejects(() => boundary.intent(mutation), 'INVALID_INPUT');
 mutation.effect.provider_idempotency_key = 'provider-key-31'; expect(boundary.intent(mutation).status).toBe('intent');
});

it('rejects root-as-subject, unrelated trees, cross-persona and changed room/routine scope', () => {
 rejects(() => boundary.intent(intent(root)), 'FORBIDDEN');
 f.core.options.delegations = { [bot]: [otherBot] };
 const delegated = spawn(root, otherBot); rejects(() => boundary.intent(intent(delegated)), 'FORBIDDEN');
 life.complete(identity, root, 1, { status: 'completed', text: 'Coordinator finished' });
 const otherRoot = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Unrelated root' } }).resource_id!;
 expect(life.claim(identity)?.run.id).toBe(otherRoot);
 const unrelated = spawn(otherRoot); rejects(() => boundary.intent(intent(unrelated)), 'FORBIDDEN');
 context(sibling, { room_id: randomUUID(), scope_key: 'another-room' }); rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN');
 context(child, { scope_key: 'another-routine' }); rejects(() => boundary.intent(intent(grandchild)), 'FORBIDDEN');
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});

it('requires exact epoch, boot, lease, selected attempt and unchanged ancestor attempt', () => {
 const input = intent(grandchild);
 rejects(() => boundary.intent({ ...input, identity: { ...identity, epoch: 8 } }), 'STALE_EPOCH');
 rejects(() => boundary.intent({ ...input, identity: { ...identity, boot_id: randomUUID() } }), 'STALE_EPOCH');
 rejects(() => boundary.intent({ ...input, effect: { ...input.effect, attempt: 2 } }), 'STALE_EPOCH');
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', child);
 rejects(() => boundary.intent(input), 'STALE_EPOCH'); f.db.exec('UPDATE runs SET current_attempt=1 WHERE id=?', child);
 f.db.exec('UPDATE attempts SET boot_id=? WHERE run_id=?', randomUUID(), child);
 rejects(() => boundary.intent(input), 'STALE_EPOCH'); f.db.exec('UPDATE attempts SET boot_id=? WHERE run_id=?', identity.boot_id, child);
 f.setNow(life.get().lease_until!); rejects(() => boundary.intent(input), 'STALE_EPOCH');
 expect(effects()).toEqual([]);
});

it('accepts same-task room and routine snapshots but not a personal-scope sibling', () => {
 const scheduled = routine({ enabled: false });
 f.store.put(scheduled.id, 'routine', scheduled, 0, 'owner', f.core.now());
 const roomId = randomUUID();
 f.store.put(roomId, 'room', { id: roomId, expected_revision: 0, name: 'Synthetic room', member_ids: [bot], default_responder_id: bot }, 0, 'owner', f.core.now());
 for (const [routineId, conversationId] of [[scheduled.id, null], [null, roomId]]) {
  for (const id of [root, child, grandchild]) {
   f.db.exec('UPDATE runs SET routine_id=? WHERE id=?', routineId, id);
   context(id, f.core.context(bot, 'Synthetic scoped read', routineId, conversationId));
  }
  const input = intent(grandchild); input.effect.classification = 'read_only'; input.resources = [];
  expect(boundary.intent(input).status).toBe('intent');
  rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN');
 }
 expect(effects()).toHaveLength(2); expect(locks()).toEqual([]);
});

it('rejects missing links, mismatched native attempts, cycles and cancelling intermediate ancestry', () => {
 status(child, 'cancelling'); rejects(() => boundary.intent(intent(grandchild)), 'REVISION_CONFLICT'); status(child, 'running');
 f.db.exec("UPDATE attempts SET native_run_ref='wrong-ref' WHERE run_id=?", grandchild);
 rejects(() => boundary.intent(intent(grandchild)), 'FORBIDDEN');
 f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?', child, child);
 f.db.exec('UPDATE native_task_links SET parent_run_id=? WHERE run_id=?', child, child);
 rejects(() => boundary.intent(intent()), 'FORBIDDEN');
 f.db.exec('DELETE FROM native_task_links WHERE run_id=?', sibling);
 rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN'); expect(effects()).toEqual([]);
});

it('canonical replay preserves original ID and conflicts on resource set, digest, child, classification and custody changes', () => {
 const input = intent(); const original = boundary.intent(input), before = effects(), held = locks();
 expect(boundary.intent({ ...input, resources: [...input.resources].reverse(), effect: { ...input.effect, id: randomUUID() } })).toEqual(original);
 for (const changed of [{ ...input, resources: ['browser:a'] }, { ...input, effect: { ...input.effect, request_digest: 'changed-request' } },
  { ...input, effect: { ...input.effect, run_id: sibling } }, { ...input, effect: { ...input.effect, classification: 'read_only' as const } },
  { ...input, effect: { ...input.effect, authorization_ref: 'root-only' } }, { ...input, effect: { ...input.effect, provider_idempotency_key: 'other' } }]) {
  rejects(() => boundary.intent(changed), 'IDEMPOTENCY_CONFLICT');
 }
 // Even if all current ancestry attempts are changed consistently, old custody is not reusable.
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', root);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,2,'new-root-key',?,?,'running','2026-09-10T00:20:00.000Z')", root, identity.epoch, identity.boot_id);
 f.db.exec('UPDATE native_task_links SET parent_attempt=2 WHERE parent_run_id=?', root);
 rejects(() => boundary.intent({ ...input, root_attempt: 2 }), 'IDEMPOTENCY_CONFLICT');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), root_attempt: 2 }), 'FORBIDDEN');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held);
});

it('new and intent-replay contention rolls back every partial lock and new effect', () => {
 const input = intent();
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, ['calendar:z']);
 const held = locks(); rejects(() => boundary.intent(input), 'RESOURCE_BUSY');
 expect(effects()).toEqual([]); expect(locks()).toEqual(held);
 new ResourceLedger(f.store, () => f.core.now()).release(sibling, 1, ['calendar:z']);
 boundary.intent(input); const before = effects();
 rejects(() => new ResourceLedger(f.store, () => f.core.now()).release(child, 1, input.resources), 'OUTCOME_UNKNOWN');
 // Simulate missing locks in legacy/restored state, not a permitted release.
 f.db.exec('DELETE FROM resource_locks WHERE run_id=?', child);
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, ['calendar:z']);
 const contended = locks(); rejects(() => boundary.intent(input), 'RESOURCE_BUSY');
 expect(effects()).toEqual(before); expect(locks()).toEqual(contended);
});

it.each(['root', 'parent', 'child'] as const)('cancelling %s after intent fences descendant dispatch without changing locks or unrelated work', target => {
 const input = intent(grandchild); boundary.intent(input);
 const held = locks(), before = effects(), other = f.store.run(sibling);
 const id = target === 'root' ? root : target === 'parent' ? child : grandchild;
 expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Stop selected task' } }).status).toBe('applied');
 rejects(() => boundary.transition(result(input, 'dispatched')), 'REVISION_CONFLICT');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held); expect(f.store.run(sibling)).toEqual(other);
 boundary.transition(result(input, 'failed', { reason: 'not-dispatched' }));
 expect(effects()).toEqual([expect.objectContaining({ status: 'failed' })]); expect(locks()).toEqual(held);
});

it('unknown and terminal replay never reacquire or release locks, even while cancellation/recovery is pending', () => {
 const input = intent(); boundary.intent(input); const held = locks();
 boundary.transition(result(input, 'dispatched'));
 status(root, 'recovery_required'); status(child, 'cancelling');
 boundary.transition(result(input, 'outcome_unknown', { reason: 'synthetic lost acknowledgement' }));
 expect(boundary.intent(input)).toEqual({ id: input.effect.id, status: 'outcome_unknown' }); expect(locks()).toEqual(held);
 rejects(() => life.complete(identity, child, 1, { status: 'cancelled', text: '' }), 'RESOURCE_BUSY');
 // Simulate legacy lock loss; replay must not take locks back or dispatch again.
 rejects(() => new ResourceLedger(f.store, () => f.core.now()).release(child, 1, input.resources), 'OUTCOME_UNKNOWN');
 f.db.exec('DELETE FROM resource_locks WHERE run_id=?', child);
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, input.resources);
 const differentOwner = locks(); expect(boundary.intent(input).status).toBe('outcome_unknown');
 rejects(() => boundary.transition(result(input, 'confirmed', {})), 'INVALID_INPUT');
 boundary.transition(result(input, 'confirmed', { destination_id: 'synthetic-receipt-97' }));
 const before = effects(); expect(boundary.intent({ ...input, effect: { ...input.effect, id: randomUUID() } })).toEqual({ id: input.effect.id, status: 'confirmed' });
 boundary.transition(result(input, 'confirmed', { ignored_duplicate: true }));
 expect(effects()).toEqual(before); expect(locks()).toEqual(differentOwner);
 expect(f.store.run(child).status).toBe('cancelling'); expect(f.store.run(root).status).toBe('recovery_required');
});

it('transition cannot target sibling, generic ledger records or stale attempts and keeps receipt validation', () => {
 const input = intent(grandchild); boundary.intent(input); const before = effects(), held = locks();
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), run_id: sibling }), 'FORBIDDEN');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), attempt: 2 }), 'STALE_EPOCH');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), identity: { ...identity, epoch: 8 } }), 'STALE_EPOCH');
 rejects(() => boundary.transition(result(input, 'confirmed', { not_a_valid_transition: true })), 'REVISION_CONFLICT');
 rejects(() => boundary.transition(result(input, 'failed')), 'INVALID_INPUT');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held);
 f.db.exec("UPDATE effects SET request_digest='generic-effect-digest' WHERE id=?", input.effect.id);
 rejects(() => boundary.transition(result(input, 'outcome_unknown')), 'FORBIDDEN');
});

it('deadline expiry denies new work but permits exact reconciliation with a current lease', () => {
 const input = intent(); boundary.intent(input);
 f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:20.000Z' WHERE run_id=?", root);
 f.setNow('2026-09-10T00:00:20.000Z');
 rejects(() => boundary.intent(intent(sibling)), 'DEADLINE_EXCEEDED');
 rejects(() => boundary.intent(input), 'DEADLINE_EXCEEDED');
 boundary.transition(result(input, 'outcome_unknown')); expect(boundary.intent(input).status).toBe('outcome_unknown');
 expect(locks()).toHaveLength(2);
});

it('invalid or duplicated resource sets and oversized digests never leave intent rows', () => {
 const input = intent();
 for (const resources of [[], ['same', 'same'], ['has space'], Array.from({ length: 9 }, (_, i) => `resource:${i}`)]) {
  rejects(() => boundary.intent({ ...input, resources }), 'INVALID_INPUT');
 }
 rejects(() => boundary.intent({ ...input, resources: [], effect: { ...input.effect, classification: 'idempotent', provider_idempotency_key: 'synthetic-key' } }), 'INVALID_INPUT');
 rejects(() => boundary.intent({ ...input, effect: { ...input.effect, request_digest: 'x'.repeat(257) } }), 'INVALID_INPUT');
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});
