import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {fixture,bot,otherBot} from './helpers';

function source(f:ReturnType<typeof fixture>){
 const event=randomUUID();f.store.event(event,bot,'message.user','owner',null,{text:'Source 73'},f.core.now());
 return {id:randomUUID(),expected_revision:0,scope:{kind:'persona' as const,id:bot},text:'Original café 73. Keep all source details.',source_event_id:event,expires_at:null as string|null,sensitivity:'ordinary' as const,explicit_constraint:false};
}
// Public v1 wire algorithm, independent of production implementation.
function summarize(p:ReturnType<typeof source>){
 const values=[1,p.id,p.expected_revision+1,p.scope.kind,p.scope.id,p.text,p.source_event_id,p.expires_at,p.sensitivity,false];
 return {...p,summary:{schema_version:1,source_sha256:createHash('sha256').update(JSON.stringify(values)).digest('hex'),text:'Owner summary 29.'}};
}
const save=(f:ReturnType<typeof fixture>,payload:unknown)=>f.accept({schema_version:1,type:'memory.put',payload} as never);

it('stores an owner summary with the exact versioned source, without inference, wake or raw-text replacement',()=>{
 const f=fixture();try{
  const p=summarize(source(f)),before=f.db.all('SELECT * FROM lifecycle');
  expect(save(f,p).status).toBe('applied');
  const stored=f.store.get(p.id);expect(stored).toMatchObject({revision:1,body:p});
  expect(JSON.parse(f.db.all<{body_json:string}>('SELECT body_json FROM object_revisions WHERE object_id=?',p.id)[0].body_json)).toEqual(p);
  const context=f.core.context(bot,'Read',null,null);
  expect(context.memories[0].body.text).toBe(p.text);
  expect(context.persona.body.tool_policy_ids).toEqual([]);expect(context.authorization_policy_ids).toEqual([]);
  expect(f.db.all('SELECT * FROM runs')).toEqual([]);expect(f.db.all('SELECT * FROM lifecycle')).toEqual(before);
 }finally{f.close();}
});

it.each(['id','revision','scope','text','source','expiry','sensitivity'] as const)('rejects a summary transplanted to changed %s atomically',field=>{
 const f=fixture();try{
  const p=summarize(source(f));expect(save(f,p).status).toBe('applied');
  const changed={...p};
  if(field==='id')changed.id=randomUUID();
  if(field==='revision')changed.expected_revision=1;
  if(field==='scope')changed.scope={kind:'persona',id:otherBot};
  if(field==='text')changed.text=p.text.replace('café','cafe\u0301');
  if(field==='source')changed.source_event_id=source(f).source_event_id;
  if(field==='expiry')changed.expires_at='2026-09-11T00:00:00.000Z';
  if(field==='sensitivity')Object.assign(changed,{sensitivity:'sensitive'});
  const before=f.db.all('SELECT * FROM objects'),revisions=f.db.all('SELECT * FROM object_revisions');
  expect(save(f,changed)).toMatchObject({status:'rejected',error:{code:'MEMORY_SUMMARY_STALE'}});
  expect(f.db.all('SELECT * FROM objects')).toEqual(before);expect(f.db.all('SELECT * FROM object_revisions')).toEqual(revisions);
 }finally{f.close();}
});

it.each([true,undefined])('does not summarize current or unclassified constraints (%s)',flag=>{
 const f=fixture();try{
  const p=summarize(source(f));
  expect(save(f,{...p,explicit_constraint:flag})).toMatchObject({status:'rejected',error:{code:'MEMORY_SUMMARY_CONSTRAINT'}});
  expect(f.db.all("SELECT * FROM objects WHERE kind='memory'")).toEqual([]);
 }finally{f.close();}
});

it('checks inherited constraint authority before accepting summary metadata',()=>{
 const f=fixture();try{
  const original={...source(f),explicit_constraint:true};expect(save(f,original).status).toBe('applied');
  const candidate=summarize({...original,expected_revision:1});
  const {explicit_constraint:_,...legacy}=candidate;
  expect(save(f,legacy)).toMatchObject({status:'rejected',error:{code:'MEMORY_SUMMARY_CONSTRAINT'}});
  expect(f.store.get(original.id)).toMatchObject({revision:1,body:{explicit_constraint:true}});
  // Only an explicit owner false, at the current revision, changes classification.
  expect(save(f,{...candidate,explicit_constraint:false}).status).toBe('applied');
 }finally{f.close();}
});

it('uses code-point rather than UTF-16 summary limits and still rejects one-over',()=>{
 const f=fixture();try{
  const p=summarize(source(f));p.summary.text='🧭'.repeat(2000);
  expect(save(f,p).status).toBe('applied');
  const next=summarize({...p,expected_revision:1});next.summary.text=p.summary.text+'x';
  expect(()=>save(f,next)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(f.store.get(p.id).revision).toBe(1);
 }finally{f.close();}
});

it('requires fresh adoption for each revision and clears omitted summaries on legacy edits',()=>{
 const f=fixture();try{
  const p=summarize(source(f));expect(save(f,p).status).toBe('applied');
  const revised=summarize({...p,expected_revision:1,text:'Owner corrected source 91.'});
  expect(save(f,revised).status).toBe('applied');
  const {summary:_,explicit_constraint:__,...legacy}=revised;
  expect(save(f,{...legacy,expected_revision:2,text:'Legacy correction 47.'}).status).toBe('applied');
  expect(f.store.get(p.id).body).toMatchObject({explicit_constraint:false,text:'Legacy correction 47.'});
  expect(f.store.get(p.id).body).not.toHaveProperty('summary');
 }finally{f.close();}
});

it('purges summary and source together from current/revision/command custody on expiry',()=>{
 const f=fixture();try{
  const p=summarize({...source(f),expires_at:'2026-09-10T00:00:01.000Z'});
  expect(save(f,p).status).toBe('applied');f.setNow(p.expires_at!);expect(f.core.expireMemories()).toBe(1);
  expect(f.db.all('SELECT body_json FROM objects WHERE id=?',p.id)).toEqual([{body_json:'{}'}]);
  expect(f.db.all('SELECT body_json FROM object_revisions WHERE object_id=?',p.id)).toEqual([{body_json:'{}'}]);
  expect(f.db.all("SELECT payload_json FROM commands WHERE type='memory.put'")).toEqual([{payload_json:'{}'}]);
 }finally{f.close();}
});

it.each([{schema_version:2},{source_sha256:'A'.repeat(64)},{text:''},{text:'a'.repeat(2001)},{authority:'owner'}])('rejects malformed summary metadata %j',change=>{
 const f=fixture();try{
  const p=summarize(source(f));expect(()=>save(f,{...p,summary:{...p.summary,...change}})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
 }finally{f.close();}
});
