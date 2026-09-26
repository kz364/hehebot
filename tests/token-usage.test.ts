import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bot, fixture } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { TokenUsageSnapshots, type TokenUsageCounts, type TokenUsageSnapshot } from '../src/core/token-usage';

let f:ReturnType<typeof fixture>, lifecycle:LifecycleCore, identity:Identity, snapshots:TokenUsageSnapshots, input:TokenUsageSnapshot;
const counts=(seed:number):TokenUsageCounts=>({inputTokens:seed,cachedInputTokens:seed+1,cacheWriteInputTokens:seed+2,outputTokens:seed+3,reasoningOutputTokens:seed+4,totalTokens:seed+5});
beforeEach(()=>{
 f=fixture(true);lifecycle=new LifecycleCore(f.store,f.core);snapshots=new TokenUsageSnapshots(f.store,()=>f.core.now());
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
 const run=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Measure usage'}}).resource_id!;
 lifecycle.claim(identity);lifecycle.submitted(identity,run,1,'native-usage');
 input={run_id:run,attempt:1,native_ref:'native-usage',version:1,usage:{total:counts(10),last:counts(100),modelContextWindow:200000}};
});
afterEach(()=>f.close());
const rows=()=>f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'token-usage:*'");
const record=(value=input)=>snapshots.record(identity,value,lifecycle);

it('records and reads usage without historical run bodies',()=>{
 const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
 f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,input.run_id);
 const read=vi.spyOn(f.db,'all');
 try{
  record();record();
  expect(snapshots.read(input.run_id,1)).toEqual({run_id:input.run_id,attempt:1,version:1,usage:input.usage});
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",input.run_id);
  expect(snapshots.read(input.run_id,1)).toEqual({run_id:input.run_id,attempt:1,version:1,usage:input.usage});
  const returned=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
  expect(returned).toEqual([
   ...Array.from({length:2},()=>({current_attempt:1,status:'running',error_code:null})),
   {current_attempt:1},{current_attempt:1}
  ]);
 }finally{read.mockRestore();}
 expect(f.store.run(input.run_id)).toMatchObject({context_json:context,checkpoint_json:checkpoint});
});

it('stores asymmetric observations without summing and mutates no task custody',()=>{
 const tables=['runs','attempts','lifecycle','events','effects','resource_locks','operations','outbox'];
 const before=tables.map(table=>f.db.all(`SELECT * FROM ${table}`));record();
 expect(snapshots.read(input.run_id,1)).toEqual({run_id:input.run_id,attempt:1,version:1,usage:input.usage});
 expect(tables.map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
 expect(JSON.stringify(snapshots.read(input.run_id,1))).not.toContain('native-usage');
});

it('accepts decreased counts as a replacement, not a sum',()=>{
 record();const usage={total:counts(1),last:counts(0),modelContextWindow:null};
 record({...input,version:2,usage});expect(snapshots.read(input.run_id,1)?.usage).toEqual(usage);
});

it('does no write for an identical version and rejects conflict and stale versions',()=>{
 record();const before=rows();record();expect(rows()).toEqual(before);
 const reversed=Object.fromEntries(Object.entries(input.usage.total).reverse()) as TokenUsageCounts;
 record({...input,usage:{modelContextWindow:input.usage.modelContextWindow,last:input.usage.last,total:reversed}});expect(rows()).toEqual(before);
 expect(()=>record({...input,usage:{...input.usage,last:counts(5)}})).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
 record({...input,version:4,usage:{...input.usage,total:counts(2)}});
 expect(()=>record({...input,version:3})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
});

it.each(['attempt','native','epoch','boot','deadline','cancel','context'] as const)('fences %s custody with USAGE_FENCED and preserves the snapshot',kind=>{
 record();const before=rows();
 if(kind==='attempt')input.attempt=2;
 if(kind==='native')input.native_ref='wrong-native';
 if(kind==='epoch')identity.epoch++;
 if(kind==='boot')identity.boot_id=randomUUID();
 if(kind==='deadline')f.db.exec('UPDATE attempts SET deadline_at=?',f.core.now());
 if(kind==='cancel')f.accept({schema_version:1,type:'run.cancel',payload:{run_id:input.run_id,reason:'stop'}});
 if(kind==='context')f.db.exec("UPDATE runs SET error_code='CONTEXT_INVALIDATED'");
 expect(()=>record({...input,version:2})).toThrowError(expect.objectContaining({code:'USAGE_FENCED'}));expect(rows()).toEqual(before);
});

it('allows terminal reads as historical observations but only for the current attempt',()=>{
 record();f.db.exec("UPDATE runs SET status='completed'");expect(snapshots.read(input.run_id,1)).not.toBeNull();
 f.db.exec('UPDATE runs SET current_attempt=2');expect(snapshots.read(input.run_id,1)).toBeNull();expect(snapshots.read(input.run_id,2)).toBeNull();
});

it('expires 90 days from the first snapshot and prunes in ordinary maintenance',()=>{
 record();const due=snapshots.nextDue();expect(due).toBe('2026-12-09T00:00:00.000Z');
 f.setNow('2026-09-10T00:01:00.000Z');record({...input,version:2});expect(snapshots.nextDue()).toBe(due);
 f.setNow('2026-12-08T23:59:59.999Z');expect(snapshots.read(input.run_id,1)).not.toBeNull();expect(snapshots.prune()).toBe(0);
 f.setNow(due!);expect(snapshots.read(input.run_id,1)).toBeNull();expect(snapshots.prune()).toBe(1);expect(snapshots.nextDue()).toBeNull();
});

it('returns null when no snapshot exists',()=>expect(snapshots.read(input.run_id,1)).toBeNull());

it('validates exact nested numeric structure before touching custody',()=>{
 const invalid:unknown[]=[
  {...input,extra:true}, {...input,usage:{...input.usage,extra:1}},
  {...input,usage:{...input.usage,total:{...input.usage.total,inputTokens:-1}}},
  {...input,usage:{...input.usage,last:{...input.usage.last,totalTokens:1.5}}},
  {...input,usage:{...input.usage,modelContextWindow:Infinity}},
  {...input,usage:{...input.usage,total:{...input.usage.total,unknown:0}}},
 ];
 for(const value of invalid)expect(()=>record(value as TokenUsageSnapshot)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
 expect(rows()).toEqual([]);
});
