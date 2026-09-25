import {expect,it,vi} from 'vitest';
import {fixture,bot,otherBot} from './helpers';
import {migrateApplication} from '../src/core/migrations';

it.each(['x','界','🧭'])('bounds legacy body bytes before returning them to JS (%s)',unit=>{
 const f=fixture();try{
  // Imported legacy data may exceed today's text schema. This bound concerns
  // the raw stored JSON, not its character count or just the memory text.
  const body={scope:{kind:'persona',id:bot},text:'',expires_at:null,explicit_constraint:true};
  const remaining=131072-Buffer.byteLength(JSON.stringify(body)),width=Buffer.byteLength(unit);
  body.text=unit.repeat(Math.floor(remaining/width))+'x'.repeat(remaining%width);
  expect(Buffer.byteLength(JSON.stringify(body))).toBe(131072);
  f.store.put('legacy-memory','memory',body,0,'owner',f.core.now());
  expect(f.store.scopedMemories(bot,null,65)[0].body).toEqual(body);
  body.text+='x';f.store.put('legacy-memory','memory',body,1,'owner',f.core.now());
  const read=vi.spyOn(f.db,'all');
  expect(()=>f.store.scopedMemories(bot,null,65)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
  const returned=read.mock.results.flatMap(result=>result.value).filter(row=>'id' in row);read.mockRestore();
  expect(returned).toHaveLength(1);expect(returned[0].body_json).toBeUndefined();
  expect(returned[0].body_bytes).toBe(131073);
  expect(()=>f.core.context(bot,'Keep every constraint.',null,null)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
  expect(f.db.all('SELECT * FROM runs')).toEqual([]);
  expect(f.store.scopedMemories(bot,null)[0].body).toEqual(body);
 }finally{vi.restoreAllMocks();f.close();}
});

it.each([null,'2026-09-09T00:00:00.000Z'])('parks oversized legacy read work without wake or inference (expiry=%s)',expires_at=>{
 const f=fixture(true);try{
  f.store.put('legacy-memory','memory',{scope:{kind:'persona',id:bot},text:'x'.repeat(150000),expires_at,explicit_constraint:true},0,'owner',f.core.now());
  const lifecycle=f.db.all('SELECT * FROM lifecycle'),source=f.db.all('SELECT * FROM objects');
  const result=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Keep all constraints.'}});
  expect(result.status).toBe('applied');
  expect(f.store.run(result.resource_id!)).toMatchObject({status:'waiting',current_attempt:0,error_code:'MEMORY_PREPARATION_LIMIT'});
  expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
  expect(f.db.all('SELECT * FROM objects')).toEqual(source);
 }finally{f.close();}
});

it('does not let an oversized foreign, deleted or later unselected row block the selected scope',()=>{
 const f=fixture();try{
  const huge={scope:{kind:'persona',id:otherBot},text:'x'.repeat(150000),expires_at:null};
  f.store.put('foreign','memory',huge,0,'owner','t0');
  f.store.put('deleted','memory',{...huge,scope:{kind:'persona',id:bot}},0,'owner','t0');
  f.db.exec("UPDATE objects SET deleted_at='t1' WHERE id='deleted'");
  f.store.put('selected','memory',{...huge,text:'Never send without approval.',scope:{kind:'persona',id:bot}},0,'owner','t1');
  f.store.put('later','memory',{...huge,scope:{kind:'global',id:null}},0,'owner','t2');
  expect(f.store.scopedMemories(bot,null,1).map(row=>row.id)).toEqual(['selected']);
  expect(()=>f.store.scopedMemories(bot,null,65)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
 }finally{f.close();}
});

it.each([null,'routine-17'])('bounds each indexed scope read before merging (routine=%s)',routine=>{
 const f=fixture();try{
  // Interleaved ages exercise a global merge, not scope concatenation. IDs
  // break ties; expired rows remain work, while deleted/foreign rows do not.
  const scopes=[['global',null],['persona',bot],['routine','routine-17'],['persona',otherBot],['routine','routine-foreign']] as const;
  const expected:Array<{id:string;created_at:string}>=[];
  f.db.transaction(()=>{
   for(let i=0;i<230;i++)for(const [j,[kind,id]] of scopes.entries()){
    const key=`memory-${String(i).padStart(4,'0')}-${j}`,created=new Date(Date.UTC(2026,8,1,0,0,Math.floor(i/2))).toISOString();
    f.store.put(key,'memory',{scope:{kind,id},text:'Keep constraint.',expires_at:i===0?'2020-01-01T00:00:00.000Z':null,explicit_constraint:true},0,'owner',created);
    if(i%7===0&&i!==0)f.db.exec('UPDATE objects SET deleted_at=? WHERE id=?',created,key);
    else if(j<2||j===2&&routine)expected.push({id:key,created_at:created});
   }
  });
  expected.sort((a,b)=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:a.id<b.id?-1:1);
  const read=vi.spyOn(f.db,'all');
  const rows=f.store.scopedMemories(bot,routine,65);
  const calls=read.mock.calls.slice(),results=read.mock.results.slice();read.mockRestore();
  expect(rows.map(row=>row.id)).toEqual(expected.slice(0,65).map(row=>row.id));
  expect(rows[0].body.expires_at).toBe('2020-01-01T00:00:00.000Z');
  const partitions=routine?3:2;
  expect(calls).toHaveLength(partitions*2+65);
  for(const [i,[sql,...values]] of calls.slice(0,partitions*2).entries()){
   expect(results[i].type).toBe('return');expect(results[i].value).toHaveLength(i<partitions?1:65);
   expect(results[i].value.every((row:Record<string,unknown>)=>!('body_json' in row))).toBe(true);
   const plan=f.db.all<{detail:string}>(`EXPLAIN QUERY PLAN ${sql}`,...values).map(row=>row.detail).join('\n');
   expect(plan).toContain('SEARCH objects USING INDEX objects_memory_scope');
   expect(plan).not.toMatch(/SCAN objects|TEMP B-TREE/);
  }
  expect(f.store.scopedMemories(bot,routine).map(row=>row.id)).toEqual(expected.map(row=>row.id));
 }finally{vi.restoreAllMocks();f.close();}
});

it.each(['x','界','🧭'])('refuses aggregate raw bytes before loading either selected body (%s)',unit=>{
 const f=fixture();try{
  const first={scope:{kind:'global',id:null},text:'Keep constraint.',expires_at:null};
  const second={scope:{kind:'persona',id:bot},text:'',expires_at:null};
  const remaining=131072-Buffer.byteLength(JSON.stringify(first))-Buffer.byteLength(JSON.stringify(second));
  const width=Buffer.byteLength(unit);second.text=unit.repeat(Math.floor(remaining/width))+'x'.repeat(remaining%width);
  f.store.put('first','memory',first,0,'owner','t0');f.store.put('second','memory',second,0,'owner','t1');
  expect(f.store.scopedMemories(bot,null,65).map(row=>row.body)).toEqual([first,second]);
  second.text+='x';f.store.put('second','memory',second,1,'owner','t1');
  const read=vi.spyOn(f.db,'all');
  try{
   expect(()=>f.store.scopedMemories(bot,null,65)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
   expect(read.mock.calls).toHaveLength(4);
   expect(read.mock.results.flatMap(result=>result.value).every(row=>!('body_json' in row))).toBe(true);
  }finally{read.mockRestore();}
  expect(f.store.scopedMemories(bot,null).map(row=>row.body)).toEqual([first,second]);
 }finally{f.close();}
});

it.each(['id','created_at','updated_at'])('bounds aggregate candidate metadata before hydrating legacy %s',field=>{
 const f=fixture();try{
  const first={id:'a',kind:'memory',created_at:'t0',updated_at:'t0'};
  const second={id:'b',kind:'memory',created_at:'t1',updated_at:'t1'};
  const base=Object.values(first).concat(Object.values(second)).reduce((sum,value)=>sum+Buffer.byteLength(value),0);
  const size=131072-base+Buffer.byteLength(second[field as keyof typeof second]);
  const value='界'.repeat(Math.floor(size/3))+'x'.repeat(size%3);
  second[field as keyof typeof second]=value;
  for(const [metadata,scope] of [[first,{kind:'global',id:null}],[second,{kind:'persona',id:bot}]] as const)
   f.db.exec('INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES(?,?,1,?,?,?)',metadata.id,metadata.kind,JSON.stringify({scope,text:'Keep constraint.',expires_at:null}),metadata.created_at,metadata.updated_at);
  expect(f.store.scopedMemories(bot,null,65)).toHaveLength(2);
  f.db.exec(`UPDATE objects SET ${field}=? WHERE id=?`,value+'x',second.id);
  const read=vi.spyOn(f.db,'all');
  try{
   expect(()=>f.store.scopedMemories(bot,null,65)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
   const rows=read.mock.results.flatMap(result=>result.value);
   expect(rows).toHaveLength(2);
   expect(rows.every(row=>Object.keys(row).join()==='bytes')).toBe(true);
   expect(rows.reduce((sum,row)=>sum+row.bytes,0)).toBe(131073);
  }finally{read.mockRestore();}
  expect(f.store.scopedMemories(bot,null).some(row=>row[field as 'id'|'created_at'|'updated_at']===value+'x')).toBe(true);
 }finally{f.close();}
});

it('migrates the memory index without changing source records; version failure rolls back and rerun is inert',()=>{
 const f=fixture();try{
  const canonical=f.db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name");
  f.store.put('memory-19','memory',{scope:{kind:'persona',id:bot},text:'Keep original.',expires_at:null},0,'owner',f.core.now());
  const objects=f.db.all('SELECT * FROM objects'),revisions=f.db.all('SELECT * FROM object_revisions');
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  f.db.exec("CREATE TRIGGER reject_v14 BEFORE INSERT ON schema_versions WHEN NEW.version=14 BEGIN SELECT RAISE(ABORT,'synthetic v14 failure'); END");
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow('synthetic v14 failure');
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'")).toEqual([]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  f.db.exec('DROP TRIGGER reject_v14');migrateApplication(f.db,f.core.now());
  expect(f.db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")).toEqual(canonical);
  expect(f.db.all('SELECT * FROM objects')).toEqual(objects);expect(f.db.all('SELECT * FROM object_revisions')).toEqual(revisions);
  const changes=f.db.all('SELECT total_changes() AS n');migrateApplication(f.db,'later');
  expect(f.db.all('SELECT total_changes() AS n')).toEqual(changes);
  expect(f.db.all('PRAGMA foreign_key_check')).toEqual([]);
 }finally{f.close();}
});

it('does not adopt a conflicting memory index or advance the schema version',()=>{
 const f=fixture();try{
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  f.db.exec('CREATE INDEX objects_memory_scope ON objects(id)');
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'SCHEMA_MISMATCH'}));
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  expect(f.db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='objects_memory_scope'")[0].sql).toBe('CREATE INDEX objects_memory_scope ON objects(id)');
 }finally{f.close();}
});

it('refuses a new memory index above 10000 entries without changing rows or schema, and admits exactly 10000',()=>{
 const f=fixture();try{
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  f.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10001)
   INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at)
   SELECT 'legacy-'||i,'memory',1,'{"scope":{"kind":"global","id":null},"text":"Keep"}','t0','t0' FROM n`);
  const before=f.db.all('SELECT * FROM objects ORDER BY id');
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'")).toEqual([]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  expect(f.db.all('SELECT * FROM objects ORDER BY id')).toEqual(before);
  // A previously deleted memory consumes no new index entry; do not delete it.
  f.db.exec("UPDATE objects SET deleted_at='t1' WHERE id='legacy-10001'");
  migrateApplication(f.db,f.core.now());
  expect(f.db.all("SELECT COUNT(*) AS n FROM objects WHERE kind='memory'")).toEqual([{n:10001}]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:15}]);
 }finally{f.close();}
});

it('refuses one byte above 64 MiB of index JSON and admits the exact byte limit',()=>{
 const f=fixture();try{
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  const prefix='{"scope":{"kind":"global","id":null},"text":"',suffix='"}';
  const body=prefix+'x'.repeat(67108864-Buffer.byteLength(prefix+suffix))+suffix;
  f.db.exec("INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES('large','memory',1,?,'t0','t0')",body+' ');
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
  expect(f.db.all("SELECT body_json=? AS intact FROM objects WHERE id='large'",body+' ')).toEqual([{intact:1}]);
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'")).toEqual([]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  f.db.exec("UPDATE objects SET body_json=? WHERE id='large'",body);
  migrateApplication(f.db,f.core.now());
  expect(f.db.all("SELECT body_json=? AS intact FROM objects WHERE id='large'",body)).toEqual([{intact:1}]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:15}]);
 }finally{f.close();}
});

it('bounds the whole object scan even when the extra rows are not memories',()=>{
 const f=fixture();try{
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  const count=f.db.all<{n:number}>('SELECT COUNT(*) AS n FROM objects')[0].n;
  f.db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
   INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at)
   SELECT 'foreign-'||i,'persona',1,'{}','t0','t0' FROM n`,100000-count);
  migrateApplication(f.db,f.core.now());
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('DELETE FROM schema_versions WHERE version>13');
  f.db.exec("INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES('extra','persona',1,'{}','t0','t0')");
  const read=vi.spyOn(f.db,'all');
  try{
   expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
   expect(read.mock.calls.some(([sql])=>sql.includes('SUM(bytes)'))).toBe(false);
  }finally{read.mockRestore();}
  expect(f.db.all('SELECT COUNT(*) AS n FROM objects')).toEqual([{n:100001}]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'")).toEqual([]);
 }finally{f.close();}
});

it.each(['id','created_at'])('bounds UTF-8 non-JSON index input from legacy %s',field=>{
 const f=fixture();try{
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('UPDATE schema_versions SET version=13');
  // The other indexed TEXT field uses two bytes. Multibyte input detects
  // accidental use of SQLite character length instead of BLOB byte length.
  const size=4194304-2,value='界'.repeat(Math.floor(size/3))+'x'.repeat(size%3);
  const id=field==='id'?value:'id',created=field==='created_at'?value:'t0';
  f.db.exec("INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES(?,'memory',1,'{}',?,'t0')",id,created);
  migrateApplication(f.db,f.core.now());
  f.db.exec('DROP INDEX objects_memory_scope');f.db.exec('DELETE FROM schema_versions WHERE version>13');
  f.db.exec(`UPDATE objects SET ${field}=? WHERE id=?`,value+'x',id);
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:13}]);
  expect(f.db.all(`SELECT ${field}=? AS intact FROM objects WHERE kind='memory'`,value+'x')).toEqual([{intact:1}]);
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'")).toEqual([]);
 }finally{f.close();}
});
