import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { OutputPreviews, type OutputPreview } from '../src/core/output-preview';
import { NativeTaskLedger } from '../src/core/native-tasks';

let f:ReturnType<typeof fixture>,life:LifecycleCore,identity:Identity,previews:OutputPreviews,input:OutputPreview;
beforeEach(()=>{
 f=fixture(true);life=new LifecycleCore(f.store,f.core);previews=new OutputPreviews(f.store,()=>f.core.now());
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 identity=life.registerBoot(randomUUID());life.ready(identity);
 const run=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic task'}}).resource_id!;
 life.claim(identity);life.submitted(identity,run,1,'native-root-31');
 input={run_id:run,attempt:1,native_ref:'native-root-31',version:1,text:'Provisional text 43',truncated:false};
});
afterEach(()=>f.close());
const record=(value=input)=>previews.record(identity,value,life);
const stored=()=>f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'output-preview:*'");

it('records and reads previews without historical run bodies',()=>{
 const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
 f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,input.run_id);
 const read=vi.spyOn(f.db,'all');
 try{
  record();record();
  expect(previews.read(input.run_id,1)).toEqual({run_id:input.run_id,attempt:1,version:1,text:input.text,truncated:false});
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",input.run_id);
  expect(previews.read(input.run_id,1)).toBeNull();
  const rows=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
  expect(rows).toEqual([
   ...Array.from({length:2},()=>({id:input.run_id,current_attempt:1,status:'running',error_code:null})),
   {current_attempt:1,status:'running',error_code:null},{current_attempt:1,status:'completed',error_code:null}
  ]);
 }finally{read.mockRestore();}
 expect(f.store.run(input.run_id)).toMatchObject({context_json:context,checkpoint_json:checkpoint});
});

it('publishes only a bounded display snapshot without settling or changing task obligations',()=>{
 const tables=['runs','attempts','lifecycle','effects','resource_locks','operations','outbox','events'];
 const before=tables.map(table=>f.db.all(`SELECT * FROM ${table}`));record();
 expect(previews.read(input.run_id,1)).toEqual({run_id:input.run_id,attempt:1,version:1,text:input.text,truncated:false});
 expect(tables.map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
 expect(f.core.state().output_previews).toHaveLength(1);
 expect(JSON.stringify(f.core.state().output_previews)).not.toContain('native-root-31');
 expect(()=>life.prepareSleep(identity)).toThrow();
});

it('replays an identical version without writes, rejects conflicts/stale versions and accepts a later snapshot',()=>{
 record();const before=stored();record();expect(stored()).toEqual(before);
 expect(()=>record({...input,text:'Changed'})).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
 expect(stored()).toEqual(before);
 record({...input,version:7,text:'Later exact snapshot',truncated:true});
 expect(()=>record({...input,version:2})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
 expect(previews.read(input.run_id,1)).toMatchObject({version:7,text:'Later exact snapshot',truncated:true});
});

it.each(['native','attempt','epoch','boot','deadline','cancel','context'])('rejects %s custody changes without altering a preview',kind=>{
 record();const before=stored();
 if(kind==='native')input.native_ref='other-native';
 if(kind==='attempt')input.attempt=2;
 if(kind==='epoch')identity.epoch++;
 if(kind==='boot')identity.boot_id=randomUUID();
 if(kind==='deadline')f.db.exec('UPDATE attempts SET deadline_at=?',f.core.now());
 if(kind==='cancel')f.accept({schema_version:1,type:'run.cancel',payload:{run_id:input.run_id,reason:'Stop'}});
 if(kind==='context')f.db.exec("UPDATE runs SET error_code='CONTEXT_INVALIDATED'");
 expect(()=>record({...input,version:2})).toThrow();expect(stored()).toEqual(before);
 if(['cancel','context'].includes(kind))expect(previews.read(input.run_id,1)).toBeNull();
});

it('keeps child output distinct after root completion and hides old attempt or terminal previews',()=>{
 record();const ledger=new NativeTaskLedger(f.store,f.core,life);
 const child=ledger.register(identity,{parent_run_id:input.run_id,parent_attempt:1,persona_id:bot,native_run_ref:'native-child-73',native_session_key:'child-session',title:'Child'},true);
 const childInput={...input,run_id:child.id,native_ref:'native-child-73',text:'Child only'};
 life.complete(identity,input.run_id,1,{status:'completed',text:'Final root result'});
 record(childInput);
 expect(previews.read(input.run_id,1)).toBeNull();
 expect(f.core.state().output_previews).toEqual([{run_id:child.id,attempt:1,version:1,text:'Child only',truncated:false}]);
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?',child.id);
 expect(previews.read(child.id,1)).toBeNull();expect(previews.read(child.id,2)).toBeNull();
});

it('expires at exactly 90 days without allowing later snapshots to extend the deadline',()=>{
 record();const expiry=previews.nextDue();
 f.setNow('2026-09-10T00:00:30.000Z');record({...input,version:2});expect(previews.nextDue()).toBe(expiry);
 f.db.exec("UPDATE runs SET status='recovery_required'");
 f.setNow('2026-12-08T23:59:59.999Z');expect(previews.read(input.run_id,1)).not.toBeNull();expect(previews.prune()).toBe(0);
 f.setNow('2026-12-09T00:00:00.000Z');expect(previews.read(input.run_id,1)).toBeNull();expect(previews.prune()).toBe(1);expect(previews.nextDue()).toBeNull();
 expect(f.store.run(input.run_id).status).toBe('recovery_required');
});

it('memory invalidation physically discards the affected active preview and rejects late publication',()=>{
 const id=randomUUID();
 f.store.put(id,'memory',{text:'Memory canary',scope:{kind:'global',id:null},expires_at:null},0,'owner',f.core.now());
 const context=JSON.parse(f.store.run(input.run_id).context_json);context.memories=[f.store.get(id)];
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),input.run_id);record();
 expect(f.accept({schema_version:1,type:'memory.delete',payload:{id,expected_revision:1,purge_transcripts:false}}).status).toBe('applied');
 expect(stored()).toEqual([]);expect(()=>record({...input,version:2})).toThrow();
});

it('accepts the exact text bound and rejects an oversized or invalid version without truncating silently',()=>{
 record({...input,text:'x'.repeat(8192)});const before=stored();
 for(const change of [{text:'x'.repeat(8193)},{version:0},{version:1.5}])expect(()=>record({...input,...change})).toThrow();
 expect(stored()).toEqual(before);
});
