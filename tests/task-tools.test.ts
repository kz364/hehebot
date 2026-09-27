import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {AgentCommandBoundary} from '../src/core/agent-commands';
import {LifecycleCore,type Identity} from '../src/core/lifecycle';
import type {ContextSnapshot} from '../src/core/types';
import {bot,fixture} from './helpers';

// V4 (ARCHITECTURE_V2 A4): coordinator task tools, per-persona inbox and
// task.event wake. These tests exercise the ControlCore/AgentCommandBoundary
// layer directly (the same level tests/agent-commands.test.ts and
// tests/task-steering.test.ts already use for native-child rows) rather than
// a full scripted-Codex-model harness: a background V4 task run's own native
// admission/claim wiring is out of scope for this row (see final report).

const identity:Identity={epoch:1,boot_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
let f:ReturnType<typeof fixture>,boundary:AgentCommandBoundary,life:LifecycleCore,coordinatorId:string;

/** Admits a coordinator run in 'running' status with a real attempt, the way
 * AgentCommandBoundary requires (mirrors tests/agent-commands.test.ts's admit()). */
const FAR_FUTURE='2026-09-10T23:00:00.000Z';
function admitCoordinator(){
 const context=f.core.context(bot,'Coordinator turn',null,null) as ContextSnapshot;
 coordinatorId=randomUUID();const now=f.core.now();
 f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='READY',lease_until=?",identity.boot_id,FAR_FUTURE);
 f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'coordinator','running',1,?,?)",coordinatorId,bot,JSON.stringify(context),now,now);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,'native-coordinator','running',?,?)",coordinatorId,`${coordinatorId}:1`,identity.boot_id,FAR_FUTURE,now);
}
const start=(title:string,brief:string,capabilities?:string[])=>
 boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
  command:{schema_version:1,type:'task.start',payload:{title,brief,...(capabilities?{capabilities}:{})}}});

/** Directly transitions a queued V4 task run to 'running' with a real native
 * attempt, the same way native-child fixtures bypass the coordinator-only
 * claim() queue (see tests/task-steering.test.ts). */
function runTask(taskId:string,nativeRef=`native-${taskId}`){
 const now=f.core.now();
 f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",taskId);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running',?,?)",
  taskId,`${taskId}:1`,identity.boot_id,nativeRef,FAR_FUTURE,now);
}

beforeEach(()=>{f=fixture(true);life=new LifecycleCore(f.store,f.core);boundary=new AgentCommandBoundary(f.core,life);admitCoordinator();});
afterEach(()=>f.close());

describe('hehebot_start_task / task.start',()=>{
 const capA=randomUUID(),capB=randomUUID(),capUngranted=randomUUID();
 it('creates an independent background run under the calling coordinator, capability-bounded',()=>{
  // The coordinator's admitted ContextSnapshot is frozen at admission time
  // (beforeEach's admitCoordinator), so the persona grant must be updated
  // and the coordinator re-admitted for the new grant to appear in it.
  const existing=f.store.get(bot,'persona');
  f.store.put(bot,'persona',{...existing.body,tool_policy_ids:[capA,capB]},existing.revision,'owner',f.core.now());
  admitCoordinator();
  const receipt=start('Research hotels','Find three hotel options for the trip.',[capA]);
  expect(receipt.status).toBe('applied');
  const taskId=receipt.resource_id!;
  const task=f.store.run(taskId);
  expect(task).toMatchObject({role:'background',parent_run_id:coordinatorId,title:'Research hotels',status:'queued'});
  const context=JSON.parse(task.context_json) as ContextSnapshot;
  expect(context.instruction).toBe('Find three hotel options for the trip.');
  expect(context.persona.body.tool_policy_ids).toEqual([capA]);
  expect(context.coordinator_task).toBe(true);
 });
 it('rejects capabilities outside the persona grant',()=>{
  // Enforced by AgentCommandBoundary.accept before core.accept ever mints a
  // receipt, so this is a thrown ControlError, not a rejected receipt.
  expect(()=>start('Escalate','Do something privileged.',[capUngranted]))
   .toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });
 it('a background task itself may not start a task (no recursive fan-out)',()=>{
  const a=start('A','Task A brief').resource_id!;
  f.db.exec("UPDATE lifecycle SET boot_id=?,lease_until='2026-09-10T00:30:00.000Z'",identity.boot_id);
  runTask(a);
  expect(()=>boundary.accept({identity,run_id:a,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'task.start',payload:{title:'B',brief:'nested'}}}))
   .toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });
 it('a status question does not change any task: two independent starts stay independent',()=>{
  const a=start('Research flights','Find flights.').resource_id!;
  const before=f.store.run(a);
  const b=start('Research hotels','Find hotels.').resource_id!;
  expect(b).not.toBe(a);
  expect(f.store.run(a)).toEqual(before);
  const list=boundary.taskList({identity,run_id:coordinatorId,attempt:1});
  expect(list.tasks.map(t=>t.id).sort()).toEqual([a,b].sort());
  // Listing and reading detail never mutate task state.
  boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:a});
  expect(f.store.run(a)).toEqual(before);
 });
});

describe('hehebot_list_tasks / hehebot_task_detail scoping',()=>{
 it('only lists this coordinator\'s own tasks, filters by state, and paginates',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  runTask(a);
  // Both a (running) and b (still queued) are non-terminal, so both count as 'active'.
  expect(boundary.taskList({identity,run_id:coordinatorId,attempt:1,state:'active'}).tasks.map(t=>t.id).sort()).toEqual([a,b].sort());
  life.complete(identity,a,1,{status:'failed',text:'',error_code:'PROVIDER_ERROR'});
  expect(boundary.taskList({identity,run_id:coordinatorId,attempt:1,state:'failed'}).tasks.map(t=>t.id)).toEqual([a]);
  expect(boundary.taskList({identity,run_id:coordinatorId,attempt:1,state:'active'}).tasks.map(t=>t.id)).toEqual([b]);
  const detail=boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:a});
  expect(detail.task).toMatchObject({id:a,title:'A',status:'failed'});
 });
 it('refuses to read a run that is not this coordinator\'s own child at all',()=>{
  const other=randomUUID();
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'background','running',1,?,?)",
   other,bot,JSON.stringify({schema_version:1,persona:{id:null},routine:null,memories:[],skills:[],scope_key:null,instruction:'x',room_id:null,context_events:[],authorization_policy_ids:[]}),f.core.now(),f.core.now());
  expect(()=>boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:other})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
 });
 it('a pre-existing native-child run of this coordinator is readable (reads cover all background children, not just V4 tasks)',()=>{
  const other=randomUUID();
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'background',?,'running',1,?,?)",
   other,bot,JSON.stringify({schema_version:1,persona:{id:null},routine:null,memories:[],skills:[],scope_key:null,instruction:'x',room_id:null,context_events:[],authorization_policy_ids:[]}),coordinatorId,f.core.now(),f.core.now());
  expect(boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:other}).task.id).toBe(other);
 });
 it('V8: a later coordinator turn of the same persona sees and manages tasks an earlier turn started; another persona does not',()=>{
  const a=start('Research hotels','brief a').resource_id!;runTask(a);
  const first=coordinatorId;
  admitCoordinator(); // the "how's it going?" turn: a new coordinator run
  expect(coordinatorId).not.toBe(first);
  expect(boundary.taskList({identity,run_id:coordinatorId,attempt:1}).tasks.map(t=>t.id)).toEqual([a]);
  expect(boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:a}).task).toMatchObject({id:a,status:'running'});
  const receipt=boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.followup',payload:{run_id:a,text:'Also check reviews'}}});
  expect(receipt.status).toBe('applied');
  // Same task moved to another persona's conversation: invisible and unmanageable.
  const other=randomUUID(),existing=f.store.get(bot,'persona');
  f.store.put(other,'persona',{...existing.body,id:other,name:'Other bot'},0,'owner',f.core.now());
  f.db.exec('UPDATE runs SET persona_id=? WHERE id=?',other,a);
  f.db.exec('UPDATE runs SET persona_id=? WHERE id=?',other,first);
  expect(boundary.taskList({identity,run_id:coordinatorId,attempt:1}).tasks).toEqual([]);
  expect(()=>boundary.taskDetail({identity,run_id:coordinatorId,attempt:1,task_run_id:a})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  expect(()=>boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.cancel',payload:{run_id:a,reason:'nope'}}})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });
 it('a background task run may not call the task tools at all',()=>{
  const a=start('A','brief').resource_id!;runTask(a);
  expect(()=>boundary.taskList({identity,run_id:a,attempt:1})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>boundary.taskDetail({identity,run_id:a,attempt:1,task_run_id:a})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });
});

describe('hehebot_steer_task / hehebot_queue_followup / hehebot_cancel_task',()=>{
 it('steers task A while task B stays untouched, binding the live attempt server-side',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  runTask(a);const beforeB=f.store.run(b);
  const receipt=boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.steer',payload:{run_id:a,expected_attempt:1,text:'Use tomorrow for A'}}});
  expect(receipt.status).toBe('applied');
  expect(f.db.all('SELECT status FROM runs WHERE id=?',b)).toEqual([{status:beforeB.status}]);
 });
 it('a follow-up is queued and delivered only after A settles',()=>{
  const a=start('A','brief a').resource_id!;runTask(a);
  const receipt=boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.followup',payload:{run_id:a,text:'Also check reviews'}}});
  expect(receipt.status).toBe('applied');
  expect(f.db.all("SELECT status FROM task_followups WHERE run_id=?",a)).toEqual([{status:'pending'}]);
  life.complete(identity,a,1,{status:'completed',text:'Done with A'});
  expect(f.db.all("SELECT status FROM task_followups WHERE run_id=?",a)).toEqual([{status:'coordinator_queued'}]);
 });
 it('cancels a task by task_run_id',()=>{
  const a=start('A','brief a').resource_id!;runTask(a);
  const receipt=boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.cancel',payload:{run_id:a,reason:'Coordinator requested cancellation.'}}});
  expect(receipt.status).toBe('applied');
  expect(f.store.run(a).status).toBe('cancelling');
 });
 it('refuses to manage a native-child row (only hehebot_start_task-created tasks qualify)',()=>{
  const other=randomUUID();
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'background',?,'running',1,?,?)",
   other,bot,JSON.stringify({schema_version:1,persona:{id:null},routine:null,memories:[],skills:[],scope_key:null,instruction:'x',room_id:null,context_events:[],authorization_policy_ids:[]}),coordinatorId,f.core.now(),f.core.now());
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running','2026-09-10T00:30:00.000Z',?)",other,`${other}:1`,identity.boot_id,'native-other',f.core.now());
  expect(()=>boundary.accept({identity,run_id:coordinatorId,attempt:1,idempotency_key:randomUUID(),
   command:{schema_version:1,type:'run.cancel',payload:{run_id:other,reason:'nope'}}})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });
});

describe('per-persona coordinator inbox (message.send routing)',()=>{
 it('gated off by default: message.send keeps creating one run per message',()=>{
  const first=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Hi'}}).resource_id!;
  const second=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Still there?'}}).resource_id!;
  expect(first).not.toBe(second);
  expect(f.db.all("SELECT COUNT(*) AS n FROM runs WHERE role='coordinator'")).toEqual([{n:3}]); // admitCoordinator's fixture run + 2
 });
 it('steers the live running coordinator turn instead of starting a new run',()=>{
  f.core.options.coordinatorInbox=true;
  const receipt=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Also check the weather'}});
  expect(receipt.status).toBe('applied');
  const runsAfter=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND id!=?",coordinatorId);
  expect(runsAfter).toEqual([]); // no second coordinator run was created
  expect(f.db.all('SELECT type FROM commands WHERE type=?','run.steer')).toHaveLength(1);
 });
 it('batches every un-consumed owner message since the last inbox delivery into one new coordinator run',()=>{
  f.core.options.coordinatorInbox=true;
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",coordinatorId); // no live coordinator
  // Two owner messages land (e.g. sent in quick succession) before the inbox
  // next delivers to this persona -- both must be folded into the single
  // coordinator run the next message.send enqueues, not silently dropped.
  f.store.event(randomUUID(),bot,'message.user','owner',null,{text:'First unconsumed message'},f.core.now());
  f.store.event(randomUUID(),bot,'message.user','owner',null,{text:'Second unconsumed message'},f.core.now());
  const third=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Third message, the delivery trigger'}});
  const run=f.store.run(third.resource_id!);
  const context=JSON.parse(run.context_json) as ContextSnapshot;
  expect(context.instruction).toContain('First unconsumed message');
  expect(context.instruction).toContain('Second unconsumed message');
  expect(context.instruction).toContain('Third message, the delivery trigger');
 });
});

describe('task.event coordinator wake',()=>{
 it('a completed task appends task.event and enqueues exactly one coordinator wake',()=>{
  const a=start('Research hotels','Find hotels.').resource_id!;runTask(a);
  life.complete(identity,a,1,{status:'completed',text:'Found three great hotels.'});
  const events=f.db.all<{type:string;payload_json:string}>("SELECT type,payload_json FROM events WHERE type='task.event'");
  expect(events).toHaveLength(1);
  expect(JSON.parse(events[0].payload_json)).toMatchObject({task_run_id:a,status:'completed',title:'Research hotels'});
  const wakes=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND id!=? AND parent_run_id IS NULL",coordinatorId);
  expect(wakes).toHaveLength(1);
  const wakeContext=JSON.parse(f.store.run(wakes[0].id).context_json) as ContextSnapshot;
  expect(wakeContext.instruction).toContain('Research hotels');
  expect(wakeContext.instruction).toContain('completed');
 });
 // V2 follow-up (ARCHITECTURE_V2 A3/A4): a coordinator task fenced into
 // 'interrupted' (epoch advance, boot-lease loss, unconfirmed cancellation --
 // never a native-reported completion) owes its coordinator the same
 // task.event + bounded wake a normal settlement fires via complete().
 it('an interrupted task appends task.event and wakes its coordinator, same as a normal settlement',()=>{
  const a=start('Research hotels','Find hotels.').resource_id!;runTask(a);
  life.watchdog(); // lease intact; nothing happens yet.
  expect(f.db.all("SELECT id FROM events WHERE type='task.event'")).toEqual([]);
  f.db.exec("UPDATE lifecycle SET lease_until=? WHERE singleton=1",'2026-09-10T00:00:00.000Z');
  f.setNow('2026-09-10T00:00:01.000Z');
  life.watchdog();
  expect(f.store.run(a).status).toBe('interrupted');
  const events=f.db.all<{type:string;payload_json:string}>("SELECT type,payload_json FROM events WHERE type='task.event'");
  expect(events).toHaveLength(1);
  expect(JSON.parse(events[0].payload_json)).toMatchObject({task_run_id:a,status:'interrupted',title:'Research hotels'});
  const wakes=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND id!=? AND parent_run_id IS NULL",coordinatorId);
  expect(wakes).toHaveLength(1);
  const wakeContext=JSON.parse(f.store.run(wakes[0].id).context_json) as ContextSnapshot;
  expect(wakeContext.instruction).toContain('Research hotels');
  expect(wakeContext.instruction).toContain('interrupted');
 });
 it('a native-child completion never appends a task.event',()=>{
  const other=randomUUID();
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'background',?,'running',1,?,?)",
   other,bot,JSON.stringify({schema_version:1,persona:{id:null},routine:null,memories:[],skills:[],scope_key:null,instruction:'x',room_id:null,context_events:[],authorization_policy_ids:[]}),coordinatorId,f.core.now(),f.core.now());
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running','2026-09-10T00:30:00.000Z',?)",other,`${other}:1`,identity.boot_id,'native-other',f.core.now());
  life.complete(identity,other,1,{status:'completed',text:'child done'});
  expect(f.db.all("SELECT id FROM events WHERE type='task.event'")).toEqual([]);
 });
 it('batches two completions within 2s into a single coordinator wake',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  runTask(a);runTask(b);
  f.setNow('2026-09-10T00:20:10.000Z');
  life.complete(identity,a,1,{status:'completed',text:'A done'});
  f.setNow('2026-09-10T00:20:11.500Z');
  life.complete(identity,b,1,{status:'completed',text:'B done'});
  const wakes=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND id!=? AND parent_run_id IS NULL",coordinatorId);
  expect(wakes).toHaveLength(1);
  const context=JSON.parse(f.store.run(wakes[0].id).context_json) as ContextSnapshot;
  expect(context.instruction).toContain('"A"');expect(context.instruction).toContain('"B"');
 });
 it('does not batch a completion arriving more than 2s after the pending wake',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  runTask(a);runTask(b);
  f.setNow('2026-09-10T00:20:10.000Z');
  life.complete(identity,a,1,{status:'completed',text:'A done'});
  f.setNow('2026-09-10T00:20:13.000Z');
  life.complete(identity,b,1,{status:'completed',text:'B done'});
  const wakes=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND id!=? AND parent_run_id IS NULL",coordinatorId);
  expect(wakes).toHaveLength(2);
 });
 it('stops after a bounded causal chain of automatic wakes (depth <= 3)',()=>{
  // Simulate a chain of coordinator wakes, each immediately starting and
  // completing one more task, and assert the 4th automatic wake never fires.
  let currentCoordinator=coordinatorId,depth=0;
  for(let i=0;i<4;i++){
   // Each link settles more than 2s after the previous one so its task.event
   // mints a genuinely new coordinator wake instead of batching into it.
   f.setNow(new Date(Date.parse('2026-09-10T00:20:00.000Z')+i*5000).toISOString());
   const taskId=randomUUID(),now=f.core.now();
   const context={schema_version:1,persona:f.store.get(bot,'persona'),routine:null,memories:[],skills:[],
    scope_key:`${bot}/task/${taskId}`,instruction:`chain-${i}`,room_id:null,context_events:[],authorization_policy_ids:[],coordinator_task:true as const};
   f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,title,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'background',?,?,'running',1,?,?)",
    taskId,bot,JSON.stringify(context),currentCoordinator,`chain-${i}`,now,now);
   f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at) VALUES(?,1,?,1,?,?,'running','2026-09-10T00:30:00.000Z',?)",
    taskId,`${taskId}:1`,identity.boot_id,`native-chain-${i}`,now);
   life.complete(identity,taskId,1,{status:'completed',text:`chain-${i} done`});
   const wakes=f.db.all<{id:string}>("SELECT id FROM runs WHERE role='coordinator' AND parent_run_id IS NULL AND id NOT IN (SELECT id FROM runs WHERE id=?) ORDER BY created_at",coordinatorId);
   if(depth<3){
    expect(wakes.length).toBe(i+1);
    currentCoordinator=wakes.at(-1)!.id;
    depth++;
   }else{
    // The 4th chain link's completion must not mint a 5th coordinator run.
    expect(wakes.length).toBe(3);
   }
  }
 });
});

// V4b (ARCHITECTURE_V2 A4, docs/AGENT_MODEL.md "one reserved interactive model
// turn plus at most one background model turn installation-wide"): the claim
// lane that actually executes a V4 task run. Before this row, a started task
// sat 'queued' forever because nextClaimableRun() only ever admitted
// role='coordinator' runs (see the V4 TODO gap note and AGENTS.md trap #6:
// critical path first).
describe('claim() background task lane (V4b)',()=>{
 const claimTask=()=>life.claim(identity,undefined,undefined,[],'background');
 it('a queued task run is claimable on the background lane with an isolated context snapshot',()=>{
  const capA=randomUUID();
  const existing=f.store.get(bot,'persona');
  f.store.put(bot,'persona',{...existing.body,tool_policy_ids:[capA]},existing.revision,'owner',f.core.now());
  admitCoordinator();
  const taskId=start('Research hotels','Find three hotel options for the trip.',[capA]).resource_id!;
  // The coordinator lane never sees a V4 task run as claimable.
  expect(life.nextClaimableRun('coordinator')?.id).not.toBe(taskId);
  expect(life.nextClaimableRun('background')?.id).toBe(taskId);
  const claim=claimTask();
  expect(claim).not.toBeNull();
  // Reused claim envelope fields tell the runtime this is a task run: role,
  // parent_run_id and title already exist on the Run row/claim response.
  expect(claim!.run).toMatchObject({id:taskId,role:'background',parent_run_id:coordinatorId,title:'Research hotels',status:'claimed',current_attempt:1});
  const context=JSON.parse(claim!.run.context_json) as ContextSnapshot;
  expect(context.instruction).toBe('Find three hotel options for the trip.');
  expect(context.persona.body.tool_policy_ids).toEqual([capA]); // capability-scoped grant
  expect(context.coordinator_task).toBe(true);
  // Isolated: never widened into the coordinator's full persona/history context.
  expect(context.conversation_history).toBeUndefined();
  expect(context.task_summaries).toBeUndefined();
 });
 it('capacity: two queued tasks are claimed one at a time, the second only after the first completes',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  const claimA=claimTask();
  expect(claimA!.run.id).toBe(a);
  expect(claimTask()).toBeNull(); // capacity: one active background task installation-wide
  life.submitted(identity,a,1,'native-a');
  life.complete(identity,a,1,{status:'completed',text:'done'});
  const claimB=claimTask();
  expect(claimB!.run.id).toBe(b);
 });
 it('a running background task never blocks the coordinator claim, and a running coordinator never blocks a task claim',()=>{
  const a=start('A','brief a').resource_id!,b=start('B','brief b').resource_id!;
  const claimA=claimTask();
  expect(claimA!.run.id).toBe(a);
  // The coordinator's own run is already 'running' from admitCoordinator();
  // queue a second coordinator run and confirm it is claimable regardless of
  // the background task actively running -- the coordinator slot is never
  // consumed by a task (reserved interactive).
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",coordinatorId);
  const nextCoordinator=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Hi'}}).resource_id!;
  const coordinatorClaim=life.claim(identity);
  expect(coordinatorClaim!.run.id).toBe(nextCoordinator);
  // And the background lane is still independently claimable, once task A settles.
  life.submitted(identity,a,1,'native-a');life.complete(identity,a,1,{status:'completed',text:'done'});
  expect(claimTask()!.run.id).toBe(b);
 });
 it('a queued background task does not consume the coordinator capacity check, and vice versa',()=>{
  const a=start('A','brief a').resource_id!;
  // With the coordinator's own attempt still 'running' (admitCoordinator), a
  // fresh coordinator claim is refused for the ordinary single-coordinator-
  // lane reason -- never because a queued task exists.
  expect(life.claim(identity)).toBeNull();
  // The background lane is unaffected by the coordinator being busy.
  expect(claimTask()!.run.id).toBe(a);
 });
});
