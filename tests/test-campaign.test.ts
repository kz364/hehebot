import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture,bot} from './helpers';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';
import {TestCampaign,parseTestCampaignGrant,type TestCampaignGrant} from '../src/core/test-campaign';
import type {OwnerAlphaBootstrapConfig} from '../src/core/owner-alpha-bootstrap';

const text='Reply exactly: HEHEBOT_NATIVE_TEST_OK. Do not use tools or access other data.';
function setup(max=2,expires_at='2026-09-10T01:00:00.000Z'){
 const f=fixture(),original={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:1,max_task_seconds:45};
 let core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original});core.ownerAlpha.initialize();
 const lifecycle=new LifecycleCore(f.store,core),identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
 const oldCommand={schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'PRIVATE_OLD_MESSAGE'}};
 const old=core.accept('owner',randomUUID(),createHash('sha256').update(JSON.stringify(oldCommand)).digest('hex'),oldCommand);lifecycle.claim(identity);
 f.setNow('2026-09-10T00:02:00.000Z');lifecycle.watchdog();
 const grant:TestCampaignGrant={campaign_id:randomUUID(),actor_id:'test-service:synthetic-client',persona_id:randomUUID(),owner_binding_sha256:'a'.repeat(64),issued_at:core.now(),expires_at,max_submissions:max};
 const config:OwnerAlphaBootstrapConfig={installation_id:'test-install',owner_id:grant.actor_id,owner_binding_sha256:grant.owner_binding_sha256,policy_revision:'campaign-v1',persona_id:grant.persona_id,
  text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},expires_at:expires_at<'2026-09-10T00:30:00.000Z'?expires_at:'2026-09-10T00:30:00.000Z',session_seconds:180,max_task_seconds:37,
  prior_cost_micro_usd:137000,prior_cost_source:'test-ledger',total_cap_micro_usd:10000000,reservation_micro_usd:1000000};
 const reopen=()=>{core=new ControlCore(f.store,{...f.core.options,ownerAlpha:original,ownerAlphaBootstrap:config,ownerBindingSha256:grant.owner_binding_sha256,testCampaignGrant:grant});core.ownerAlpha.initialize();return new TestCampaign(core);};
 const campaign=reopen();campaign.initialize();
 const retire=()=>core.bootstrap.recordRetirement({...identity,session_id:original.session_id,transition_id:null,observed_at:core.now(),direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'test-observer'});
 const snapshot=()=>JSON.stringify(['commands','runs','events','attempts','runtime_metadata','lifecycle','resource_locks','controller_operations'].map(t=>f.db.all(`SELECT * FROM ${t}`)));
 return {...f,grant,config,campaign,reopen,retire,old,snapshot,get core(){return core;},get lifecycle(){return new LifecycleCore(f.store,core);},submit:(key=randomUUID())=>new TestCampaign(core).submit(grant.actor_id,key)};
}
function finish(f:ReturnType<typeof setup>){
 const m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(id.boot_id);f.lifecycle.ready(id);
 const claim=f.lifecycle.claim(id)!;f.lifecycle.submitted(id,claim.run.id,1,'native-exact');f.lifecycle.coordinatorRelease(id,claim.run.id,1,'native-exact','completed');
 f.lifecycle.complete(id,claim.run.id,1,{status:'completed',text:'HEHEBOT_NATIVE_TEST_OK'},{...m.text_only,thread_id:'thread-exact',turn_id:'native-exact',output_sha256:createHash('sha256').update('HEHEBOT_NATIVE_TEST_OK').digest('hex')});
 f.setNow(m.expires_at);f.lifecycle.watchdog();f.core.bootstrap.recordRetirement({...id,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at,direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'test-observer'});
}
it('campaign run readback excludes historical snapshots and preserves actor fencing',()=>{
 const f=setup();try{
  f.retire();const receipt=f.submit(),id=receipt.resource_id!;
  const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
  f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,id);
  const before=f.store.run(id),read=vi.spyOn(f.db,'all');
  try{
   expect(f.campaign.run(f.grant.actor_id,id)).toEqual({id,command_id:receipt.id,status:'queued',current_attempt:0,created_at:before.created_at,updated_at:before.updated_at,result:null});
   expect(()=>f.campaign.run('test-service:foreign',id)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
   const returned=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
   expect(returned).toHaveLength(2);
   for(const row of returned){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
  }finally{read.mockRestore();}
  expect(f.store.run(id)).toEqual(before);
 }finally{f.close();}
});

it('strictly parses bounded grants and canonicalizes property order',()=>{
 const f=setup();try{
  expect(parseTestCampaignGrant(undefined)).toBeUndefined();expect(parseTestCampaignGrant('')).toBeUndefined();
  const reordered=Object.fromEntries(Object.entries(f.grant).reverse());
  expect(parseTestCampaignGrant(JSON.stringify(reordered))).toEqual(f.grant);
  for(const g of [null,{}, {...f.grant,extra:true},{...f.grant,max_submissions:0},{...f.grant,max_submissions:7},{...f.grant,max_submissions:1.1},{...f.grant,actor_id:'owner'},{...f.grant,persona_id:'bad'},{...f.grant,expires_at:f.grant.issued_at},{...f.grant,expires_at:'2026-09-11T00:02:00.001Z'}])expect(()=>parseTestCampaignGrant(JSON.stringify(g))).toThrow();
  expect(parseTestCampaignGrant(JSON.stringify({...f.grant,expires_at:'2026-09-11T00:02:00.000Z',max_submissions:6}))).toBeDefined();
 }finally{f.close();}
});
it('excludes private canaries at admission and actual claim; preserves owner context and old custody',()=>{
 const f=setup();try{
  const canary=(scope:{kind:'global'|'persona';id:string|null})=>f.store.put(randomUUID(),'memory',{scope,text:'PRIVATE_MEMORY',expires_at:null},0,'owner',f.core.now());
  canary({kind:'global',id:null});canary({kind:'persona',id:f.grant.persona_id});
  const skill=randomUUID();f.store.put(skill,'skill',{name:'PRIVATE_SKILL'},0,'owner',f.core.now());
  f.db.exec('INSERT INTO skill_enablements VALUES(?,?,1,1,?)',skill,f.grant.persona_id,f.core.now());
  const privateMessage={schema_version:1,type:'message.send',payload:{conversation_id:f.grant.persona_id,text:'PRIVATE_HISTORY'}};
  const privateReceipt=f.core.accept('owner',randomUUID(),'history-hash',privateMessage);
  f.store.event(randomUUID(),f.grant.persona_id,'room.context_update','owner',null,{text:'PRIVATE_EVENT',recipient_ids:[f.grant.persona_id]},f.core.now());
  f.db.exec("UPDATE runs SET role='background',title='PRIVATE_TASK' WHERE id=?",privateReceipt.resource_id!);
  f.db.exec('INSERT INTO resource_locks VALUES(?,?,0,?)','private-resource',f.old.resource_id!,f.core.now());
  const old=JSON.stringify(f.store.run(f.old.resource_id!)),locks=f.db.all('SELECT * FROM resource_locks');f.retire();
  const r=f.submit(),context=JSON.parse(f.store.run(r.resource_id!).context_json);
  expect(context).toMatchObject({instruction:text,memories:[],skills:[],context_events:[],authorization_policy_ids:[]});expect(JSON.stringify(context)).not.toContain('PRIVATE');
  expect(context).not.toHaveProperty('conversation_history');expect(context).not.toHaveProperty('task_summaries');expect(context).not.toHaveProperty('whatsapp_read_policies');
  canary({kind:'global',id:null});const m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(id.boot_id);f.lifecycle.ready(id);
  const claim=f.lifecycle.claim(id)!;expect(claim.run.id).toBe(r.resource_id);expect(JSON.parse(claim.run.context_json)).toEqual(context);
  expect(JSON.stringify(f.store.run(f.old.resource_id!))).toBe(old);expect(f.db.all('SELECT * FROM resource_locks')).toEqual(locks);
  expect(JSON.stringify(f.core.context(bot,'ordinary',null,null))).toContain('PRIVATE_MEMORY');
 }finally{f.close();}
});
it('rolls back every side effect when fresh bootstrap admission is unavailable',()=>{
 const f=setup();try{const before=f.snapshot();expect(()=>f.submit()).toThrow(/fresh runnable/);expect(f.snapshot()).toBe(before);f.retire();expect(f.submit().status).toBe('applied');}finally{f.close();}
});
it('uses only exact operator-reviewed unused admission and preserves the old UNKNOWN reservation',async()=>{
 const f=setup();try{
  f.retire();f.config.owner_id='owner';f.config.persona_id=bot;f.reopen();
  const input={schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'old owner request'}};
  f.core.accept('owner',randomUUID(),createHash('sha256').update(JSON.stringify(input)).digest('hex'),input);
  const prior=f.core.bootstrap.assignedManifest()!;
  await expect(f.lifecycle.deliverOwnerAlphaWake(prior.transition_id,async()=>{throw Error('unknown');})).rejects.toThrow();
  f.setNow(prior.expires_at);f.lifecycle.watchdog();
  const old=()=>JSON.stringify({run:f.store.run(prior.run_id),wake:f.db.all('SELECT * FROM runtime_metadata WHERE key=?',`owner_alpha_wake:${prior.epoch}`),hold:f.db.all('SELECT * FROM runtime_metadata WHERE key=?',`owner_alpha_reservation:${prior.epoch}`)});
  const before=old();
  f.config.owner_id=f.grant.actor_id;f.config.persona_id=f.grant.persona_id;f.config.policy_revision='test-unused-successor';
  f.config.unused_recovery={kind:'unused-before-staging-v1',installation_id:prior.installation_id,owner_binding_sha256:prior.owner_binding_sha256,
   predecessor:{manifest_sha256:prior.manifest_sha256,epoch:prior.epoch,boot_id:prior.boot_id,transition_id:prior.transition_id,session_id:prior.session_id,run_id:prior.run_id},
   evidence:{sha256:'d'.repeat(64),observed_at:prior.expires_at,source:'reviewed-exclusive-unused-marker'},successor_policy_revision:f.config.policy_revision,expires_at:f.config.expires_at};
  f.config.unused_recovery.predecessor.manifest_sha256='e'.repeat(64);f.reopen();const unchanged=f.snapshot();expect(()=>f.submit()).toThrow();expect(f.snapshot()).toBe(unchanged);
  f.config.unused_recovery.predecessor.manifest_sha256=prior.manifest_sha256;f.reopen();
  const receipt=f.submit();expect(receipt.status).toBe('applied');expect(f.core.bootstrap.assignedManifest()?.epoch).toBe(prior.epoch+1);
  expect(old()).toBe(before);expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);
  expect(()=>f.campaign.run(f.grant.actor_id,prior.run_id)).toThrow();
 }finally{f.close();}
});
it('rolls back if grant expires during acceptance rather than retaining a late queued run',()=>{
 const f=setup();try{
  f.retire();const accept=f.core.accept.bind(f.core),before=f.snapshot();
  f.core.accept=(...args)=>{const receipt=accept(...args);f.setNow(f.grant.expires_at);return receipt;};
  expect(()=>f.submit()).toThrow(/authority unavailable/);expect(f.snapshot()).toBe(before);
 }finally{f.close();}
});
it.each(['budget','actor','persona','binding','expiry'] as const)('refuses %s bootstrap without dormant messages or reservations',mode=>{
 const f=setup();try{
  f.retire();if(mode==='budget')f.config.total_cap_micro_usd=1136999;
  else if(mode==='actor')f.config.owner_id='owner';else if(mode==='persona')f.config.persona_id=bot;else if(mode==='expiry')f.config.expires_at='2026-09-10T01:00:00.001Z';else f.config.owner_binding_sha256='b'.repeat(64);
  f.reopen();const before=f.snapshot();expect(()=>f.submit()).toThrow();expect(f.snapshot()).toBe(before);
 }finally{f.close();}
});
it('retains an uncertain claimed test and its reservation without replay or refund',()=>{
 const f=setup();try{
  f.retire();const r=f.submit(),m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(id.boot_id);f.lifecycle.ready(id);f.lifecycle.claim(id);
  f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)','uncertain-test-resource',r.resource_id!,f.core.now());
  f.setNow(m.expires_at);f.lifecycle.watchdog();expect(f.store.run(r.resource_id!).status).toBe('recovery_required');
  f.core.bootstrap.recordRetirement({...id,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at,direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'test-observer'});
  const before=f.snapshot();expect(()=>f.submit()).toThrow(/unsettled/);expect(f.snapshot()).toBe(before);expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(1);
 }finally{f.close();}
});
it('replays exact receipts, enforces one active and permanently counts settled submissions',()=>{
 const f=setup();try{
  f.retire();const key=randomUUID(),r=f.submit(key),before=f.snapshot();expect(f.submit(key)).toEqual(r);expect(f.snapshot()).toBe(before);
  expect(()=>f.submit()).toThrow(/unsettled/);expect(f.snapshot()).toBe(before);finish(f);
  const safe=f.campaign.run(f.grant.actor_id,r.resource_id!);expect(safe.result).toEqual({status:'completed',text:'HEHEBOT_NATIVE_TEST_OK'});expect(safe).not.toHaveProperty('context_json');expect(safe).not.toHaveProperty('checkpoint_json');
  const second=f.submit();finish(f);expect(second.id).not.toBe(r.id);const capped=f.snapshot();expect(()=>f.submit()).toThrow(/limit/);expect(f.snapshot()).toBe(capped);expect(f.submit(key)).toEqual(r);
 }finally{f.close();}
});
it.each(['archived','instructions','deleted'] as const)('rejects %s synthetic persona at submission and claim',mode=>{
 const f=setup();try{
  f.retire();const r=f.submit();
  if(mode==='deleted')f.db.exec('UPDATE objects SET deleted_at=? WHERE id=?',f.core.now(),f.grant.persona_id);
  else f.db.exec('UPDATE objects SET body_json=json_set(body_json,?,?) WHERE id=?',mode==='archived'?'$.archived':'$.instructions',mode==='archived'?1:'PRIVATE_REPLACEMENT',f.grant.persona_id);
  expect(()=>f.submit()).toThrow();const m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(id.boot_id);f.lifecycle.ready(id);const before=f.snapshot();expect(()=>f.lifecycle.claim(id)).toThrow();expect(f.snapshot()).toBe(before);expect(f.store.run(r.resource_id!).current_attempt).toBe(0);
 }finally{f.close();}
});
it('refuses owner persona adoption, altered grants/bindings and missing durable command provenance',()=>{
 const f=setup();try{
  const other=new ControlCore(f.store,{...f.core.options,testCampaignGrant:{...f.grant,campaign_id:randomUUID(),persona_id:bot}});expect(()=>new TestCampaign(other).initialize()).toThrow(/existing persona/);
  for(const patch of [{actor_id:'test-service:other'},{expires_at:'2026-09-10T02:00:00.000Z'},{max_submissions:3}])expect(()=>new TestCampaign(new ControlCore(f.store,{...f.core.options,testCampaignGrant:{...f.grant,...patch}})).initialize()).toThrow(/provenance/);
  expect(()=>new TestCampaign(new ControlCore(f.store,{...f.core.options,ownerBindingSha256:'b'.repeat(64)})).initialize()).toThrow(/binding/);
  f.retire();const r=f.submit();f.db.exec("DELETE FROM runtime_metadata WHERE key GLOB 'test_campaign_command:*'");
  expect(()=>f.campaign.receipt(f.grant.actor_id,r.id)).toThrow();expect(()=>f.core.context(f.grant.persona_id,text,null,null,r.id)).toThrow();
  const unmarked=f.core.accept('test-service:unconfigured',randomUUID(),'hash',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'PRIVATE_REQUEST'}});expect(unmarked.status).toBe('rejected');expect(unmarked.resource_id).toBeNull();
 }finally{f.close();}
});
it('denies foreign actors/campaigns/owner runs and returns only canonical run.result',()=>{
 const f=setup();try{
  f.retire();const r=f.submit();expect(()=>f.campaign.receipt('test-service:other',r.id)).toThrow();expect(()=>f.campaign.run('test-service:other',r.resource_id!)).toThrow();expect(()=>f.campaign.run(f.grant.actor_id,f.old.resource_id!)).toThrow();
  f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?',JSON.stringify({text:'PRIVATE_CHECKPOINT'}),r.resource_id!);
  f.store.event(randomUUID(),f.grant.persona_id,'run.result','owner',r.id,{run_id:r.resource_id,text:'PRIVATE_FORGED'},f.core.now());expect(f.campaign.run(f.grant.actor_id,r.resource_id!).result).toBeNull();
  const other=new TestCampaign(new ControlCore(f.store,{...f.core.options,testCampaignGrant:{...f.grant,campaign_id:randomUUID(),persona_id:randomUUID()}}));other.initialize();expect(()=>other.receipt(f.grant.actor_id,r.id)).toThrow();expect(()=>other.run(f.grant.actor_id,r.resource_id!)).toThrow();
 }finally{f.close();}
});
it('rejects at exact expiry without bricking initialization or owner diagnostics',()=>{
 const f=setup(2,'2026-09-10T00:02:10.000Z');try{
  f.retire();const r=f.submit(),m=f.core.bootstrap.assignedManifest()!,id={epoch:m.epoch,boot_id:m.boot_id};f.lifecycle.registerBoot(id.boot_id);f.lifecycle.ready(id);
  f.setNow('2026-09-10T00:02:09.999Z');expect(f.campaign.receipt(f.grant.actor_id,r.id).id).toBe(r.id);
  f.setNow(f.grant.expires_at);const before=f.snapshot();expect(()=>f.reopen().initialize()).not.toThrow();expect(()=>f.submit()).toThrow();expect(()=>f.campaign.receipt(f.grant.actor_id,r.id)).toThrow();expect(()=>f.core.context(f.grant.persona_id,text,null,null,r.id)).toThrow();expect(f.snapshot()).toBe(before);expect(()=>f.core.state()).not.toThrow();
  expect(()=>f.lifecycle.claim(id)).toThrow(/executor lease expired/);expect(f.snapshot()).toBe(before);
  const expired={...f.grant,campaign_id:randomUUID(),persona_id:randomUUID()};new TestCampaign(new ControlCore(f.store,{...f.core.options,testCampaignGrant:expired})).initialize();expect(f.db.all('SELECT id FROM objects WHERE id=?',expired.persona_id)).toEqual([]);
 }finally{f.close();}
});
