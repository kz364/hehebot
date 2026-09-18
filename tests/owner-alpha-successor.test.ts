import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {assertOwnerAlphaSuccessorBinding,ownerAlphaSuccessorSha256,parseOwnerAlphaSuccessor,type OwnerAlphaPolicy} from '../src/core/owner-alpha';
import {fixture,bot} from './helpers';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';

const predecessorPolicy:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:randomUUID(),expires_at:'2026-09-17T01:02:03.000Z',max_runs:3,max_task_seconds:299,background_first_root:true};
const envelope={
 schema_version:1,transition_id:randomUUID(),owner_binding_sha256:'1'.repeat(64),
 predecessor:{session_id:predecessorPolicy.session_id,epoch:37,boot_id:randomUUID()},retirement_receipt_sha256:'2'.repeat(64),
 successor:{policy:{session_id:randomUUID(),persona_id:randomUUID(),expires_at:'2026-09-18T04:05:06.000Z',max_runs:1,max_task_seconds:17,text_only:{profile_version:'codex-text-only-v1',profile_sha256:'3'.repeat(64)}},boot_id:randomUUID()},
} as const;
const binding={ownerBindingSha256:envelope.owner_binding_sha256,predecessorPolicy,epoch:envelope.predecessor.epoch,bootId:envelope.predecessor.boot_id,retirementReceiptSha256:envelope.retirement_receipt_sha256};

it('is absent by default and parses the exact asymmetric one-shot envelope',()=>{
 expect(parseOwnerAlphaSuccessor(undefined)).toBeUndefined();
 expect(parseOwnerAlphaSuccessor('')).toBeUndefined();
 const parsed=parseOwnerAlphaSuccessor(JSON.stringify(envelope));
 expect(parsed).toEqual(envelope);
 expect(()=>assertOwnerAlphaSuccessorBinding(parsed!,binding)).not.toThrow();
});

it.each([
 ['owner hash',{ownerBindingSha256:'4'.repeat(64)}],
 ['predecessor session',{predecessorPolicy:{...predecessorPolicy,session_id:randomUUID()}}],
 ['epoch',{epoch:38}],
 ['boot identity',{bootId:randomUUID()}],
 ['retirement receipt hash',{retirementReceiptSha256:'5'.repeat(64)}],
])('rejects an independent trusted %s disagreement',(_label,change)=>{
 const parsed=parseOwnerAlphaSuccessor(JSON.stringify(envelope))!;
 expect(()=>assertOwnerAlphaSuccessorBinding(parsed,{...binding,...change})).toThrow();
});

it.each([
 ['missing key',(({transition_id:_,...rest})=>rest)(envelope)],
 ['extra key',{...envelope,activate:true}],
 ['invalid epoch',{...envelope,predecessor:{...envelope.predecessor,epoch:Number.MAX_SAFE_INTEGER+1}}],
 ['epoch cannot advance',{...envelope,predecessor:{...envelope.predecessor,epoch:Number.MAX_SAFE_INTEGER}}],
 ['same session',{...envelope,successor:{...envelope.successor,policy:{...envelope.successor.policy,session_id:envelope.predecessor.session_id}}}],
 ['same boot',{...envelope,successor:{...envelope.successor,boot_id:envelope.predecessor.boot_id}}],
 ['same boot uppercase',{...envelope,successor:{...envelope.successor,boot_id:envelope.predecessor.boot_id.toUpperCase()}}],
 ['same session uppercase',{...envelope,successor:{...envelope.successor,policy:{...envelope.successor.policy,session_id:envelope.predecessor.session_id.toUpperCase()}}}],
 ['background successor',{...envelope,successor:{...envelope.successor,policy:{...envelope.successor.policy,background_first_root:true}}}],
 ['unsupported profile',{...envelope,successor:{...envelope.successor,policy:{...envelope.successor.policy,text_only:{...envelope.successor.policy.text_only,profile_version:'other'}}}}],
 ['uppercase hash',{...envelope,retirement_receipt_sha256:'A'.repeat(64)}],
])('rejects %s',(_label,changed)=>expect(()=>parseOwnerAlphaSuccessor(JSON.stringify(changed))).toThrow());

it('activates one exact successor, delivers one-shot wakes, and retains predecessor custody',async()=>{
 const f=fixture();
 try{
  const original:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:1,max_task_seconds:45};
  let core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
  const lifecycle=new LifecycleCore(f.store,core),oldBoot=randomUUID(),oldIdentity=lifecycle.registerBoot(oldBoot);lifecycle.ready(oldIdentity);
  const old=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'retained predecessor'}});
  const oldClaim=lifecycle.claim(oldIdentity)!;
  const stale=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'before cutoff'}});
  f.setNow('2026-09-10T00:02:00.000Z');
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','retained-auth','retained-digest',?)",randomUUID(),oldClaim.run.id,randomUUID(),core.now());
  const retained=()=>JSON.stringify({run:f.store.run(oldClaim.run.id),attempt:f.db.all('SELECT * FROM attempts WHERE run_id=?',oldClaim.run.id),
   effects:f.db.all('SELECT * FROM effects WHERE run_id=?',oldClaim.run.id),original:f.db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")});
  const before=retained();
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP',lease_until=? WHERE singleton=1",original.expires_at);
  const next={schema_version:1 as const,transition_id:randomUUID(),owner_binding_sha256:'a'.repeat(64),predecessor:{session_id:original.session_id,epoch:1,boot_id:oldBoot},retirement_receipt_sha256:'b'.repeat(64),
   successor:{policy:{session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:06:00.000Z',max_runs:1,max_task_seconds:30,text_only:{profile_version:'codex-text-only-v1' as const,profile_sha256:'c'.repeat(64)}},boot_id:randomUUID()}};
  const owner='operator:trusted',rawCommand=`{\n  "payload": { "envelope_sha256": "${ownerAlphaSuccessorSha256(next)}", "transition_id": "${next.transition_id}" },\n  "type": "owner-alpha.activate", "schema_version": 1\n}`;
  const command=JSON.parse(rawCommand) as {schema_version:1;type:'owner-alpha.activate';payload:{envelope_sha256:string;transition_id:string}};
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaSuccessor:next,ownerBindingSha256:next.owner_binding_sha256});
  const key=randomUUID(),hash=createHash('sha256').update(rawCommand).digest('hex');
  expect(hash).not.toBe(createHash('sha256').update(JSON.stringify(command)).digest('hex'));
  const activated=core.accept(owner,key,hash,command);
  expect(activated).toMatchObject({status:'applied',resource_id:next.transition_id});
  expect(core.accept(owner,key,hash,command)).toEqual(activated);
  expect(f.db.all<{epoch:number}>('SELECT epoch FROM lifecycle')[0].epoch).toBe(2);
  const generationBytes=()=>f.db.all("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_generation:2'");
  const immutableGeneration=generationBytes();
  expect(JSON.parse((immutableGeneration[0] as {value_json:string}).value_json).activation_command_sha256).toBe(hash);
  expect(retained()).toBe(before);
  const refused:string[]=[];
  await lifecycle.deliverOwnerAlphaWake(randomUUID(),async()=>{refused.push('wrong');});
  f.setNow(next.successor.policy.expires_at);
  await lifecycle.deliverOwnerAlphaWake(next.transition_id,async()=>{refused.push('expired');});
  f.setNow('2026-09-10T00:02:00.000Z');
  expect(refused).toEqual([]);expect(retained()).toBe(before);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),sent:{epoch:number;operationId:string}[]=[];
  const delivery=lifecycle.deliverOwnerAlphaWake(next.transition_id,async command=>{sent.push(command);await held;});
  await Promise.resolve();
  expect(sent).toEqual([{epoch:2,operationId:next.transition_id}]);
  expect(JSON.parse((f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_wake:2'")[0]).value_json)).toEqual({epoch:2,boot_id:next.successor.boot_id,transition_id:next.transition_id,status:'unknown'});
  await lifecycle.deliverOwnerAlphaWake(next.transition_id,async()=>{sent.push({epoch:-1,operationId:'duplicate'});});
  release();await delivery;
  expect(sent).toEqual([{epoch:2,operationId:next.transition_id}]);
  expect(JSON.parse((f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_wake:2'")[0]).value_json).status).toBe('queued');
  const reconstructed=new LifecycleCore(f.store,core);
  await reconstructed.deliverOwnerAlphaWake(next.transition_id,async()=>{sent.push({epoch:-1,operationId:'reconstructed'});});
  expect(sent).toHaveLength(1);expect(retained()).toBe(before);
  expect(f.db.all('SELECT run_id,epoch,boot_id,status FROM attempts')).toEqual([{run_id:oldClaim.run.id,epoch:1,boot_id:oldBoot,status:'claimed'}]);
  expect(lifecycle.nextClaimableRun()).toBeUndefined();
  const fresh=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'after cutoff'}});
  lifecycle.registerBoot(next.successor.boot_id);lifecycle.ready({epoch:2,boot_id:next.successor.boot_id});
  const claim=lifecycle.claim({epoch:2,boot_id:next.successor.boot_id})!;expect(claim.run.id).toBe(fresh.resource_id);expect(claim.run.id).not.toBe(stale.resource_id);
  const nativeRef='native:successor';lifecycle.submitted({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,nativeRef);lifecycle.coordinatorRelease({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,nativeRef,'completed');
  const result={status:'completed' as const,text:'successor result'},receipt={...next.successor.policy.text_only,thread_id:'thread',turn_id:nativeRef,output_sha256:createHash('sha256').update(result.text).digest('hex')};
  lifecycle.complete({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,result,receipt);
  const intermediate=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'before epoch 3 cutoff'}});
  f.setNow('2026-09-10T00:07:00.000Z');lifecycle.watchdog();
  const third={schema_version:1 as const,transition_id:randomUUID(),owner_binding_sha256:next.owner_binding_sha256,
   predecessor:{session_id:next.successor.policy.session_id,epoch:2,boot_id:next.successor.boot_id},retirement_receipt_sha256:'d'.repeat(64),
   successor:{policy:{...next.successor.policy,session_id:randomUUID(),expires_at:'2026-09-10T00:11:00.000Z'},boot_id:randomUUID()}};
  const thirdCommand={schema_version:1 as const,type:'owner-alpha.activate' as const,payload:{transition_id:third.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(third)}};
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaSuccessor:third,ownerBindingSha256:third.owner_binding_sha256});
  const thirdHash=createHash('sha256').update(JSON.stringify(thirdCommand)).digest('hex');
  const lifecycleBefore=f.db.all('SELECT * FROM lifecycle');
  for(const status of ['running','failed','recovery_required']){
   f.db.exec('UPDATE runs SET status=? WHERE id=?',status,claim.run.id);
   expect(core.accept(owner,randomUUID(),thirdHash,thirdCommand).error?.code).toBe('CAPABILITY_UNAVAILABLE');
   expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycleBefore);
   expect(retained()).toBe(before);
  }
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",claim.run.id);
  const proofKey=`text_only_receipt:${claim.run.id}:1`,proof=f.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',proofKey)[0].value_json;
  f.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?',JSON.stringify({...JSON.parse(proof),output_sha256:'0'.repeat(64)}),proofKey);
  expect(core.accept(owner,randomUUID(),thirdHash,thirdCommand).error?.code).toBe('CAPABILITY_UNAVAILABLE');
  f.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?',proof,proofKey);
  f.db.exec("INSERT INTO resource_locks(resource_id,run_id,attempt,acquired_at) VALUES('successor-lock',?,1,?)",claim.run.id,core.now());
  expect(core.accept(owner,randomUUID(),thirdHash,thirdCommand).error?.code).toBe('RESOURCE_BUSY');
  f.db.exec("DELETE FROM resource_locks WHERE resource_id='successor-lock'");
  expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycleBefore);
  for(const boot_id of [third.transition_id,next.transition_id.toUpperCase()]){
   const changed={...third,successor:{...third.successor,boot_id}};
   core.options.ownerAlphaSuccessor=changed;
   const changedCommand={...thirdCommand,payload:{...thirdCommand.payload,envelope_sha256:ownerAlphaSuccessorSha256(changed)}};
   expect(core.accept(owner,randomUUID(),createHash('sha256').update(JSON.stringify(changedCommand)).digest('hex'),changedCommand).status).toBe('rejected');
   expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycleBefore);
  }
  core.options.ownerAlphaSuccessor=third;
  const thirdKey=randomUUID();expect(core.accept(owner,thirdKey,createHash('sha256').update(JSON.stringify(thirdCommand)).digest('hex'),thirdCommand).status).toBe('applied');
  const wakeError=new Error('preserve original wake failure');let failedSends=0;
  await expect(new LifecycleCore(f.store,core).deliverOwnerAlphaWake(third.transition_id,async command=>{
   failedSends++;expect(command).toEqual({epoch:3,operationId:third.transition_id});throw wakeError;
  })).rejects.toBe(wakeError);
  expect(JSON.parse(f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_wake:3'")[0].value_json)).toEqual({epoch:3,boot_id:third.successor.boot_id,transition_id:third.transition_id,status:'unknown'});
  const lifecycle3=new LifecycleCore(f.store,core);
  await lifecycle3.deliverOwnerAlphaWake(third.transition_id,async()=>{failedSends++;});expect(failedSends).toBe(1);
  expect(retained()).toBe(before);
  lifecycle3.registerBoot(third.successor.boot_id);lifecycle3.ready({epoch:3,boot_id:third.successor.boot_id});
  const epoch3Message=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'epoch 3'}});
  expect(lifecycle3.claim({epoch:3,boot_id:third.successor.boot_id})?.run.id).toBe(epoch3Message.resource_id);
  expect(f.store.run(intermediate.resource_id!).status).toBe('waiting');
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
  expect(core.ownerAlpha.policy).toEqual(third.successor.policy);expect(core.state().summary).toMatchObject({owner_alpha_session:{admitted_runs:1,persona_id:bot}});
  expect(generationBytes()).toEqual(immutableGeneration);
  expect(()=>lifecycle.claim(oldIdentity)).toThrow();
  expect(()=>lifecycle.authorizeAttempt({epoch:2,boot_id:next.successor.boot_id},oldClaim.run.id,1)).toThrow();
  expect(retained()).toBe(before);
  expect(generationBytes()).toEqual(immutableGeneration);
  expect(f.db.all<{id:string;status:string}>('SELECT id,status FROM runs WHERE id IN (?,?) ORDER BY id',oldClaim.run.id,claim.run.id).map(x=>x.status).sort()).toEqual(['claimed','completed']);
  f.setNow('2026-09-10T00:12:00.000Z');lifecycle3.watchdog();
  expect(retained()).toBe(before);
  expect(f.store.run(claim.run.id).status).toBe('completed');
  expect(f.store.run(epoch3Message.resource_id!).status).toBe('recovery_required');
  f.db.exec("DELETE FROM runtime_metadata WHERE key='owner_alpha_generation:2'");
  expect(()=>core.ownerAlpha.initialize()).toThrow();
 }finally{f.close();}
});

it('rejects missing or changed grants and different-key repeated activation without mutation',()=>{
 const f=fixture();try{
  const original:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:00:00.000Z',max_runs:1,max_task_seconds:10};
  let core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
  const boot=randomUUID();f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='RECOVERY_REQUIRED',lease_until=? WHERE singleton=1",boot,original.expires_at);
  const next=parseOwnerAlphaSuccessor(JSON.stringify({...envelope,predecessor:{session_id:original.session_id,epoch:1,boot_id:boot},successor:{...envelope.successor,policy:{...envelope.successor.policy,persona_id:bot,expires_at:'2026-09-10T00:04:00.000Z'}}}))!;
  const command={schema_version:1 as const,type:'owner-alpha.activate' as const,payload:{transition_id:next.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(next)}};
  const submit=(c:ControlCore,key=randomUUID())=>c.accept('owner',key,createHash('sha256').update(JSON.stringify(command)).digest('hex'),command);
  expect(submit(core).error?.code).toBe('CAPABILITY_UNAVAILABLE');
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaSuccessor:next,ownerBindingSha256:'f'.repeat(64)});
  expect(submit(core).error?.code).toBe('FORBIDDEN');
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaSuccessor:next,ownerBindingSha256:next.owner_binding_sha256});
  expect(submit(core).status).toBe('applied');
  const before=JSON.stringify({lifecycle:f.db.all('SELECT * FROM lifecycle'),generation:f.db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha_generation:2'")});
  expect(submit(core).status).toBe('rejected');
  expect(JSON.stringify({lifecycle:f.db.all('SELECT * FROM lifecycle'),generation:f.db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha_generation:2'")})).toBe(before);
 }finally{f.close();}
});
