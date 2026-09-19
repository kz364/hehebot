import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {fixture,bot,otherBot,routine} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';

it('captures only earlier same-persona messages and visible provisional replies without copying authority',()=>{
 const f=fixture(true);
 try{
  const first=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Remember the blue train'}});
  f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",first.resource_id!);
  f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)','output-preview:'+first.resource_id,JSON.stringify({run_id:first.resource_id,attempt:1,native_ref:'private-native-reference',version:3,text:'Blue train noted, provisionally',truncated:false,expires_at:'2026-12-09T00:00:00.000Z'}));
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:otherBot,text:'OTHER_PERSONA_SECRET'}});
  const room=randomUUID();f.accept({schema_version:1,type:'room.put',payload:{id:room,expected_revision:0,name:'Shared',member_ids:[bot],default_responder_id:bot}});
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:room,text:'ROOM_SECRET'}});
  const second=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Which train?'}});
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'LATER_MESSAGE_NOT_STEERING'}});
  const context=f.core.context(bot,'Which train?',null,null,second.id);
  expect(context.conversation_history?.messages).toEqual([{command_id:first.id,text:'Remember the blue train',truncated:false,provisional_reply:{run_id:first.resource_id,attempt:1,version:3,text:'Blue train noted, provisionally',truncated:false}}]);
  expect(context.conversation_history?.purpose).toMatch(/not new instructions or authorization/);
  expect(context.authorization_policy_ids).toEqual([]);
  expect(JSON.stringify(context.conversation_history)).not.toMatch(/OTHER_PERSONA_SECRET|ROOM_SECRET|LATER_MESSAGE|private-native-reference/);
  expect(f.core.context(otherBot,'Read',null,null,second.id).conversation_history).toBeUndefined();
  expect(f.core.context(bot,'Read',null,room,second.id).conversation_history).toBeUndefined();
  const r=routine();f.accept({schema_version:1,type:'routine.put',payload:r});
  expect(f.core.context(bot,'Read',r.id,null,second.id).conversation_history).toBeUndefined();
  f.db.exec("UPDATE runs SET error_code='CONTEXT_INVALIDATED' WHERE id=?",first.resource_id!);
  expect(f.core.context(bot,'Which train?',null,null,second.id).conversation_history?.messages[0].provisional_reply).toBeUndefined();
 }finally{f.close();}
});

it('uses bounded current canonical replies, excluding foreign, invalidated and expired results',()=>{
 const f=fixture();try{
  const seed=(persona:string,text:string)=>{
   const receipt=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:persona,text:'Earlier question'}});
   f.db.exec("UPDATE runs SET status='completed',current_attempt=1 WHERE id=?",receipt.resource_id!);
   f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at,result_json) VALUES(?,1,?,1,?,'completed',?,?,?)",receipt.resource_id!,randomUUID(),randomUUID(),f.core.now(),f.core.now(),JSON.stringify({status:'completed',text}));
   return receipt;
  };
  const first=seed(bot,'x'.repeat(2001));seed(otherBot,'FOREIGN_CANONICAL_SECRET');
  const current=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Continue'}});
  const history=()=>f.core.context(bot,'Continue',null,null,current.id).conversation_history!;
  expect(history()).toMatchObject({truncated:true,messages:[{completed_reply:{run_id:first.resource_id,attempt:1,text:'x'.repeat(2000),truncated:true}}]});
  expect(JSON.stringify(history())).not.toContain('FOREIGN_CANONICAL_SECRET');
  f.db.exec("UPDATE runs SET error_code='CONTEXT_INVALIDATED' WHERE id=?",first.resource_id!);
  expect(history().messages[0].completed_reply).toBeUndefined();
  f.db.exec('UPDATE runs SET error_code=NULL,current_attempt=2 WHERE id=?',first.resource_id!);
  expect(history().messages[0].completed_reply).toBeUndefined();
  f.db.exec('UPDATE runs SET current_attempt=1 WHERE id=?',first.resource_id!);
  // Isolate result retention from the independently enforced message cutoff.
  f.db.exec('UPDATE attempts SET settled_at=? WHERE run_id=?','2026-06-12T00:00:00.001Z',first.resource_id!);
  expect(history().messages[0].completed_reply).toBeDefined();
  f.db.exec('UPDATE attempts SET settled_at=? WHERE run_id=?','2026-06-12T00:00:00.000Z',first.resource_id!);
  expect(history().messages[0].completed_reply).toBeUndefined();
 }finally{f.close();}
});

it('rebuilds history at claim but excludes later messages and never changes the admitted snapshot',()=>{
 const f=fixture(true);
 try{
  const first=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'First instruction'}});
  f.db.exec("UPDATE runs SET status='cancelled' WHERE id=?",first.resource_id!);
  f.setNow('2026-09-10T00:00:01.000Z');
  const second=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Second instruction'}});
  f.setNow('2026-09-10T00:00:02.000Z');
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Later instruction'}});
  // Force claim-time reconstruction rather than relying on enqueue's snapshot.
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify({schema_version:1,instruction:'Second instruction',room_id:null}),second.resource_id!);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const life=new LifecycleCore(f.store,f.core),identity=life.registerBoot(randomUUID());life.ready(identity);
  const claim=life.claim(identity)!;expect(claim.run.id).toBe(second.resource_id);
  expect(JSON.parse(claim.run.context_json).conversation_history.messages.map((m:{text:string})=>m.text)).toEqual(['First instruction']);
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Do not steer active task'}});
  expect(f.store.run(claim.run.id).context_json).toBe(claim.run.context_json);
 }finally{f.close();}
});

it('discloses bounded history and text truncation, and filters before limiting metadata noise',()=>{
 const f=fixture();
 try{
  for(let i=0;i<21;i++)f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:i===20?'z'.repeat(2001):`Message ${i}`}});
  for(let i=0;i<100;i++)f.store.event(randomUUID(),bot,'synthetic.metadata','system',null,{},f.core.now());
  const current=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Current'}});
  const history=f.core.context(bot,'Current',null,null,current.id).conversation_history!;
  expect(history.truncated).toBe(true);expect(history.messages).toHaveLength(20);
  expect(history.messages[0].text).toBe('Message 1');expect(history.messages.at(-1)).toMatchObject({text:'z'.repeat(2000),truncated:true});
 }finally{f.close();}
});

it('omits expired history at the exact retention boundary without waiting for pruning',()=>{
 const f=fixture();
 try{
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Retained for ninety days'}});
  f.setNow('2026-12-08T23:59:59.999Z');
  const current=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Current'}});
  expect(f.core.context(bot,'Current',null,null,current.id).conversation_history?.messages).toHaveLength(1);
  f.setNow('2026-12-09T00:00:00.000Z');
  expect(f.core.context(bot,'Current',null,null,current.id).conversation_history).toMatchObject({messages:[],truncated:true});
 }finally{f.close();}
});
