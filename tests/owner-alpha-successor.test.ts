import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {assertOwnerAlphaSuccessorBinding,parseOwnerAlphaSuccessor,type OwnerAlphaPolicy} from '../src/core/owner-alpha';
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

it('activates one exact successor while retaining predecessor custody and enforcing the message cutoff',()=>{
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
  const commandId=randomUUID(),owner='operator:trusted';
  f.db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,'applied',?)",commandId,owner,randomUUID(),createHash('sha256').update(JSON.stringify(next)).digest('hex'),'owner-alpha.activate',JSON.stringify(next),core.now());
  const binding={ownerBindingSha256:next.owner_binding_sha256,predecessorPolicy:original,epoch:1,bootId:oldBoot,retirementReceiptSha256:next.retirement_receipt_sha256};
  expect(lifecycle.activateOwnerAlphaSuccessor(next,binding,owner,commandId)).toEqual({owner_alpha_generation:{epoch:2,boot_id:next.successor.boot_id,transition_id:next.transition_id}});
  const generationBytes=()=>f.db.all("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_generation:2'");
  const immutableGeneration=generationBytes();
  expect(retained()).toBe(before);
  expect(f.db.all('SELECT run_id,epoch,boot_id,status FROM attempts')).toEqual([{run_id:oldClaim.run.id,epoch:1,boot_id:oldBoot,status:'claimed'}]);
  expect(lifecycle.nextClaimableRun()).toBeUndefined();
  const fresh=core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'after cutoff'}});
  lifecycle.registerBoot(next.successor.boot_id);lifecycle.ready({epoch:2,boot_id:next.successor.boot_id});
  const claim=lifecycle.claim({epoch:2,boot_id:next.successor.boot_id})!;expect(claim.run.id).toBe(fresh.resource_id);expect(claim.run.id).not.toBe(stale.resource_id);
  const nativeRef='native:successor';lifecycle.submitted({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,nativeRef);lifecycle.coordinatorRelease({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,nativeRef,'completed');
  const result={status:'completed' as const,text:'successor result'},receipt={...next.successor.policy.text_only,thread_id:'thread',turn_id:nativeRef,output_sha256:createHash('sha256').update(result.text).digest('hex')};
  lifecycle.complete({epoch:2,boot_id:next.successor.boot_id},claim.run.id,1,result,receipt);
  core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
  expect(core.ownerAlpha.policy).toEqual(next.successor.policy);expect(core.state().summary).toMatchObject({owner_alpha_session:{admitted_runs:1,persona_id:bot}});
  expect(generationBytes()).toEqual(immutableGeneration);
  expect(()=>lifecycle.claim(oldIdentity)).toThrow();
  expect(()=>lifecycle.authorizeAttempt({epoch:2,boot_id:next.successor.boot_id},oldClaim.run.id,1)).toThrow();
  f.setNow('2026-09-10T00:07:00.000Z');lifecycle.watchdog();
  expect(retained()).toBe(before);
  expect(generationBytes()).toEqual(immutableGeneration);
  expect(f.db.all<{id:string;status:string}>('SELECT id,status FROM runs WHERE id IN (?,?) ORDER BY id',oldClaim.run.id,claim.run.id).map(x=>x.status).sort()).toEqual(['claimed','completed']);
 }finally{f.close();}
});

it('rejects stale lifecycle, changed owner identity, changed binding, and reused activation',()=>{
 const f=fixture();try{
  const original:OwnerAlphaPolicy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:00:00.000Z',max_runs:1,max_task_seconds:10};
  const core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
  const lifecycle=new LifecycleCore(f.store,core),boot=randomUUID();f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='RECOVERY_REQUIRED',lease_until=? WHERE singleton=1",boot,original.expires_at);
  const next=parseOwnerAlphaSuccessor(JSON.stringify({...envelope,predecessor:{session_id:original.session_id,epoch:1,boot_id:boot},successor:{...envelope.successor,policy:{...envelope.successor.policy,persona_id:bot,expires_at:'2026-09-10T00:04:00.000Z'}}}))!;
  const id=randomUUID();f.db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,'applied',?)",id,'owner',randomUUID(),'hash','owner-alpha.activate',JSON.stringify(next),core.now());
  const trusted={ownerBindingSha256:next.owner_binding_sha256,predecessorPolicy:original,epoch:1,bootId:boot,retirementReceiptSha256:next.retirement_receipt_sha256};
  expect(()=>lifecycle.activateOwnerAlphaSuccessor(next,trusted,'changed-owner',id)).toThrow();
  expect(()=>lifecycle.activateOwnerAlphaSuccessor(next,{...trusted,retirementReceiptSha256:'f'.repeat(64)},'owner',id)).toThrow();
  expect(lifecycle.activateOwnerAlphaSuccessor(next,trusted,'owner',id).owner_alpha_generation.epoch).toBe(2);
  expect(()=>lifecycle.activateOwnerAlphaSuccessor(next,trusted,'owner',id)).toThrow();
 }finally{f.close();}
});
