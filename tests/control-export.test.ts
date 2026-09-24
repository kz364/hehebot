import { afterEach, beforeEach, expect, it } from 'vitest';
import { exportControl } from '../src/core/control-export';
import { fixture, bot } from './helpers';
import type { Database } from '../src/core/store';
import {legacyOccurrences} from './legacy-occurrences';

let f:ReturnType<typeof fixture>;
beforeEach(()=>{f=fixture();});
afterEach(()=>f.close());

it('exports one read transaction with exact typed values, int64 and deleted-event high water',()=>{
 const now=f.core.now(),run=f.core.enqueue(bot,'private instruction',null,null,null);
 f.db.exec("INSERT INTO rate_limits VALUES('huge',-9223372036854775808,9223372036854775807)");
 f.db.exec("UPDATE runs SET checkpoint_json=?,status='recovery_required' WHERE id=?",'quote " and slash \\ and NUL \0 雪',run);
 f.store.event('event-1',bot,'test','owner',null,{text:'retained'},now);
 f.db.exec("UPDATE sqlite_sequence SET seq=703 WHERE name='events'");
 const before=f.db.all('SELECT * FROM runs');
 let inside=false,transactions=0;
 const db:Database={
  all:(sql,...values)=>{expect(inside).toBe(true);return f.db.all(sql,...values);},
  exec:()=>{throw new Error('Export must not write');},
  transaction:fn=>f.db.transaction(()=>{transactions++;inside=true;try{return fn();}finally{inside=false;}}),
 };
 const exported=JSON.parse(exportControl(db,now));
 expect(transactions).toBe(1);expect(exported).toMatchObject({format:'hehebot-control-export',version:1,createdAt:now,schemaVersions:[14],schemaSha256:'1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb'});
 const table=(name:string)=>exported.tables.find((value:{name:string})=>value.name===name);
 expect(table('rate_limits')).toEqual({name:'rate_limits',columns:['subject','window_start','count'],rows:[[
  {type:'text',value:'huge'},{type:'integer',value:'-9223372036854775808'},{type:'integer',value:'9223372036854775807'},
 ]]});
 expect(table('sqlite_sequence').rows).toEqual([[{type:'text',value:'events'},{type:'integer',value:'703'}]]);
 const runTable=table('runs'),row=runTable.rows.find((cells:{value:string}[])=>cells[0].value===run);
 expect(row[runTable.columns.indexOf('checkpoint_json')]).toEqual({type:'text',value:'quote " and slash \\ and NUL \0 雪'});
 expect(row[runTable.columns.indexOf('parent_run_id')]).toEqual({type:'null',value:null});
 expect(exported.tables.map((value:{name:string})=>value.name)).toEqual(exported.tables.map((value:{name:string})=>value.name).sort());
 expect(f.db.all('SELECT * FROM runs')).toEqual(before);
 expect(exportControl(f.db,now)).toBe(JSON.stringify(exported));
});

it.each(["INSERT INTO rate_limits VALUES(x'6162',1,2)","INSERT INTO rate_limits VALUES('fraction',1,1.25)"])(
 'rejects unsupported storage types without coercion: %s',sql=>{
  f.db.exec(sql);
  expect(()=>exportControl(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'UNSUPPORTED_DATA'}));
 });

it.each(['raw','escaped','rows'])('rejects oversized %s before returning a partial export',kind=>{
 if(kind==='rows')f.db.exec("WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10001) INSERT INTO rate_limits SELECT CAST(n AS TEXT),1,1 FROM seq");
 else f.db.exec('INSERT INTO rate_limits VALUES(?,1,1)',kind==='raw'?'x'.repeat(4*1024*1024):'\u0001'.repeat(750000));
 expect(()=>exportControl(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'EXPORT_LIMIT'}));
});

it.each([9,10,11,12])('keeps v%s exports readable without migration or fabricated attribution',version=>{
 f.db.exec('DROP INDEX objects_memory_scope');
 legacyOccurrences(f.db.sqlite);
 if(version<12)f.db.exec('ALTER TABLE attempts DROP COLUMN captured_routine_revision');
 if(version<11){
  f.db.exec('DROP TABLE native_task_links');
  f.db.exec('CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)');
 }
 if(version===9)f.db.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json');
 f.db.exec('UPDATE schema_versions SET version=? WHERE version=14',version);
 const before=f.db.all('SELECT total_changes() AS n');
 const exported=JSON.parse(exportControl(f.db,f.core.now()));
 expect(exported).toMatchObject({schemaVersions:[version],schemaSha256:version===9?'15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c':version===10?'682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4':version===11?'8bd40b2cb56bf706a72006fe4a54cf310d1620ec3c0d408af4429d5cf2c5947a':'a333b2b0ca9d5e7572e84d8aa3f8210b99e3b946a831bbd6dd4ff231173d0bf6'});
 expect(exported.tables.find((t:{name:string})=>t.name==='attempts').columns.includes('coordinator_release_json')).toBe(version>=10);
 expect(exported.tables.find((t:{name:string})=>t.name==='attempts').columns.includes('captured_routine_revision')).toBe(version>=12);
 expect(exported.tables.find((t:{name:string})=>t.name==='occurrences').columns.includes('origin')).toBe(false);
 expect(f.db.all('SELECT total_changes() AS n')).toEqual(before);
});

it('rejects schema drift and noncanonical timestamps',()=>{
 for(const now of ['2026-02-30T00:00:00.000Z','2026-09-10','2026-09-10T00:00:00Z'])
  expect(()=>exportControl(f.db,now)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
 f.db.exec('CREATE TABLE extra(private TEXT)');
 expect(()=>exportControl(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'UNSUPPORTED_SCHEMA'}));
});
