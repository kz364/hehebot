import { afterEach, beforeEach, expect, it } from 'vitest';
import { exportControl } from '../src/core/control-export';
import { fixture, bot, TestDatabase } from './helpers';
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
 expect(transactions).toBe(1);expect(exported).toMatchObject({format:'hehebot-control-export',version:1,createdAt:now,schemaVersions:[18],schemaSha256:'6fedcfb0c86cd8efe3a307a73247892408875c7a818f68a777ee93c3a2b97076'});
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

it('accepts exactly 10000 total rows and stops summary scans at the remaining allowance plus one',()=>{
 const db=new TestDatabase();try{
  // 37 early rows + 9962 rate rows + one later schema version = 10000.
  db.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<37) INSERT INTO context_retention SELECT 'consumer',CAST(i AS TEXT),0 FROM n");
  db.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<9962) INSERT INTO rate_limits SELECT CAST(i AS TEXT),1,1 FROM n");
  const exported=JSON.parse(exportControl(db,f.core.now()));
  expect(exported.tables.reduce((n:number,t:{rows:unknown[]})=>n+t.rows.length,0)).toBe(10000);
  db.exec("INSERT INTO rate_limits VALUES('one-over',1,1)");
  expect(()=>exportControl(db,f.core.now())).toThrowError(expect.objectContaining({code:'EXPORT_LIMIT'}));
  db.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000) INSERT INTO rate_limits SELECT 'extra-'||i,1,1 FROM n");
  let visited=0;db.sqlite.function('export_scan_probe',()=>{visited++;return 1;});
  const before=db.all('SELECT total_changes() AS n');
  const measured:Database={
   all:(sql,...values)=>db.all(sql.includes('AS unsupported FROM')?sql.replace('FROM "rate_limits"','FROM "rate_limits" WHERE export_scan_probe()'):sql,...values),
   exec:()=>{throw new Error('Export must not write');},transaction:fn=>db.transaction(fn),
  };
  expect(()=>exportControl(measured,f.core.now())).toThrowError(expect.objectContaining({code:'EXPORT_LIMIT'}));
  expect(visited).toBe(9964); // Remaining 9963 rows + one overflow witness, not the full table.
  expect(db.all('SELECT total_changes() AS n')).toEqual(before);
  expect(db.all('SELECT count(*) AS n FROM rate_limits')).toEqual([{n:19963}]);
 }finally{db.close();}
});

it.each([9,10,11,12])('keeps v%s exports readable without migration or fabricated attribution',version=>{
 f.db.exec('DROP INDEX operations_run_status');f.db.exec('DROP INDEX effects_run_status');f.db.exec('DROP INDEX resource_locks_run');
 f.db.exec('DROP INDEX runs_parent');
 f.db.exec('DROP INDEX objects_memory_scope');
 f.db.exec('DROP INDEX bot_messages_run_attempt');f.db.exec('DROP TABLE bot_messages');
 // V2 (v18) rebuilt runs with an unquoted name and no 'interrupted' status for
 // these historical (pre-v18) pins; recreate that exact pre-v18 shape. Build
 // the replacement directly under its final name (no ALTER...RENAME) so SQLite
 // does not re-quote the identifier in its own or dependents' stored SQL text.
 f.db.exec('PRAGMA defer_foreign_keys=ON');
 f.db.exec('CREATE TABLE runs_staging AS SELECT * FROM runs');
 f.db.exec('DROP TABLE runs');
 f.db.exec(`CREATE TABLE runs (
 id TEXT PRIMARY KEY, command_id TEXT REFERENCES commands(id), occurrence_id TEXT UNIQUE REFERENCES occurrences(id),
 persona_id TEXT NOT NULL REFERENCES objects(id), routine_id TEXT REFERENCES objects(id),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background')),
 parent_run_id TEXT REFERENCES runs(id), title TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','finishing','completed','waiting','failed','cancelling','cancelled','recovery_required')),
 current_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, checkpoint_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
 f.db.exec('INSERT INTO runs SELECT * FROM runs_staging');
 f.db.exec('DROP TABLE runs_staging');
 f.db.exec('CREATE INDEX runs_status_created ON runs(status,created_at)');
 f.db.exec('PRAGMA defer_foreign_keys=OFF');
 legacyOccurrences(f.db.sqlite);
 if(version<12)f.db.exec('ALTER TABLE attempts DROP COLUMN captured_routine_revision');
 if(version<11){
  f.db.exec('DROP TABLE native_task_links');
  f.db.exec('CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)');
 }
 if(version===9)f.db.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json');
 f.db.exec('UPDATE schema_versions SET version=? WHERE version=18',version);
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
