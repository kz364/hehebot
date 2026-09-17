import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {assertOwnerAlphaSuccessorBinding,parseOwnerAlphaSuccessor,type OwnerAlphaPolicy} from '../src/core/owner-alpha';

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
