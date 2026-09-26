import {afterEach,beforeEach,expect,it} from 'vitest';
import {fixture,bot} from './helpers';
import {migrateApplication} from '../src/core/migrations';
import {nativeDescendantsSettledSql} from '../src/core/native-tasks';

let f:ReturnType<typeof fixture>;
const indexes=['operations_run_status','effects_run_status','resource_locks_run'];
beforeEach(()=>{f=fixture();});
afterEach(()=>f.close());
function prior(){
 for(const name of indexes)f.db.exec(`DROP INDEX IF EXISTS ${name}`);
 f.db.exec('DELETE FROM schema_versions');f.db.exec("INSERT INTO schema_versions VALUES(15,'fixture')");
}
it('uses run-key indexes for every recursive descendant custody probe',()=>{
 const plan=f.db.all<{detail:string}>(`EXPLAIN QUERY PLAN SELECT id FROM runs r WHERE ${nativeDescendantsSettledSql}`).map(row=>row.detail).join('\n');
 expect(plan).toMatch(/SEARCH o USING COVERING INDEX operations_run_status \(run_id=\?\)/);
 expect(plan).toMatch(/SEARCH e USING COVERING INDEX effects_run_status \(run_id=\? AND status=\?\)/);
 expect(plan).toMatch(/SEARCH l USING COVERING INDEX resource_locks_run \(run_id=\?\)/);
 expect(plan).not.toMatch(/SCAN [oel]\b/);
});
it('migrates v15 atomically and refuses conflicting index definitions without adopting them',()=>{
 prior();f.db.exec('CREATE INDEX effects_run_status ON effects(status)');
 expect(()=>migrateApplication(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'SCHEMA_MISMATCH'}));
 expect(f.db.all('SELECT version FROM schema_versions')).toEqual([{version:15}]);
 expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='operations_run_status'")).toEqual([]);
 f.db.exec('DROP INDEX effects_run_status');
 f.db.exec("CREATE TRIGGER reject_v16 BEFORE INSERT ON schema_versions WHEN NEW.version=16 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 expect(()=>migrateApplication(f.db,f.core.now())).toThrow();
 for(const name of indexes)expect(f.db.all('SELECT name FROM sqlite_schema WHERE name=?',name)).toEqual([]);
 f.db.exec('DROP TRIGGER reject_v16');migrateApplication(f.db,f.core.now());
 expect(f.db.all('SELECT version FROM schema_versions ORDER BY version')).toEqual([{version:15},{version:16},{version:17},{version:18}]);
 const before=f.db.all('SELECT total_changes() AS n');migrateApplication(f.db,'later');
 expect(f.db.all('SELECT total_changes() AS n')).toEqual(before);
});
it('bounds aggregate construction rows across all three tables without losing unknown custody',()=>{
 prior();
 f.db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES('r',?,'{}','recovery_required',1,'t0','t0')",bot);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES('r',1,'s',1,'b','running','t9')");
 f.db.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<99998) INSERT INTO operations SELECT CAST(i AS TEXT),'r',1,'tool','unknown','t0','t9','t0' FROM n");
 f.db.exec("INSERT INTO effects VALUES('e','r','key','mutation','outcome_unknown','auth','digest',NULL,'{\"unknown\":true}','t0')");
 f.db.exec("INSERT INTO resource_locks VALUES('lock','r',1,'t0')");
 const effects=f.db.all('SELECT * FROM effects'),locks=f.db.all('SELECT * FROM resource_locks');
 migrateApplication(f.db,f.core.now());
 expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:18}]);
 prior();f.db.exec("INSERT INTO resource_locks VALUES('one-over','r',1,'t0')");
 expect(()=>migrateApplication(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
 for(const name of indexes)expect(f.db.all('SELECT name FROM sqlite_schema WHERE name=?',name)).toEqual([]);
 expect(f.db.all('SELECT version FROM schema_versions')).toEqual([{version:15}]);
 expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
 expect(f.db.all("SELECT * FROM resource_locks WHERE resource_id='lock'")).toEqual(locks);
 expect(f.db.all("SELECT count(*) AS n FROM operations WHERE status='unknown'")).toEqual([{n:99998}]);
});
it('admits exactly 4 MiB of UTF-8 key input and refuses one more byte without DDL',()=>{
 prior();
 // Four run keys, two six-byte statuses and four eight-byte rowid reservations.
 const id='界'.repeat(349521)+'xx';
 for(const key of [id,id+'x'])f.db.exec("INSERT INTO runs(id,persona_id,context_json,status,created_at,updated_at) VALUES(?,?,'{}','completed','t0','t0')",key,bot);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,1,'s',1,'b','running','t9')",id);
 f.db.exec("INSERT INTO operations VALUES('o',?,1,'tool','active','t0','t9','t0')",id);
 f.db.exec("INSERT INTO effects VALUES('e',?,'key','mutation','intent','auth','digest',NULL,NULL,'t0')",id);
 for(let i=0;i<2;i++)f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)',`lock-${i}`,id,'t0');
 migrateApplication(f.db,f.core.now());
 expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:18}]);
 prior();f.db.exec("UPDATE resource_locks SET run_id=? WHERE resource_id='lock-1'",id+'x');
 expect(()=>migrateApplication(f.db,f.core.now())).toThrowError(expect.objectContaining({code:'MIGRATION_WORK_LIMIT'}));
 for(const name of indexes)expect(f.db.all('SELECT name FROM sqlite_schema WHERE name=?',name)).toEqual([]);
 expect(f.db.all("SELECT run_id=? AS intact FROM resource_locks WHERE resource_id='lock-1'",id+'x')).toEqual([{intact:1}]);
});
