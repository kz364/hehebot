import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';
import {AgentCommandBoundary,SKILL_PROPOSE_POLICY} from '../src/core/agent-commands';
import type {SkillBody} from '../src/core/types';
import {bot,fixture} from './helpers';

const body:SkillBody={name:'Check corrected totals',description:'Reusable arithmetic procedure',when_to_use:'When reviewing supplied totals',inputs_access:['Supplied numbers'],steps:['Recompute each subtotal','Compare the grand total'],decision_rules:['Ask about missing numbers'],validation:['Check units'],output:'Explained comparison',failure_handling:['Stop on missing inputs'],approval_boundaries:['Do not submit'],contains_private_facts:false,references:[{name:'method.md',text:'  Preserve this generic note.\r\n  '}]};
let f:ReturnType<typeof fixture>,source:string,life:LifecycleCore,identity:{epoch:number;boot_id:string};
beforeEach(()=>{
 f=fixture(true);source=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'PRIVATE SOURCE INPUT 37'}}).resource_id!;
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 life=new LifecycleCore(f.store,f.core);identity=life.registerBoot(randomUUID());life.ready(identity);life.claim(identity);
});
afterEach(()=>f.close());
const draft=()=>({schema_version:1 as const,type:'skill.propose_from_task' as const,payload:{proposal_id:randomUUID(),skill_id:randomUUID(),expected_skill_revision:0,source_run_id:source,expected_attempt:1,body}});
const custody=()=>['runs','attempts','lifecycle','effects','outbox','resource_locks','skill_enablements'].map(table=>f.db.all(`SELECT * FROM ${table}`));
const proposals=()=>f.db.all<{body_json:string;provenance_json:string;status:string;command_id:string}>('SELECT body_json,provenance_json,status,command_id FROM skill_proposals');
it('stages only owner procedure text with exact source identity, preserves custody and deduplicates after reconstruction',()=>{
 const command=draft(),key=randomUUID(),before=custody(),receipt=f.accept(command,key);
 expect(receipt.status).toBe('applied');expect(proposals()).toEqual([{body_json:JSON.stringify(body),provenance_json:JSON.stringify({kind:'task',source_ref:`task:${bot}/${source}/1`}),status:'pending',command_id:receipt.id}]);
 expect(JSON.stringify(proposals())).not.toContain('PRIVATE SOURCE INPUT');expect(custody()).toEqual(before);
 const rebuilt=new ControlCore(f.store,f.core.options);
 const stored=f.db.all<{body_hash:string}>('SELECT body_hash FROM commands WHERE id=?',receipt.id)[0];
 expect(rebuilt.accept('owner',key,stored.body_hash,command)).toEqual(receipt);expect(proposals()).toHaveLength(1);
 expect(()=>f.accept({...command,payload:{...command.payload,body:{...body,output:'Changed'}}},key)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
 expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:command.payload.proposal_id,expected_proposal_revision:1,decision:'approve'}}).status).toBe('applied');
 expect(f.store.get(command.payload.skill_id,'skill').body).toEqual(body);expect(custody()).toEqual(before);
});
it.each(['missing run','stale attempt','unclaimed','missing record'])('rejects %s without inventing provenance or changing task custody',kind=>{
 const command=draft();
 if(kind==='missing run')command.payload.source_run_id=randomUUID();
 if(kind==='stale attempt')command.payload.expected_attempt=2;
 if(kind==='unclaimed')f.db.exec('UPDATE runs SET current_attempt=0 WHERE id=?',source);
 if(kind==='missing record')f.db.exec('DELETE FROM attempts WHERE run_id=?',source);
 const before=custody();expect(f.accept(command).status).toBe('rejected');expect(proposals()).toEqual([]);expect(custody()).toEqual(before);
});
it('permits an explicitly corrected failed source and retains provenance when a later retry changes the source attempt',()=>{
 life.complete(identity,source,1,{status:'failed',text:'PRIVATE FAILED OUTPUT 91',error_code:'SYNTHETIC'});
 const command=draft(),before=custody();expect(f.accept(command).status).toBe('applied');expect(custody()).toEqual(before);
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:source,expected_attempt:1}}).status).toBe('applied');life.claim(identity);
 const retried=custody();expect(f.accept(draft()).error?.code).toBe('REVISION_CONFLICT');expect(custody()).toEqual(retried);
 expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:command.payload.proposal_id,expected_proposal_revision:1,decision:'reject'}}).status).toBe('applied');
 expect(proposals()[0]).toMatchObject({status:'rejected',provenance_json:JSON.stringify({kind:'task',source_ref:`task:${bot}/${source}/1`})});
 expect(JSON.stringify(proposals())).not.toContain('PRIVATE FAILED OUTPUT');
});
it('uses existing duplicate, pending and revision checks for updates instead of activating or creating another skill',()=>{
 const first=draft();expect(f.accept(first).status).toBe('applied');
 expect(f.accept({...first,payload:{...first.payload,proposal_id:randomUUID()}}).error?.code).toBe('REVISION_CONFLICT');
 expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:first.payload.proposal_id,expected_proposal_revision:1,decision:'approve'}}).status).toBe('applied');
 expect(f.accept(draft()).error?.code).toBe('UPDATE_EXISTING_SKILL');
 const update={...first,payload:{...first.payload,proposal_id:randomUUID(),expected_skill_revision:1,body:{...body,steps:['Corrected procedure step']}}};
 expect(f.accept(update).status).toBe('applied');expect(f.store.get(first.payload.skill_id,'skill')).toMatchObject({revision:1,body});
 expect(f.db.all('SELECT * FROM skill_enablements')).toEqual([]);
});
it('rejects model/trigger and owner-alpha routes even when proposal authority exists',()=>{
 const command=draft(),run=f.store.run(source),context=JSON.parse(run.context_json);context.persona.body.tool_policy_ids=[SKILL_PROPOSE_POLICY];
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),source);
 expect(()=>new AgentCommandBoundary(f.core,life).accept({identity,run_id:source,attempt:1,idempotency_key:randomUUID(),command:command as never})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 for(const actor of [`runtime:${bot}`,'trigger:synthetic'])expect(f.core.accept(actor,randomUUID(),'synthetic',command).error?.code).toBe('FORBIDDEN');
 Object.defineProperty(f.core.ownerAlpha,'policy',{value:{session_id:randomUUID()}});
 expect(f.accept(command).error?.code).toBe('CAPABILITY_UNAVAILABLE');expect(proposals()).toEqual([]);
});
