import {expect,it} from 'vitest';
import {fixture,bot} from './helpers';
import {migrateApplication} from '../src/core/migrations';
import {nativeDescendantsSettledSql} from '../src/core/native-tasks';

it('migrates the parent index atomically without changing custody and reruns without writes',()=>{
 const f=fixture();try{
  f.core.enqueue(bot,'Retain exact context.',null,null,null);
  const rows=f.db.all('SELECT * FROM runs');
  const canonical=f.db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name");
  f.db.exec('DROP INDEX runs_parent');f.db.exec('UPDATE schema_versions SET version=14');
  f.db.exec("CREATE TRIGGER reject_v15 BEFORE INSERT ON schema_versions WHEN NEW.version=15 BEGIN SELECT RAISE(ABORT,'synthetic v15 failure'); END");
  expect(()=>migrateApplication(f.db,f.core.now())).toThrow('synthetic v15 failure');
  expect(f.db.all("SELECT name FROM sqlite_schema WHERE name='runs_parent'")).toEqual([]);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:14}]);
  expect(f.db.all('SELECT * FROM runs')).toEqual(rows);
  f.db.exec('DROP TRIGGER reject_v15');migrateApplication(f.db,f.core.now());
  expect(f.db.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")).toEqual(canonical);
  expect(f.db.all('SELECT * FROM runs')).toEqual(rows);
  expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:20}]);
  const changes=f.db.all('SELECT total_changes() AS n');migrateApplication(f.db,'later');
  expect(f.db.all('SELECT total_changes() AS n')).toEqual(changes);
  expect(f.db.all('PRAGMA foreign_key_check')).toEqual([]);
 }finally{f.close();}
});

it.each([false,true])('adopts only the exact existing parent index (conflicting=%s)',conflicting=>{
 const f=fixture();try{
  f.db.exec('UPDATE schema_versions SET version=14');
  if(conflicting){f.db.exec('DROP INDEX runs_parent');f.db.exec('CREATE INDEX runs_parent ON runs(id,parent_run_id)');}
  if(conflicting){
   expect(()=>migrateApplication(f.db,f.core.now())).toThrow(expect.objectContaining({code:'SCHEMA_MISMATCH'}));
   expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:14}]);
   expect(f.db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='runs_parent'")[0].sql).toBe('CREATE INDEX runs_parent ON runs(id,parent_run_id)');
  }else{
   migrateApplication(f.db,f.core.now());
   expect(f.db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:20}]);
  }
 }finally{f.close();}
});

it('uses parent lookups at both recursive steps and still blocks on a live grandchild',()=>{
 const f=fixture();try{
  const root=f.core.enqueue(bot,'root',null,null,null),child=f.core.enqueue(bot,'child',null,null,null),grandchild=f.core.enqueue(bot,'grandchild',null,null,null);
  f.db.exec("UPDATE runs SET status='completed'");
  f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?',root,child);
  f.db.exec("UPDATE runs SET parent_run_id=?,status='running' WHERE id=?",child,grandchild);
  const sql=`SELECT ${nativeDescendantsSettledSql} AS settled FROM runs r WHERE r.id=?`;
  const plan=()=>f.db.all<{detail:string}>(`EXPLAIN QUERY PLAN ${sql}`,root).map(row=>row.detail).join('\n');
  const indexed=plan();
  expect(indexed).toContain('SEARCH runs USING COVERING INDEX runs_parent (parent_run_id=?)');
  expect(indexed).toContain('SEARCH child USING COVERING INDEX runs_parent (parent_run_id=?)');
  expect(indexed).not.toMatch(/SCAN runs\b|SCAN child\b|AUTOMATIC/);
  expect(f.db.all(sql,root)).toEqual([{settled:0}]);
  f.db.exec("UPDATE runs SET status='failed' WHERE id=?",grandchild);
  expect(f.db.all(sql,root)).toEqual([{settled:1}]);
  // Cycles must still terminate through UNION dedupe, not UNION ALL recursion.
  f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?',grandchild,root);
  expect(f.db.all(sql,root)).toEqual([{settled:1}]);
  f.db.exec('DROP INDEX runs_parent');
  expect(plan()).not.toContain('USING COVERING INDEX runs_parent');
  expect(f.db.all(sql,root)).toEqual([{settled:1}]);
 }finally{f.close();}
});
