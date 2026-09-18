import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {fixture,bot,otherBot} from './helpers';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';
import {Store,type Database} from '../src/core/store';
import type {OwnerAlphaPolicy} from '../src/core/owner-alpha';
import {ownerAlphaManifestSha256,parseOwnerAlphaBootstrap,type OwnerAlphaBootstrapConfig,type OwnerAlphaRetirement} from '../src/core/owner-alpha-bootstrap';

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
