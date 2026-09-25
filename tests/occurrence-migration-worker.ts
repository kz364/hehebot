import {DurableObject} from 'cloudflare:workers';
import schema from '../DB/schema.sql';
import {migrateApplication} from '../src/core/migrations';
import {Store,type Database,type SqlValue} from '../src/core/store';
import {legacyOccurrencesSql} from './legacy-occurrences';
import {MemoryReadRetention} from '../src/core/memory-read-retention';
import {runRoomCases} from './run-room-cases';

// Disposable Wrangler fixture only. No production ingress or storage is exposed.
export class OccurrenceMigration extends DurableObject<{PHASE:string}> {
 private db:Database;
 constructor(ctx:DurableObjectState,env:{PHASE:string}){
  super(ctx,env);
  this.db={all:<T>(sql:string,...values:SqlValue[])=>ctx.storage.sql.exec(sql,...values).toArray() as T[],exec:(sql,...values)=>{ctx.storage.sql.exec(sql,...values);},transaction:<T>(fn:()=>T)=>ctx.storage.transactionSync(fn)};
  ctx.blockConcurrencyWhile(async()=>{
   if(!this.db.all("SELECT name FROM sqlite_schema WHERE name='schema_versions'").length){
    if(env.PHASE!=='seed')throw Error('Expected retained v12 storage');
    this.db.exec(schema.replace('PRAGMA foreign_keys = ON;','').replace(/CREATE TABLE "occurrences" \([\s\S]*?\n\);/,legacyOccurrencesSql+';').replace('VALUES (15,','VALUES (12,').replace(/^CREATE INDEX (objects_memory_scope|runs_parent) .*\n/gm,''));
    this.db.exec(`INSERT INTO objects VALUES('routine-19','routine',73,'{}',NULL,'t1','t2'),('persona-31','persona',2,'{}',NULL,'t1','t2');
     INSERT INTO occurrences VALUES('occurrence-43','routine-19',7,'2026-09-17T03:15:00.000Z','claimed',5,'t3');
     INSERT INTO runs(id,occurrence_id,persona_id,routine_id,context_json,status,current_attempt,created_at,updated_at)
      VALUES('run-59','occurrence-43','persona-31','routine-19','{}','running',1,'t3','t5');
     INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,captured_routine_revision)
      VALUES('run-59',1,'submission-67',3,'boot-71','running','t9',7);`);
   }
   if(env.PHASE==='migrate')migrateApplication(this.db,'2026-09-17T06:00:00.000Z');
  });
 }
 async fetch(request:Request){
  const db=this.db,path=new URL(request.url).pathname;
  if(path==='/run-room'){
   const results=runRoomCases.map(({context,allowed,error,fallback},index)=>{
    db.exec("UPDATE runs SET context_json=? WHERE id='run-59'",context);
    const returned:Array<Record<string,unknown>>=[];
    const store=new Store({...db,all:<T>(sql:string,...values:SqlValue[])=>{
     const rows=db.all<T>(sql,...values);returned.push(...rows as Array<Record<string,unknown>>);return rows;
    }});
    let actual:unknown;
    try{actual=store.runHasNullRoom('run-59');}catch(caught){actual=(caught as Error).name;}
    const bodies=returned.filter(row=>'context_json' in row);
    return {index,matched:actual===(error??allowed),projection:JSON.stringify(returned[0])===JSON.stringify({room_is_null:fallback?null:allowed?1:0}),
     hydration:fallback?bodies.length===1&&bodies[0].context_json===context:bodies.length===0,
     unchanged:db.all<{context_json:string}>("SELECT context_json FROM runs WHERE id='run-59'")[0].context_json===context};
   });
   return Response.json(results);
  }
  if(path==='/memory-retention-plan'){
   const id='11111111-2222-4333-8444-555555555555',settled='2026-09-10T00:00:00.000Z',now='2026-12-09T00:00:00.000Z';
   db.transaction(()=>{
    db.exec("INSERT INTO runs(id,persona_id,context_json,status,created_at,updated_at) VALUES(?,'persona-31','{}','failed',?,?)",id,settled,settled);
    for(let n=1;n<=1001;n++)db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at) VALUES(?,?,?,1,'fixture','failed',?,?)",id,n,`memory-${n}`,settled,settled);
    for(const suffix of ['1','101','01'])db.exec("INSERT INTO runtime_metadata VALUES(?,'{}')",`memory-read:${id}:${suffix}`);
   });
   const plans:unknown[]=[];
   const retention=new MemoryReadRetention(new Store({...db,all:<T>(sql:string,...values:SqlValue[])=>{
    plans.push(db.all(`EXPLAIN QUERY PLAN ${sql}`,...values));return db.all<T>(sql,...values);
   }}),()=>now);
   const due=retention.nextDue(),deleted=retention.prune();
   return Response.json({plans,due,deleted,remaining:db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'memory-read:*'"),attempts:db.all('SELECT COUNT(*) AS n FROM attempts WHERE run_id=?',id)});
  }
  if(path==='/memory-plan'){
   const plans:unknown[]=[];
   new Store({...db,all:<T>(sql:string,...values:SqlValue[])=>{
    plans.push(db.all(`EXPLAIN QUERY PLAN ${sql}`,...values));return db.all<T>(sql,...values);
   }}).scopedMemories('persona-31','routine-19',65);
   return Response.json(plans);
  }
  if(path==='/memory-body-limit'){
   const store=new Store(db),body={scope:{kind:'persona',id:'persona-31'},text:'',expires_at:null};
   const remaining=131072-new TextEncoder().encode(JSON.stringify(body)).byteLength;
   body.text='界'.repeat(Math.floor(remaining/3))+'x'.repeat(remaining%3);
   store.put('legacy-memory','memory',body,0,'owner','t1');
   const exact=store.scopedMemories('persona-31',null,65)[0].body.text===body.text;
   body.text+='x';store.put('legacy-memory','memory',body,1,'owner','t2');
   const returned:Array<{body_json:string|null}>=[];
   const observed=new Store({...db,all:<T>(sql:string,...values:SqlValue[])=>{
    const rows=db.all<T>(sql,...values);returned.push(...rows as Array<{body_json:string|null}>);return rows;
   }});
   let code:unknown=null;
   try{observed.scopedMemories('persona-31',null,65);}catch(error){if(error&&typeof error==='object'&&'code' in error)code=error.code;else throw error;}
   return Response.json({exact,code,returnedBodies:returned.map(row=>row.body_json),
    bytes:db.all<{n:number}>("SELECT length(CAST(body_json AS BLOB)) AS n FROM objects WHERE id='legacy-memory'")[0].n});
  }
  let rejected=false;
  if(path==='/rollback-version'||path==='/rollback-reference'||path==='/rollback-final-write'){
   if(path==='/rollback-version')db.exec("CREATE TRIGGER reject_v13 BEFORE INSERT ON schema_versions WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
   const injected:Database={...db,exec:(sql,...values)=>{db.exec(sql,...values);if((path==='/rollback-reference'&&sql==='ALTER TABLE occurrences_v13 RENAME TO occurrences')||(path==='/rollback-final-write'&&sql==='INSERT INTO schema_versions(version,applied_at) VALUES(13,?)'))db.exec("UPDATE runs SET occurrence_id='missing' WHERE id='run-59'");}};
   try{migrateApplication(injected,'failed');}catch{rejected=true;}
   if(path==='/rollback-version')db.exec('DROP TRIGGER reject_v13');
  }
  if(path==='/invalid-reference')try{db.exec("UPDATE runs SET occurrence_id='missing' WHERE id='run-59'");}catch{rejected=true;}
  if(path==='/rerun')migrateApplication(db,'later');
  return Response.json({rejected,versions:db.all('SELECT * FROM schema_versions ORDER BY version'),occurrences:db.all('SELECT * FROM occurrences'),runs:db.all('SELECT * FROM runs'),attempts:db.all('SELECT * FROM attempts'),foreignKeys:db.all('PRAGMA foreign_keys'),deferred:db.all('PRAGMA defer_foreign_keys'),violations:db.all('PRAGMA foreign_key_check'),schema:db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_METADATA','__miniflare_do_name') ORDER BY type,name")});
 }
}
export default {fetch(request:Request,env:{DB:DurableObjectNamespace}){return env.DB.get(env.DB.idFromName('migration-fixture')).fetch(request);}};
