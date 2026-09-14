import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {fixture,bot,otherBot} from './helpers';

let f:ReturnType<typeof fixture>;
beforeEach(()=>{f=fixture();});afterEach(()=>f.close());
const message=(conversation_id=bot)=>f.accept({schema_version:1,type:'message.send',payload:{conversation_id,text:'PRIVATE_TASK_CONTEXT'}}).resource_id!;

it('pages active work outside the latest100 window, with global counts independent of cursor',()=>{
 const ids=Array.from({length:13},()=>message());
 f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?",ids[2]);
 f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?",ids[7]);
 f.setNow('2026-09-10T00:01:00.000Z');
 for(let n=0;n<117;n++){const id=message(otherBot);f.db.exec("UPDATE runs SET status='completed' WHERE id=?",id);}
 expect(f.core.state().runs.some(run=>ids.includes(run.id))).toBe(false);
 expect(f.core.state().roster_activity.personas).toEqual([{persona_id:bot,unfinished:13,active:1,waiting:11,recovery:1}]);
 const before=['runs','commands','operations','effects','resource_locks','lifecycle'].map(table=>f.db.all(`SELECT * FROM ${table}`));
 const first=f.core.taskPage(bot),second=f.core.taskPage(bot,first.next_cursor!);
 expect(first.counts).toEqual({total:13,waiting:11,recovery:1});expect(second.counts).toEqual(first.counts);
 expect(first.runs).toHaveLength(10);expect(second.runs).toHaveLength(3);expect(second.next_cursor).toBeNull();
 expect([...first.runs,...second.runs].map(run=>run.id)).toEqual([...ids].sort());
 expect(first.runs.every(run=>run.request_status==='applied')).toBe(true);
 expect(JSON.stringify(first)).not.toContain('PRIVATE_TASK_CONTEXT');
 expect(first.runs[0]).not.toHaveProperty('context_json');expect(first.runs[0]).not.toHaveProperty('checkpoint_json');
 expect(['runs','commands','operations','effects','resource_locks','lifecycle'].map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
});

it('uses captured room scope rather than current membership and keeps persona work distinct',()=>{
 const room=randomUUID();
 f.accept({schema_version:1,type:'room.put',payload:{id:room,expected_revision:0,name:'Shared room',member_ids:[bot,otherBot],default_responder_id:bot}});
 const roomRun=message(room),personal=message(bot),other=message(otherBot);
 expect(f.core.taskPage(room).runs.map(run=>run.id)).toEqual([roomRun]);
 expect(f.core.taskPage(bot).runs.map(run=>run.id).sort()).toEqual([roomRun,personal].sort());
 expect(f.core.taskPage(otherBot).runs.map(run=>run.id)).toEqual([other]);
 f.accept({schema_version:1,type:'room.put',payload:{id:room,expected_revision:1,name:'Changed room',member_ids:[otherBot],default_responder_id:otherBot}});
 expect(f.core.taskPage(room).runs.map(run=>run.id)).toEqual([roomRun]);
});

it('removing one task does not shift the exclusive cursor or clear another waiting reason',()=>{
 const ids=Array.from({length:4},()=>message()).sort(),first=f.core.taskPage(bot,undefined,2);
 expect(first.next_cursor).toBe(ids[1]);
 f.accept({schema_version:1,type:'run.cancel',payload:{run_id:ids[0],reason:'Cancel only A'}});
 const next=f.core.taskPage(bot,first.next_cursor!,2);
 expect(next.runs.map(run=>run.id)).toEqual(ids.slice(2));expect(next.counts).toEqual({total:3,waiting:3,recovery:0});
 expect(f.store.run(ids[1]).status).toBe('waiting');
});

it('rejects malformed cursors, oversized pages and non-conversations; empty does not claim native readiness',()=>{
 for(const cursor of ['',"' OR 1=1",'../private'])expect(()=>f.core.taskPage(bot,cursor)).toThrow();
 for(const limit of [0,11,1.5,NaN])expect(()=>f.core.taskPage(bot,undefined,limit)).toThrow();
 const policy=randomUUID();f.store.put(policy,'policy',{},0,'owner',f.core.now());
 expect(()=>f.core.taskPage(policy)).toThrow();
 expect(f.core.taskPage(bot)).toMatchObject({counts:{total:0,waiting:0,recovery:0},runs:[],next_cursor:null});
 expect(f.core.taskPage(bot)).not.toHaveProperty('sleep_allowed');
});
