import {expect,it} from 'vitest';
import {ControlError} from '../src/core/errors';
import {parseOwnerAlphaWarm,warmLedgerUsed} from '../src/core/owner-alpha-warm';
import {TestDatabase,bot} from './helpers';

const valid={schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:'personal',owner_id:'actual-owner',
 owner_binding_sha256:'a'.repeat(64),policy_revision:'warm-stage-a-v1',persona_id:bot,
 text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},
 expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:2,
 prior_cost_micro_usd:1000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:1000000,reservation_micro_usd:2000};
const seedRetirement={epoch:1,boot_id:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-000000000002',
 transition_id:null,observed_at:'2026-09-19T00:01:30.000Z',direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};

function rejects(label:string,value:unknown):void{
 it(`rejects ${label}`,()=>{
  expect(()=>parseOwnerAlphaWarm(JSON.stringify(value))).toThrow(ControlError);
  try{parseOwnerAlphaWarm(JSON.stringify(value));}catch(error){
   expect(error).toBeInstanceOf(ControlError);
   expect((error as ControlError).status).toBe(503);
   expect((error as ControlError).code).toBe('INVALID_CONFIGURATION');
  }
 });
}
it('parses the exact opt-in configuration without widening legacy bootstrap semantics',()=>{
 expect(parseOwnerAlphaWarm(JSON.stringify(valid))).toEqual(valid);
 expect(parseOwnerAlphaWarm(undefined)).toBeUndefined();
 expect(parseOwnerAlphaWarm('')).toBeUndefined();
});
it('parses the optional trusted seed retirement for an initial hosted predecessor',()=>{
 const withSeed={...valid,seed_retirement:seedRetirement};
 expect(parseOwnerAlphaWarm(JSON.stringify(withSeed))).toEqual(withSeed);
});
it('rejects invalid JSON without leaking configuration contents',()=>{
 try{parseOwnerAlphaWarm('{not json');expect.fail('unreachable');}catch(error){
  expect(error).toBeInstanceOf(ControlError);
  expect((error as ControlError).status).toBe(503);
  expect((error as ControlError).code).toBe('INVALID_CONFIGURATION');
 }
});
rejects('a wrong kind',  {...valid,kind:'owner-alpha-bootstrap-v1'});
rejects('a future schema version',  {...valid,schema_version:2});
rejects('a permissive admission bound',  {...valid,max_admissions:3});
rejects('a single-admission bound',  {...valid,max_admissions:1});
rejects('a zero reservation',  {...valid,reservation_micro_usd:0});
rejects('a negative reservation',  {...valid,reservation_micro_usd:-1});
rejects('a non-integer reservation',  {...valid,reservation_micro_usd:2000.5});
rejects('unknown extra keys',  {...valid,unexpected:true});
rejects('a wrong text-only profile version',  {...valid,text_only:{profile_version:'codex-text-only-v2',profile_sha256:'c'.repeat(64)}});
rejects('a wrong text-only profile digest',  {...valid,text_only:{profile_version:'codex-text-only-v1',profile_sha256:'cc'}});
rejects('a task window above the 300-second ceiling',  {...valid,max_task_seconds:301});
rejects('a zero task window',  {...valid,max_task_seconds:0});
rejects('a misbound owner',  {...valid,owner_id:'runtime:executor'});
rejects('a malformed seed retirement',  {...valid,seed_retirement:{...seedRetirement,epoch:0}});
rejects('an unsettled seed retirement',  {...valid,seed_retirement:{...seedRetirement,direct_child_stopped:false}});

it('sums the shared lifetime ledger prefix exactly once, including warm suffixes',()=>{
 const db=new TestDatabase();
 try{
  expect(warmLedgerUsed(db,1000)).toBe(1000);
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('owner_alpha_reservation:1',?)",JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1500}));
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('owner_alpha_reservation:2:1',?)",JSON.stringify({manifest_sha256:'e'.repeat(64),micro_usd:2000}));
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('owner_alpha_reservation:2:2',?)",JSON.stringify({manifest_sha256:'f'.repeat(64),micro_usd:2000}));
  expect(warmLedgerUsed(db,1000)).toBe(6500);
 }finally{db.close();}
});
it('fails the lifetime ledger closed on corrupt, invalid or overflowing entries',()=>{
 const cases=[
  ['an unknown shape','owner_alpha_reservation:1',JSON.stringify({micro_usd:1})],
  ['an extra field','owner_alpha_reservation:1',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1,extra:true})],
  ['a zero amount','owner_alpha_reservation:1',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:0})],
  ['a non-integer amount','owner_alpha_reservation:1',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1.5})],
  ['a bad digest','owner_alpha_reservation:1',JSON.stringify({manifest_sha256:'dd',micro_usd:1})],
  ['a foreign key namespace','owner_alpha_reservation:x',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1})],
  ['a wrong suffix','owner_alpha_reservation:2:3',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1})]
 ] as const;
 for(const [label,key,value] of cases){
  const db=new TestDatabase();
  try{
   db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,value);
   try{warmLedgerUsed(db,1);expect.fail(`${label} must fail closed`);}catch(error){
    expect(error).toBeInstanceOf(ControlError);
    expect((error as ControlError).status).toBe(503);
    expect((error as ControlError).code).toBe('INVALID_CONFIGURATION');
   }
  }finally{db.close();}
 }
 const db=new TestDatabase();
 try{
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('owner_alpha_reservation:1',?)",JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:1}));
  try{warmLedgerUsed(db,Number.MAX_SAFE_INTEGER);expect.fail('overflow must fail closed');}catch(error){
   expect(error).toBeInstanceOf(ControlError);
   expect((error as ControlError).status).toBe(503);
  }
 }finally{db.close();}
});
