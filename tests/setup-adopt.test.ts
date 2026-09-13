import {afterEach,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {fixture,bot,routine} from './helpers';
import type {Command} from '../src/core/types';
let f:ReturnType<typeof fixture>;afterEach(()=>f?.close());
function batch(commands:any[]):Command{return {schema_version:1,type:'setup.adopt',payload:{commands,reviewed_hash:createHash('sha256').update(JSON.stringify(commands)).digest('hex'),monitoring_timezone:'Asia/Singapore'}};}
function item(){return {schema_version:1,type:'routine.put',payload:routine({enabled:false,schedule:{cron:'0 4 * * *',timezone:'Asia/Singapore'}})};}
it('adopts disabled routines atomically and preserves idempotency',()=>{
 f=fixture();const a=item(),b=item(),command=batch([a,b]),key=randomUUID();
 expect(f.accept(command,key).status).toBe('applied');expect(f.accept(command,key).status).toBe('applied');
 expect(f.store.get(a.payload.id).revision).toBe(1);expect(f.db.all('SELECT * FROM runs')).toHaveLength(0);
 expect(f.db.all('SELECT * FROM schedule_state')).toHaveLength(0);
});
it('rejects changed preview hash before any write',()=>{
 f=fixture();const a=item(),command=batch([a]);a.payload.instructions='Changed';
 expect(f.accept(command).error?.code).toBe('REVISION_CONFLICT');expect(f.db.all("SELECT * FROM objects WHERE kind='routine'")).toHaveLength(0);
});
it('rolls back earlier objects if a later import grants action authority',()=>{
 f=fixture();const a=item(),b=item();b.payload.enabled=true;
 expect(f.accept(batch([a,b])).status).toBe('rejected');expect(f.db.all("SELECT * FROM objects WHERE kind='routine'")).toHaveLength(0);
});
it('rejects timezone mismatches and stale revision without partial adoption',()=>{
 f=fixture();const a=item(),b=item();b.payload.schedule!.timezone='Asia/Jakarta';
 expect(f.accept(batch([a,b])).status).toBe('rejected');
 b.payload.schedule!.timezone='Asia/Singapore';b.payload.expected_revision=2;
 expect(f.accept(batch([a,b])).error?.code).toBe('REVISION_CONFLICT');
 expect(f.db.all("SELECT * FROM objects WHERE kind='routine'")).toHaveLength(0);
});
