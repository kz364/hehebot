import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'hehe-occurrence-migration-'));
const config=join(directory,'wrangler.json');
let child,logs='',timeout;
async function stop(){
 clearTimeout(timeout);
 if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
}
async function start(phase){
 await writeFile(config,JSON.stringify({name:'hehe-occurrence-migration-test',main:new URL('../tests/occurrence-migration-worker.ts',import.meta.url).pathname,compatibility_date:'2026-09-10',compatibility_flags:['nodejs_compat'],vars:{PHASE:phase},durable_objects:{bindings:[{name:'DB',class_name:'OccurrenceMigration'}]},migrations:[{tag:'v1',new_sqlite_classes:['OccurrenceMigration']}],rules:[{type:'Text',globs:['**/*.sql'],fallthrough:true}]}));
 logs='';child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--ip','127.0.0.1','--port','0','--persist-to',join(directory,'state')],{env:{...process.env,WRANGLER_LOG_PATH:join(directory,'logs'),WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',x=>{logs+=x;});child.stderr.on('data',x=>{logs+=x;});
 timeout=setTimeout(()=>child.kill('SIGTERM'),45000);
 return new Promise((resolve,reject)=>{
  const timer=setInterval(()=>{const match=logs.replace(/\u001b\[[0-9;]*m/g,'').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearInterval(timer);resolve(match[1]);}},100);
  child.once('exit',()=>{clearInterval(timer);reject(Error('Migration Worker stopped before ready'));});
 });
}
async function get(base,path='/'){
 const response=await fetch(base+path);assert.equal(response.status,200);return response.json();
}
try{
 let base=await start('seed');const before=await get(base);
 assert.deepEqual(before.versions.map(row=>row.version),[12]);assert.equal(before.runs[0].occurrence_id,'occurrence-43');
 for(const path of ['/rollback-version','/rollback-reference','/rollback-final-write','/invalid-reference']){
  const failed=await get(base,path);assert.equal(failed.rejected,true);
  assert.deepEqual({...failed,rejected:false},before,`Exact rollback for ${path}`);
 }
 await stop();base=await start('migrate');const after=await get(base);
 assert.deepEqual(after.versions.map(row=>row.version),[12,13,14,15]);
 assert.deepEqual(after.occurrences,before.occurrences.map(row=>({...row,origin:'scheduled'})));
 assert.deepEqual(after.runs,before.runs);assert.deepEqual(after.attempts,before.attempts);
 assert.deepEqual(after.foreignKeys,[{foreign_keys:1}]);assert.deepEqual(after.deferred,[{defer_foreign_keys:0}]);assert.deepEqual(after.violations,[]);
 const fresh=new DatabaseSync(':memory:');try{
  fresh.exec(await readFile(new URL('../DB/schema.sql',import.meta.url),'utf8'));
  assert.deepEqual(after.schema,fresh.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all().map(row=>({...row})));
 }finally{fresh.close();}
 assert.deepEqual(await get(base,'/rerun'),after);
 const invalid=await get(base,'/invalid-reference');assert.equal(invalid.rejected,true);assert.deepEqual({...invalid,rejected:false},after);
 await stop();base=await start('migrate');assert.deepEqual(await get(base),after);
 const plans=await get(base,'/memory-plan');assert.equal(plans.length,6);
 for(const plan of plans){
  const details=plan.map(row=>row.detail).join('\n');
  assert.match(details,/SEARCH objects USING INDEX objects_memory_scope/);
  assert.doesNotMatch(details,/SCAN objects|TEMP B-TREE/);
 }
 const retention=await get(base,'/memory-retention-plan');
 assert.equal(retention.due,'2026-12-09T00:00:00.000Z');assert.equal(retention.deleted,2);
 assert.deepEqual(retention.remaining,[{key:'memory-read:11111111-2222-4333-8444-555555555555:01'}]);
 assert.deepEqual(retention.attempts,[{n:1001}]);assert.equal(retention.plans.length,2);
 for(const plan of retention.plans){
  const details=plan.map(row=>row.detail).join('\n');
  assert.match(details,/^SEARCH m USING COVERING INDEX .*\(key>\? AND key<\?\)/);
  assert.match(details,/SEARCH a USING INDEX .*\(run_id=\? AND attempt=\?\)/);
  assert.match(details,/SEARCH r USING INDEX .*\(id=\?\)/);
  assert.match(details,/SEARCH runs USING COVERING INDEX runs_parent \(parent_run_id=\?\)/);
  assert.match(details,/SEARCH child USING COVERING INDEX runs_parent \(parent_run_id=\?\)/);
  assert.doesNotMatch(details,/SCAN a\b|SCAN m\b|SCAN runs\b|SCAN child\b/);
 }
 assert.deepEqual(await get(base,'/memory-body-limit'),{exact:true,code:'MEMORY_PREPARATION_LIMIT',noBodies:true,bytes:131073});
 const aggregate=await get(base,'/memory-aggregate-limit');
 assert.deepEqual(aggregate,['x','界','🧭'].map(unit=>({unit,exact:true,code:'MEMORY_PREPARATION_LIMIT',noBodies:true,metadataRows:2,rawBytes:131073,unchanged:true})));
 console.log('PASS: real workerd aggregate memory raw-body preflight at 131072 bytes; ASCII/BMP/astral one-byte-over refusal returns metadata only and preserves sources.');
 const rooms=await get(base,'/run-room');assert.equal(rooms.length,33);
 for(const result of rooms)assert.deepEqual(result,{index:result.index,matched:true,projection:true,hydration:true,unchanged:true});
 console.log('PASS: real workerd strict-null room projection, duplicate/non-object/raw NUL fallback, escaped/NUL keys, >1MiB source preservation; 33 vectors. No SQL scan bound claimed.');
 const falsyRooms=await get(base,'/run-falsy-room');assert.equal(falsyRooms.length,31);
 for(const result of falsyRooms)assert.deepEqual(result,{index:result.index,matched:true,projection:true,hydration:true,unchanged:true});
 console.log('PASS: real workerd falsy-room projection; 31 vectors including numeric JS fallback, NUL strings and strict-null distinctions.');
 assert.deepEqual(await get(base,'/child-authority'),{projected:true,unchanged:true,nulKeys:true,status:'outcome_unknown'});
 console.log('PASS: real workerd RootChildEffects excludes >1MiB memory/persona/routine bodies, preserves sources and late outcomes, and distinguishes NUL-suffixed room/persona ID keys.');
 const indexLimits=await get(base,'/memory-index-limits');
 const refused={code:'MIGRATION_WORK_LIMIT',version:13,indexAbsent:true};
 assert.deepEqual(indexLimits,{exactKeys:true,keys:refused,keysIntact:true,exactRows:true,rows:refused,retainedRows:100001});
 console.log('PASS: real workerd new-index gates at 4 MiB multibyte key input and 100000 total objects; one-over refusal preserves rows and schema version.');
 console.log('PASS: real workerd returns an exact 131072-byte memory body, refuses one byte over before JS hydration, and preserves the oversized source.');
 console.log('PASS: real workerd memory retention starts from ledger keys with exact attempt lookups and indexed recursive parent lookups, retains numeric aliases and all 1001 attempts; no total cleanup-scan or storage bound claimed.');
 console.log('PASS: real local Worker v12→v15 startup migration; retained live occurrence/run/attempt, version-write and FK-check rollback, enforced references, exact fresh schema, idempotent rerun, persistent reopen and all three bounded memory-scope index plans without temporary sorting. No account/provider calls.');
}catch(error){console.error(logs.slice(-4000));throw error;}
finally{await stop();await rm(directory,{recursive:true,force:true});}
