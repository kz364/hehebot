import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture,bot,otherBot} from './helpers';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';
import {Store,type Database} from '../src/core/store';
import type {OwnerAlphaPolicy} from '../src/core/owner-alpha';
import {ownerAlphaManifestSha256,parseOwnerAlphaBootstrap,parseOwnerAlphaClaimedPreTurnQuarantine,type OwnerAlphaBootstrapConfig,type OwnerAlphaRetirement} from '../src/core/owner-alpha-bootstrap';
import {sendHostedOwnerWake} from '../src/worker/hosted-owner-wake';

function setup(overrides:Partial<OwnerAlphaBootstrapConfig>={}){
 const f=fixture(),original:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:1,max_task_seconds:45};
 let core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
 const lifecycle=new LifecycleCore(f.store,core),identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
 const send=(target=bot,key=randomUUID(),owner='owner')=>{
  const command={schema_version:1,type:'message.send',payload:{conversation_id:target,text:'fresh owner text'}};
  return core.accept(owner,key,createHash('sha256').update(JSON.stringify(command)).digest('hex'),command);
 };
 const old=send();lifecycle.claim(identity);
 f.setNow('2026-09-10T00:02:00.000Z');lifecycle.watchdog();
 const waiting=send();
 const retained=()=>JSON.stringify({old:f.store.run(old.resource_id!),waiting:f.store.run(waiting.resource_id!),attempts:f.db.all('SELECT * FROM attempts WHERE epoch=1'),custody:f.db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")});
 const before=retained();
 const config:OwnerAlphaBootstrapConfig={installation_id:'installation-test',owner_id:'owner',owner_binding_sha256:'a'.repeat(64),policy_revision:'trial-v1',persona_id:bot,
  text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},expires_at:'2026-09-10T00:20:00.000Z',session_seconds:180,max_task_seconds:37,
  prior_cost_micro_usd:137000,prior_cost_source:'operator-ledger-17',total_cap_micro_usd:10000000,reservation_micro_usd:3000000,...overrides};
 const reopen=(bootstrap:OwnerAlphaBootstrapConfig|null=config)=>{core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaBootstrap:bootstrap??undefined});core.ownerAlpha.initialize();return core;};
 reopen();
 const retirement:OwnerAlphaRetirement={...identity,session_id:original.session_id,transition_id:null,observed_at:core.now(),direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'trusted-test-observer'};
 const retire=()=>core.bootstrap.recordRetirement(retirement);
 return {...f,send,reopen,retire,retirement,config,retained,before,old,waiting,get core(){return core;},get lifecycle(){return new LifecycleCore(f.store,core);}};
}
function complete(f:ReturnType<typeof setup>){
 const manifest=f.core.bootstrap.assignedManifest()!,identity={epoch:manifest.epoch,boot_id:manifest.boot_id};
 f.lifecycle.registerBoot(identity.boot_id);f.lifecycle.ready(identity);
 const claim=f.lifecycle.claim(identity)!;
 expect(claim.run.id).toBe(manifest.run_id);
 f.lifecycle.submitted(identity,claim.run.id,1,'native-exact');
 f.lifecycle.coordinatorRelease(identity,claim.run.id,1,'native-exact','completed');
 f.lifecycle.complete(identity,claim.run.id,1,{status:'completed',text:'done'},
  {...manifest.text_only,thread_id:'thread-exact',turn_id:'native-exact',output_sha256:createHash('sha256').update('done').digest('hex')});
 f.setNow(manifest.expires_at);f.lifecycle.watchdog();
 return {...identity,session_id:manifest.session_id,transition_id:manifest.transition_id,observed_at:manifest.expires_at,direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'manager-test'} as const;
}

it('validates bootstrap generation authority without returning retained checkpoints',()=>{
 const f=setup();try{
  f.retire();const receipt=f.send();
  const original=f.store.run(receipt.resource_id!);
  const context=JSON.stringify({...JSON.parse(original.context_json),padding:'界'.repeat(400000)});
  const checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
  f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,original.id);
  const read=vi.spyOn(f.db,'all');
  try{
   expect(f.core.ownerAlpha.activeGeneration()?.epoch).toBe(2);
   const rows=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===original.id?read.mock.results[i].value:[]);
   expect(rows.length).toBeGreaterThan(0);
   for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
   expect(rows).toContainEqual({room_is_null:1});
   for(const row of rows.filter(row=>'command_id' in row))expect(Object.keys(row).sort()).toEqual(['command_id','occurrence_id','parent_run_id','persona_id','role','routine_id']);
  }finally{read.mockRestore();}
  expect(f.store.run(original.id)).toEqual({...original,context_json:context,checkpoint_json:checkpoint});
 }finally{f.close();}
});

it.each([
 ['{"room_id":null,"room_id":"foreign-room"}',false],
 ['{"room_id":"foreign-room","room_id":null}',true],
 ['{"room_id":false}',false],
 ['{}',false],
])('preserves strict bootstrap room authority: %s',(context,allowed)=>{
 const f=setup();try{
  f.retire();const receipt=f.send();
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',context,receipt.resource_id!);
  if(allowed)expect(f.core.ownerAlpha.activeGeneration()?.epoch).toBe(2);
  else expect(()=>f.core.ownerAlpha.activeGeneration()).toThrow('Message-bound generation differs');
 }finally{f.close();}
});

it('assigns only the exact fresh message, preserves old custody and reconstructs fixed expiry/reservation',()=>{
 const f=setup();try{
  f.retire();const key=randomUUID(),receipt=f.send(bot,key),m=f.core.bootstrap.assignedManifest()!;
  expect(receipt.status).toBe('applied');expect(m).toMatchObject({run_id:receipt.resource_id,command_id:receipt.id,epoch:2,issued_at:'2026-09-10T00:02:00.000Z',expires_at:'2026-09-10T00:05:00.000Z',reservation_micro_usd:3000000});
  expect(m.manifest_sha256).toBe(ownerAlphaManifestSha256(m));
  expect(f.lifecycle.nextClaimableRun()?.id).toBe(receipt.resource_id);
  expect(f.send(bot,key)).toEqual(receipt);
  const later=f.send();expect(f.store.run(later.resource_id!).status).toBe('waiting');
  expect(f.core.ownerAlpha.eligible(f.store.run(later.resource_id!))).toBe(false);
  expect(f.core.ownerAlpha.eligible(f.store.run(f.waiting.resource_id!))).toBe(false);
  const metadata=f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key");
  f.setNow('2026-09-10T00:02:19.000Z');f.reopen();
  expect(f.core.bootstrap.assignedManifest()).toEqual(m);expect(f.lifecycle.nextClaimableRun()?.id).toBe(receipt.resource_id);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key")).toEqual(metadata);
  expect(f.retained()).toBe(f.before);
  complete(f);f.reopen();expect(f.retained()).toBe(f.before);
 }finally{f.close();}
});

it.each(['absent','unknown child','busy execution lock','busy session lock','stale epoch','stale boot','stale time'] as const)('blocks %s retirement without adopting a waiting run',mode=>{
 const f=setup();try{
  if(mode!=='absent'){
   const report={...f.retirement,...(mode==='unknown child'?{direct_child_stopped:'unknown'}:mode==='busy execution lock'?{execution_lock_free:false}:mode==='busy session lock'?{session_lock_free:false}:mode==='stale epoch'?{epoch:0}:mode==='stale boot'?{boot_id:randomUUID()}:{observed_at:'2026-09-10T00:00:59.999Z'})};
   expect(()=>f.core.bootstrap.recordRetirement(report as OwnerAlphaRetirement)).toThrow();
  }
  const receipt=f.send();expect(f.store.run(receipt.resource_id!).status).toBe('waiting');expect(f.core.bootstrap.assignedManifest()).toBeUndefined();expect(f.lifecycle.nextClaimableRun()).toBeUndefined();
  f.retire();expect(f.core.bootstrap.assignedManifest()).toBeUndefined();expect(f.lifecycle.nextClaimableRun()).toBeUndefined();
  const fresh=f.send();expect(f.lifecycle.nextClaimableRun()?.id).toBe(fresh.resource_id);expect(f.retained()).toBe(f.before);
 }finally{f.close();}
});

it('requires trusted configuration and exact owner/persona; seed observation never comes from message contents',()=>{
 const f=setup();try{
  f.reopen(null);const off=f.send();expect(f.store.run(off.resource_id!).status).toBe('waiting');
  f.reopen({...f.config,seed_retirement:f.retirement});
  for(const receipt of [f.send(otherBot),f.send(bot,randomUUID(),'someone-else'),f.send(bot,randomUUID(),'runtime:fake')])expect(f.store.run(receipt.resource_id!).status).toBe('waiting');
  expect(f.core.bootstrap.assignedManifest()).toBeUndefined();
  const fresh=f.send();expect(f.lifecycle.nextClaimableRun()?.id).toBe(fresh.resource_id);
 }finally{f.close();}
});

it.each(['run','persona','hash','revision','epoch','event','expiry','reservation'] as const)('fails selector and reconstruction closed after %s binding tampering',field=>{
 const f=setup();try{
  f.retire();f.send();
  const row=f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_generation:2'")[0];
  const generation=JSON.parse(row.value_json),m=generation.authority.manifest;
  Object.assign(m,field==='run'?{run_id:f.waiting.resource_id}:field==='persona'?{persona_id:otherBot}:field==='hash'?{command_sha256:'f'.repeat(64)}:field==='revision'?{policy_revision:'other'}:field==='epoch'?{epoch:3}:field==='event'?{event_sequence:m.event_sequence+1}:field==='expiry'?{expires_at:'2026-09-10T00:06:00.000Z'}:{reservation_micro_usd:1});
  f.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_generation:2'",JSON.stringify(generation));
  expect(()=>f.lifecycle.nextClaimableRun()).toThrow();expect(()=>f.reopen()).toThrow();
 }finally{f.close();}
});

it('rechecks exact command and run custody during attempt authorization',()=>{
 const f=setup();try{
  f.retire();const receipt=f.send(),m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};
  f.lifecycle.registerBoot(m.boot_id);f.lifecycle.ready(id);f.lifecycle.claim(id);
  expect(()=>f.lifecycle.authorizeAttempt(id,m.run_id,1)).not.toThrow();
  f.db.exec('UPDATE commands SET body_hash=? WHERE id=?','changed',receipt.id);
  expect(()=>f.lifecycle.authorizeAttempt(id,m.run_id,1)).toThrow();
 }finally{f.close();}
});

it('requires settlement and exact current retirement, retains old unknown epoch and cumulative costs',()=>{
 const f=setup();try{
  f.retire();f.send();const m=f.core.bootstrap.assignedManifest()!;
  const report=complete(f);
  const blocked=f.send();expect(f.store.run(blocked.resource_id!).status).toBe('waiting');expect(f.core.bootstrap.assignedManifest()).toEqual(m);
  expect(()=>f.core.bootstrap.recordRetirement(f.retirement)).toThrow();
  f.core.bootstrap.recordRetirement(report);const second=f.send();expect(f.lifecycle.nextClaimableRun()?.id).toBe(second.resource_id);
  expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(3);expect(f.retained()).toBe(f.before);
  f.core.bootstrap.recordRetirement(complete(f));f.send();expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(4);
  f.core.bootstrap.recordRetirement(complete(f));const exhausted=f.send();
  expect(f.store.run(exhausted.resource_id!).status).toBe('waiting');expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(4);
  expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(3);
 }finally{f.close();}
});

it('unknown current work cannot roll over or refund its reservation even with trusted retirement',()=>{
 const f=setup();try{
  f.retire();f.send();const m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};
  f.lifecycle.registerBoot(m.boot_id);f.lifecycle.ready(id);f.lifecycle.claim(id);
  f.setNow(m.expires_at);f.lifecycle.watchdog();
  f.core.bootstrap.recordRetirement({...f.retirement,...id,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at});
  const later=f.send();expect(f.store.run(later.resource_id!).status).toBe('waiting');expect(f.core.bootstrap.assignedManifest()).toEqual(m);
  expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(1);
 }finally{f.close();}
});

it.each([2999999,3000000])('accounts for prior baseline at allowance boundary %i',remaining=>{
 const f=setup({total_cap_micro_usd:137000+remaining});try{
  f.retire();const receipt=f.send();expect(f.store.run(receipt.resource_id!).status).toBe(remaining===3000000?'queued':'waiting');
  expect(f.lifecycle.nextClaimableRun()?.id).toBe(remaining===3000000?receipt.resource_id:undefined);
 }finally{f.close();}
});

it('blocks mismatched cost baseline and bounds the final assignment by overall trial expiry',()=>{
 const f=setup({expires_at:'2026-09-10T00:05:07.000Z'});try{
  f.retire();f.send();const report=complete(f);f.core.bootstrap.recordRetirement(report);
  f.reopen({...f.config,prior_cost_source:'different-ledger'});const blocked=f.send();expect(f.store.run(blocked.resource_id!).status).toBe('waiting');
  f.reopen();f.send();expect(f.core.bootstrap.assignedManifest()?.expires_at).toBe('2026-09-10T00:05:07.000Z');
  f.core.bootstrap.recordRetirement(complete(f));const expired=f.send();expect(f.store.run(expired.resource_id!).status).toBe('waiting');
 }finally{f.close();}
});

it('parses default-off strict trusted configuration and refuses missing cost evidence',()=>{
 const f=setup();try{
  expect(parseOwnerAlphaBootstrap(undefined)).toBeUndefined();expect(parseOwnerAlphaBootstrap('')).toBeUndefined();
  expect(parseOwnerAlphaBootstrap(JSON.stringify(f.config))).toEqual(f.config);
  for(const value of [null,{}, {...f.config,prior_cost_source:''},{...f.config,prior_cost_micro_usd:undefined},{...f.config,reservation_micro_usd:0},{...f.config,session_seconds:301},{...f.config,seed_retirement:null},{...f.config,extra:true}])expect(()=>parseOwnerAlphaBootstrap(JSON.stringify(value))).toThrow();
 }finally{f.close();}
});

it('supports a moving acceptance clock and cannot assign an already applied historical message',()=>{
 const f=setup();try{
  f.retire();let tick=Date.parse(f.core.now());f.core.options.now=()=>new Date(tick++);
  const receipt=f.send(),m=f.core.bootstrap.assignedManifest()!;
  expect(m.run_id).toBe(receipt.resource_id);expect(f.lifecycle.nextClaimableRun()?.id).toBe(receipt.resource_id);
  const before=f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key");
  f.core.bootstrap.assignNewMessage('owner',f.waiting.id,f.waiting.resource_id!);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key")).toEqual(before);
 }finally{f.close();}
});

it.each([999,1000])('requires at least one second remaining before reserving (%ims)',remaining=>{
 const f=setup({expires_at:new Date(Date.parse('2026-09-10T00:02:00.000Z')+remaining).toISOString()});try{
  f.retire();const receipt=f.send();expect(f.store.run(receipt.resource_id!).status).toBe(remaining===1000?'queued':'waiting');
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(remaining===1000?1:0);
 }finally{f.close();}
});

it('persists sanitized failed-wake diagnostics without replay or changing retained custody',async()=>{
 const f=setup();try{
  f.retire();f.send();const m=f.core.bootstrap.assignedManifest()!;
  let calls=0;
  const send=(command:{epoch:number;operationId:string})=>sendHostedOwnerWake({url:'https://test.sprites.app'},command,'p'.repeat(40),'w'.repeat(40),async()=>{
   calls++;return new Response('secret upstream body',{status:503});
  });
  await expect(f.lifecycle.deliverOwnerAlphaWake(m.transition_id,send)).rejects.toMatchObject({code:'HOSTED_WAKE_OUTCOME_UNKNOWN'});
  const read=()=>f.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_wake:${m.epoch}`)[0].value_json;
  const saved=read();
  expect(JSON.parse(saved)).toEqual({epoch:m.epoch,boot_id:m.boot_id,transition_id:m.transition_id,status:'unknown',error_code:'HOSTED_WAKE_OUTCOME_UNKNOWN',request_phase:'response',upstream_status:503});
  expect(saved).not.toContain('secret');
  f.reopen();await f.lifecycle.deliverOwnerAlphaWake(m.transition_id,send);
  expect(calls).toBe(1);expect(read()).toBe(saved);expect(f.retained()).toBe(f.before);
  expect(f.core.bootstrap.assignedManifest()).toEqual(m);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(1);
 }finally{f.close();}
});

it('does not replace an unclaimed generation after uncertain wake, even with exact stop observations',async()=>{
 const f=setup();try{
  f.retire();f.send();const m=f.core.bootstrap.assignedManifest()!;
  await expect(f.lifecycle.deliverOwnerAlphaWake(m.transition_id,async()=>{throw new Error('uncertain transport');})).rejects.toThrow();
  f.setNow(m.expires_at);f.lifecycle.watchdog();
  f.core.bootstrap.recordRetirement({...f.retirement,epoch:m.epoch,boot_id:m.boot_id,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at});
  const fresh=f.send();expect(f.store.run(fresh.resource_id!).status).toBe('waiting');expect(f.core.bootstrap.assignedManifest()).toEqual(m);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(1);
 }finally{f.close();}
});

it('reopens disk-backed SQLite with identical assignment, expiry, reservation and old custody',async()=>{
 const f=setup(),dir=mkdtempSync(join(tmpdir(),'alpha-bootstrap-'));let disk:DatabaseSync|undefined;
 try{
  f.retire();const receipt=f.send(),manifest=f.core.bootstrap.assignedManifest(),options=f.core.options;
  const before=f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key"),old=f.store.run(f.old.resource_id!);
  const file=join(dir,'control.db');await backup(f.db.sqlite,file);
  disk=new DatabaseSync(file);disk.close();disk=new DatabaseSync(file);
  let depth=0;
  const db:Database={all:(sql,...values)=>disk!.prepare(sql).all(...values) as never,exec:(sql,...values)=>{disk!.prepare(sql).run(...values);},transaction:fn=>{
   const name=`reopen_${depth++}`;disk!.exec(`SAVEPOINT ${name}`);try{const result=fn();disk!.exec(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){disk!.exec(`ROLLBACK TO SAVEPOINT ${name}`);disk!.exec(`RELEASE SAVEPOINT ${name}`);throw error;}
  }};
  const core=new ControlCore(new Store(db),options);core.ownerAlpha.initialize();
  expect(core.bootstrap.assignedManifest()).toEqual(manifest);expect(new LifecycleCore(core.store,core).nextClaimableRun()?.id).toBe(receipt.resource_id);
  expect(db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha*' ORDER BY key")).toEqual(before);
  expect(core.store.run(f.old.resource_id!)).toEqual(old);
 }finally{disk?.close();f.close();rmSync(dir,{recursive:true,force:true});}
});

it('caps generation heartbeat leases at fixed session expiry without renewing admission',()=>{
 const f=setup();try{
  f.retire();f.send();const m=f.core.bootstrap.assignedManifest()!,identity={epoch:m.epoch,boot_id:m.boot_id};
  f.lifecycle.registerBoot(m.boot_id);f.lifecycle.ready(identity);
  expect(f.lifecycle.heartbeat(identity,[]).lease_until).toBe('2026-09-10T00:03:30.000Z');
  f.setNow('2026-09-10T00:03:29.000Z');f.lifecycle.heartbeat(identity,[]);
  f.setNow('2026-09-10T00:04:58.000Z');
  expect(f.lifecycle.heartbeat(identity,[]).lease_until).toBe(m.expires_at);
  f.setNow(m.expires_at);expect(()=>f.lifecycle.heartbeat(identity,[])).toThrow();
  f.lifecycle.watchdog();expect(f.lifecycle.get().phase).toBe('RECOVERY_REQUIRED');
  expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
 }finally{f.close();}
});

it('publishes only a read-only overall-trial summary and does not persist seed evidence on reads',()=>{
 const f=setup();try{
  expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
  f.reopen({...f.config,seed_retirement:f.retirement});
  const snapshot=()=>JSON.stringify({metadata:f.db.all('SELECT * FROM runtime_metadata ORDER BY key'),lifecycle:f.db.all('SELECT * FROM lifecycle'),events:f.db.all('SELECT * FROM events'),runs:f.db.all('SELECT * FROM runs')});
  const before=snapshot(),expected={policy_revision:'trial-v1',persona_id:bot,expires_at:f.config.expires_at,max_task_seconds:37,message_admission_available:true};
  expect(f.core.bootstrap.summary()).toEqual(expected);expect(f.core.state().summary.owner_alpha_bootstrap).toEqual(expected);
  expect(f.core.bootstrap.assignedManifest()).toBeUndefined();expect(snapshot()).toBe(before);
  f.send();expect(f.core.bootstrap.summary()).toEqual({...expected,message_admission_available:false});
  const report=complete(f);expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
  f.core.bootstrap.recordRetirement(report);expect(f.core.bootstrap.summary()?.message_admission_available).toBe(true);
  f.reopen({...f.config,total_cap_micro_usd:9000000});expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
  f.reopen();f.setNow(f.config.expires_at);expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
 }finally{f.close();}
});

async function unused(){
 const f=setup();f.retire();const key=randomUUID(),receipt=f.send(bot,key),prior=f.core.bootstrap.assignedManifest()!;
 await f.lifecycle.deliverOwnerAlphaWake(prior.transition_id,async()=>{}); // Accepted 202, not proof of staging.
 f.setNow(prior.expires_at);f.lifecycle.watchdog();
 const config:OwnerAlphaBootstrapConfig={...f.config,policy_revision:'recovery-v2',unused_recovery:{kind:'unused-before-staging-v1',installation_id:prior.installation_id,owner_binding_sha256:prior.owner_binding_sha256,
  predecessor:{manifest_sha256:prior.manifest_sha256,epoch:prior.epoch,boot_id:prior.boot_id,transition_id:prior.transition_id,session_id:prior.session_id,run_id:prior.run_id},
  evidence:{sha256:'d'.repeat(64),observed_at:prior.expires_at,source:'exclusive-fsynced-transition-marker'},successor_policy_revision:'recovery-v2',expires_at:'2026-09-10T00:05:43.000Z'}};
 return {f,key,receipt,prior,config};
}
it('consumes explicit unused authority only on a fresh message, preserving queued202 custody and reservations',async()=>{
 const {f,key:oldKey,receipt,prior,config}=await unused();try{
  expect(()=>f.lifecycle.assertOwnerAlphaSettlement(true)).toThrow(/unclaimed/);
  const old=()=>JSON.stringify({run:f.store.run(prior.run_id),command:f.db.all('SELECT * FROM commands WHERE id=?',receipt.id),events:f.db.all('SELECT * FROM events WHERE cause_id=? OR id=?',receipt.id,receipt.id),
   metadata:f.db.all("SELECT * FROM runtime_metadata WHERE key IN ('owner_alpha_generation:2','owner_alpha_reservation:2','owner_alpha_cost_baseline') OR key LIKE 'owner_alpha_wake:%' ORDER BY key"),retained:f.retained()});
  const before=old();f.reopen(config);
  const snapshot=()=>JSON.stringify(f.db.sqlite.prepare('SELECT * FROM runtime_metadata ORDER BY key').all());
  const passive=snapshot();expect(f.core.bootstrap.summary()?.message_admission_available).toBe(true);expect(f.core.bootstrap.assignedManifest()).toEqual(prior);f.core.state();expect(snapshot()).toBe(passive);
  expect(f.send(bot,oldKey)).toEqual(receipt);expect(snapshot()).toBe(passive);
  const key=randomUUID(),fresh=f.send(bot,key),m=f.core.bootstrap.assignedManifest()!;
  expect(m).toMatchObject({epoch:3,run_id:fresh.resource_id,expires_at:config.unused_recovery!.expires_at,policy_revision:'recovery-v2'});
  expect(f.lifecycle.nextClaimableRun()?.id).toBe(m.run_id);expect(f.core.ownerAlpha.eligible(f.store.run(prior.run_id))).toBe(false);expect(old()).toBe(before);
  expect(f.send(bot,key)).toEqual(fresh);expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);
  const {unused_recovery:_,...without}=config;f.reopen(without);expect(f.core.bootstrap.assignedManifest()).toEqual(m);expect(old()).toBe(before);
  f.setNow(m.expires_at);f.lifecycle.watchdog();expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);expect(f.store.run(f.send().resource_id!).status).toBe('waiting');
  expect(()=>f.reopen({...config,unused_recovery:{...config.unused_recovery!,evidence:{...config.unused_recovery!.evidence,sha256:'e'.repeat(64)}}})).toThrow(/immutable/);
 }finally{f.close();}
});
it.each(['missing','installation','owner','hash','epoch','boot','transition','session','run','revision','expired','future evidence','too early evidence','budget','baseline','question','controller','attempt','child','native link','effect','lock'] as const)('refuses unused recovery with %s',async mode=>{
 const {f,prior,config}=await unused();try{
  const g=config.unused_recovery!;
  if(mode==='missing')delete config.unused_recovery;
  else if(mode==='installation')g.installation_id='other';else if(mode==='owner')g.owner_binding_sha256='e'.repeat(64);
  else if(mode==='hash')g.predecessor.manifest_sha256='e'.repeat(64);else if(mode==='epoch')g.predecessor.epoch++;
  else if(mode==='boot')g.predecessor.boot_id=randomUUID();else if(mode==='transition')g.predecessor.transition_id=randomUUID();else if(mode==='session')g.predecessor.session_id=randomUUID();else if(mode==='run')g.predecessor.run_id=f.waiting.resource_id!;
  else if(mode==='revision')g.successor_policy_revision='trial-v1';else if(mode==='expired'){f.setNow(g.expires_at);}
  else if(mode==='future evidence')g.evidence.observed_at='2026-09-10T00:05:01.000Z';else if(mode==='too early evidence')g.evidence.observed_at='2026-09-10T00:04:59.999Z';
  else if(mode==='budget')config.reservation_micro_usd=7000000;else if(mode==='baseline')config.prior_cost_source='different';
  f.reopen(config);
  if(mode==='question')f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)','native-question:contradiction',JSON.stringify({run_id:prior.run_id,status:'resolved'}));
  if(mode==='controller')f.db.exec("INSERT INTO controller_operations(id,kind,epoch,status,created_at) VALUES(?,'hold',?,'confirmed',?)",randomUUID(),prior.epoch,f.core.now());
  if(mode==='attempt')f.db.exec('INSERT INTO attempts(run_id,attempt,epoch,boot_id,status,submission_key,started_at,deadline_at) SELECT ?,1,epoch,boot_id,status,?,started_at,deadline_at FROM attempts LIMIT 1',prior.run_id,`${prior.run_id}:1`);
  if(mode==='child')f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?',prior.run_id,f.waiting.resource_id!);
  if(mode==='native link')f.db.exec('INSERT INTO native_task_links VALUES(?,?,1,?,?)',f.waiting.resource_id!,prior.run_id,'unexpected-native','unexpected-session');
  if(mode==='effect')f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','confirmed','authority','digest',?)",randomUUID(),prior.run_id,randomUUID(),f.core.now());
  if(mode==='lock')f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)','resource',prior.run_id,f.core.now());
  expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
  const fresh=f.send();expect(f.store.run(fresh.resource_id!).status).toBe('waiting');expect(f.lifecycle.nextClaimableRun()).toBeUndefined();
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_unused_disposition:*'")).toHaveLength(0);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(1);
 }finally{f.close();}
});
it('fails reconstruction and selector closed on persisted unused disposition tampering',async()=>{
 const {f,config}=await unused();try{
  f.reopen(config);f.send();
  f.db.exec("UPDATE runtime_metadata SET value_json=json_set(value_json,'$.grant.evidence.sha256',?) WHERE key='owner_alpha_unused_disposition:2'",'e'.repeat(64));
  expect(()=>f.lifecycle.nextClaimableRun()).toThrow();expect(()=>f.reopen(config)).toThrow();
 }finally{f.close();}
});
it('allows ordinary completed-and-retired rollover after unused recovery without retaining its config grant',async()=>{
 const {f,config}=await unused();try{
  f.reopen(config);f.send();const report=complete(f);
  const {unused_recovery:_,...without}=config;f.reopen(without);f.core.bootstrap.recordRetirement(report);
  const fresh=f.send();expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(4);expect(f.lifecycle.nextClaimableRun()?.id).toBe(fresh.resource_id);
  expect(f.core.ownerAlpha.activeGeneration()?.authority).toMatchObject({kind:'owner-message'});
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(3);
  f.reopen(without);expect(f.lifecycle.nextClaimableRun()?.id).toBe(fresh.resource_id);
 }finally{f.close();}
});

function quarantined(){
 const f=setup();f.retire();const key=randomUUID(),receipt=f.send(bot,key),prior=f.core.bootstrap.assignedManifest()!;
 const identity={epoch:prior.epoch,boot_id:prior.boot_id};f.lifecycle.registerBoot(prior.boot_id);f.lifecycle.ready(identity);
 expect(f.lifecycle.claim(identity)?.run.id).toBe(prior.run_id);
 f.setNow(prior.expires_at);f.lifecycle.watchdog();
 expect(f.db.all('SELECT status FROM attempts WHERE run_id=?',prior.run_id)).toEqual([{status:'claimed'}]);
 const submission_key=`${prior.run_id}:1`,config:OwnerAlphaBootstrapConfig={...f.config,policy_revision:'quarantine-v2',claimed_pre_turn_quarantine:{
  kind:'claimed-pre-turn-quarantine-v1',installation_id:prior.installation_id,owner_binding_sha256:prior.owner_binding_sha256,
  predecessor:{manifest_sha256:prior.manifest_sha256,epoch:prior.epoch,boot_id:prior.boot_id,transition_id:prior.transition_id,session_id:prior.session_id,run_id:prior.run_id,
   attempt:1,submission_key,native_attempt_id:createHash('sha256').update(JSON.stringify([prior.installation_id,submission_key])).digest('hex'),native_fingerprint:'e'.repeat(64)},
  evidence:{sha256:'d'.repeat(64),observed_at:prior.expires_at,source:'trusted-runtime-quarantine-marker'},successor_policy_revision:'quarantine-v2',expires_at:'2026-09-10T00:05:43.000Z'}};
 const retained=()=>JSON.stringify({old:f.retained(),run:f.store.run(prior.run_id),attempts:f.db.all('SELECT * FROM attempts WHERE run_id=?',prior.run_id),
  command:f.db.all('SELECT * FROM commands WHERE id=?',receipt.id),events:f.db.all('SELECT * FROM events WHERE id=? OR cause_id=?',receipt.id,receipt.id),
  metadata:f.db.all("SELECT * FROM runtime_metadata WHERE key IN ('owner_alpha_generation:2','owner_alpha_reservation:2','owner_alpha_cost_baseline','owner_alpha_wake:2') ORDER BY key")});
 return {f,key,receipt,prior,config,retained};
}
it('quarantines exact claimed uncertainty without settlement and admits only a fresh independently claimable message',()=>{
 const {f,key,receipt,prior,config,retained}=quarantined();try{
  expect(()=>f.lifecycle.assertOwnerAlphaSettlement(true)).toThrow();const before=retained();
  expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);f.reopen(config);
  const snapshot=()=>JSON.stringify(['runtime_metadata','lifecycle','runs','attempts','events'].map(table=>f.db.all(`SELECT * FROM ${table}`))),passive=snapshot();
  expect(f.core.bootstrap.summary()?.message_admission_available).toBe(true);f.core.state();expect(f.core.bootstrap.assignedManifest()).toEqual(prior);expect(snapshot()).toBe(passive);
  expect(f.send(bot,key)).toEqual(receipt);expect(snapshot()).toBe(passive);
  const freshKey=randomUUID(),fresh=f.send(bot,freshKey),m=f.core.bootstrap.assignedManifest()!;
  expect(m).toMatchObject({epoch:3,run_id:fresh.resource_id,policy_revision:'quarantine-v2',expires_at:config.claimed_pre_turn_quarantine!.expires_at});
  expect(f.core.ownerAlpha.activeGeneration()?.authority).toMatchObject({kind:'owner-message-claimed-pre-turn-quarantine'});
  expect(f.lifecycle.nextClaimableRun()?.id).toBe(m.run_id);expect(f.core.ownerAlpha.eligible(f.store.run(prior.run_id))).toBe(false);expect(f.send(bot,freshKey)).toEqual(fresh);
  expect(retained()).toBe(before);expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);
  const {claimed_pre_turn_quarantine:_,...without}=config;f.reopen(without);expect(f.core.bootstrap.assignedManifest()).toEqual(m);
  const report=complete(f);expect(retained()).toBe(before);f.core.bootstrap.recordRetirement(report);const next=f.send();
  expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(4);expect(f.lifecycle.nextClaimableRun()?.id).toBe(next.resource_id);f.reopen(without);expect(retained()).toBe(before);
  expect(()=>f.reopen({...config,claimed_pre_turn_quarantine:{...config.claimed_pre_turn_quarantine!,evidence:{...config.claimed_pre_turn_quarantine!.evidence,sha256:'f'.repeat(64)}}})).toThrow(/immutable/);
 }finally{f.close();}
});
it.each(['missing','manifest','owner','boot','revision','expired','early evidence','future evidence','budget','baseline','second attempt','other epoch','native empty','native id','result','release','settled','checkpoint','running','terminated','completed','recovery_required','deadline','lease','run status','child','link','operation','effect','lock','question','retry','controller','proof'] as const)('blocks claimed quarantine with %s',mode=>{
 const {f,prior,config,retained}=quarantined();try{
  const q=config.claimed_pre_turn_quarantine!;
  if(mode==='missing')delete config.claimed_pre_turn_quarantine;
  else if(mode==='manifest')q.predecessor.manifest_sha256='f'.repeat(64);else if(mode==='owner')q.owner_binding_sha256='f'.repeat(64);else if(mode==='boot')q.predecessor.boot_id=randomUUID();
  else if(mode==='revision')q.successor_policy_revision='trial-v1';else if(mode==='expired')f.setNow(q.expires_at);
  else if(mode==='early evidence')q.evidence.observed_at='2026-09-10T00:04:59.999Z';else if(mode==='future evidence')q.evidence.observed_at='2026-09-10T00:05:01.000Z';
  else if(mode==='budget')config.reservation_micro_usd=7000000;else if(mode==='baseline')config.prior_cost_micro_usd++;
  f.reopen(config);
  if(mode==='second attempt')f.db.exec('INSERT INTO attempts(run_id,attempt,epoch,boot_id,status,submission_key,started_at,deadline_at) SELECT run_id,2,999,?,status,?,started_at,deadline_at FROM attempts WHERE run_id=?',randomUUID(),`${prior.run_id}:2`,prior.run_id);
  if(mode==='other epoch')f.db.exec('UPDATE attempts SET epoch=999 WHERE run_id=?',prior.run_id);
  if(mode==='native empty'||mode==='native id')f.db.exec('UPDATE attempts SET native_run_ref=? WHERE run_id=?',mode==='native empty'?'':'native',prior.run_id);
  if(mode==='result'||mode==='release')f.db.exec(`UPDATE attempts SET ${mode==='result'?'result_json':'coordinator_release_json'}='{}' WHERE run_id=?`,prior.run_id);
  if(mode==='settled')f.db.exec('UPDATE attempts SET settled_at=? WHERE run_id=?',f.core.now(),prior.run_id);
  if(mode==='checkpoint')f.db.exec("UPDATE runs SET checkpoint_json='{}' WHERE id=?",prior.run_id);
  if(['running','terminated','completed','recovery_required'].includes(mode))f.db.exec('UPDATE attempts SET status=? WHERE run_id=?',mode,prior.run_id);
  if(mode==='deadline')f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?','2026-09-10T00:05:00.001Z',prior.run_id);
  if(mode==='lease')f.db.exec('UPDATE lifecycle SET lease_until=?','2026-09-10T00:05:00.001Z');
  if(mode==='run status')f.db.exec("UPDATE runs SET status='running' WHERE id=?",prior.run_id);
  if(mode==='child')f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?',prior.run_id,f.waiting.resource_id!);
  if(mode==='link')f.db.exec('INSERT INTO native_task_links VALUES(?,?,1,?,?)',f.waiting.resource_id!,prior.run_id,'native','session');
  if(mode==='operation')f.db.exec("INSERT INTO operations VALUES(?,?,1,'inference','settled',?,?,?)",randomUUID(),prior.run_id,f.core.now(),f.core.now(),f.core.now());
  if(mode==='effect')f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','confirmed','authority','digest',?)",randomUUID(),prior.run_id,randomUUID(),f.core.now());
  if(mode==='lock')f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)','resource',prior.run_id,f.core.now());
  if(mode==='question'||mode==='proof')f.db.exec('INSERT INTO runtime_metadata VALUES(?,?)',mode==='question'?'native-question:contradiction':`text_only_receipt:${prior.run_id}:1`,JSON.stringify({run_id:prior.run_id}));
  if(mode==='retry')f.db.exec('INSERT INTO retry_queue VALUES(?,?,?)',prior.run_id,f.core.now(),'unexpected');
  if(mode==='controller')f.db.exec("INSERT INTO controller_operations(id,kind,epoch,status,created_at) VALUES(?,'hold',?,'confirmed',?)",randomUUID(),prior.epoch,f.core.now());
  const before=retained();expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);
  expect(f.store.run(f.send().resource_id!).status).toBe('waiting');expect(f.lifecycle.nextClaimableRun()).toBeUndefined();expect(retained()).toBe(before);
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_claimed_pre_turn_disposition:*'")).toHaveLength(0);
 }finally{f.close();}
});
it('strictly parses quarantine identity and refuses simultaneous unused authority',async()=>{
 const {f,config}=quarantined();try{
  const q=config.claimed_pre_turn_quarantine!;expect(parseOwnerAlphaClaimedPreTurnQuarantine(q)).toEqual(q);
  for(const bad of [null,{}, {...q,extra:true},{...q,predecessor:{...q.predecessor,attempt:2}},{...q,predecessor:{...q.predecessor,submission_key:'wrong'}},{...q,predecessor:{...q.predecessor,native_attempt_id:'f'.repeat(64)}},{...q,predecessor:{...q.predecessor,native_fingerprint:''}}])expect(()=>parseOwnerAlphaClaimedPreTurnQuarantine(bad)).toThrow();
  const {attempt:_,submission_key:__,native_attempt_id:___,native_fingerprint:____,...predecessor}=q.predecessor;
  expect(()=>f.reopen({...config,unused_recovery:{...q,kind:'unused-before-staging-v1',predecessor}})).toThrow(/mutually exclusive/);
 }finally{f.close();}
});
it.each(['evidence','successor','predecessor'] as const)('rejects persisted quarantine %s tampering at selector and reopen',mode=>{
 const {f,prior,config}=quarantined();try{
  f.reopen(config);f.send();
  if(mode==='predecessor')f.db.exec("UPDATE attempts SET native_run_ref='unexpected' WHERE run_id=?",prior.run_id);
  else f.db.exec('UPDATE runtime_metadata SET value_json=json_set(value_json,?,?) WHERE key=?',mode==='evidence'?'$.grant.evidence.sha256':'$.successor_run_id',mode==='evidence'?'f'.repeat(64):randomUUID(),'owner_alpha_claimed_pre_turn_disposition:2');
  expect(()=>f.lifecycle.nextClaimableRun()).toThrow();const {claimed_pre_turn_quarantine:_,...without}=config;expect(()=>f.reopen(without)).toThrow();
  expect(()=>new ControlCore(f.store,{...f.core.options,ownerAlphaBootstrap:undefined})).toThrow();
 }finally{f.close();}
});
it.each([999,1000])('bounds quarantine lifetime at %ims without consuming insufficient grants',remaining=>{
 const {f,config}=quarantined();try{
  config.claimed_pre_turn_quarantine!.expires_at=new Date(Date.parse(f.core.now())+remaining).toISOString();f.reopen(config);
  const fresh=f.send();expect(f.store.run(fresh.resource_id!).status).toBe(remaining===1000?'queued':'waiting');
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(remaining===1000?2:1);
  if(remaining===1000){
   const m=f.core.bootstrap.assignedManifest()!,identity={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(m.boot_id);f.lifecycle.ready(identity);expect(f.lifecycle.claim(identity)?.run.id).toBe(fresh.resource_id);
   f.setNow(config.claimed_pre_turn_quarantine!.expires_at);f.lifecycle.watchdog();expect(f.core.bootstrap.summary()?.message_admission_available).toBe(false);expect(f.store.run(f.send().resource_id!).status).toBe('waiting');
   expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);
  }
 }finally{f.close();}
});
