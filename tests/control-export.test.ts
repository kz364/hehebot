import { afterEach, beforeEach, expect, it } from 'vitest';
import { exportControl } from '../src/core/control-export';
import { fixture, bot } from './helpers';
import type { Database } from '../src/core/store';

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
 expect(transactions).toBe(1);expect(exported).toMatchObject({format:'hehebot-control-export',version:1,createdAt:now,schemaVersions:[9],schemaSha256:'15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c'});
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

it('rejects schema drift and noncanonical timestamps',()=>{
 for(const now of ['2026-02-30T00:00:00.000Z','2026-09-10','2026-09-10T00:00:00Z'])
  expect(()=>exportControl(f.db,now)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
 f.db.exec('CREATE TABLE extra(private TEXT)');
 expect(()=>exportControl(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'UNSUPPORTED_SCHEMA'}));
});
