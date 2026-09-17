import {createHash,randomUUID} from 'node:crypto';
import {PersonalControl} from '../src/worker/control-object';
import type {ControlCore} from '../src/core/control';
import type {LifecycleCore} from '../src/core/lifecycle';
import type {Store} from '../src/core/store';
import type {OwnerAlphaPolicy} from '../src/core/owner-alpha';

type FixtureEnv=Env&{FIXTURE_NOW:string;DB:DurableObjectNamespace};
type Internals={core:ControlCore;lifecycle:LifecycleCore;store:Store};

export class OwnerAlphaSuccessorWorker extends PersonalControl {
 private clock:string;
 constructor(ctx:DurableObjectState,env:FixtureEnv){
  if(env.EXECUTION_ENABLED!=='false'||env.NATIVE_VERIFIED!=='false'||env.AUTH_MODE!=='local')throw Error('Unsafe fixture configuration');
  super(ctx,env);this.clock=env.FIXTURE_NOW;this.internals().core.options.now=()=>new Date(this.clock);
 }
 private internals(){return this as unknown as Internals;}
 private retained(runId:string,queuedId:string){
  const {store}=this.internals();
  return {
   run:store.db.all('SELECT * FROM runs WHERE id=?',runId),attempt:store.db.all('SELECT * FROM attempts WHERE run_id=?',runId),
   effect:store.db.all('SELECT * FROM effects WHERE run_id=?',runId),retry:store.db.all('SELECT * FROM retry_queue WHERE run_id=?',runId),
   queued:store.db.all('SELECT * FROM runs WHERE id=?',queuedId),queuedCommand:store.db.all('SELECT * FROM commands WHERE resource_id=?',queuedId),
   queuedEvent:store.db.all('SELECT * FROM events WHERE id=(SELECT command_id FROM runs WHERE id=?)',queuedId),
   originalAlpha:store.db.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")
  };
 }
 async fetch(request:Request){
  const url=new URL(request.url);if(url.hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
  const {core,lifecycle,store}=this.internals();
  if(url.pathname==='/prepare'&&request.method==='POST'){
   const persona=store.db.all<{id:string}>("SELECT id FROM objects WHERE kind='persona' ORDER BY id LIMIT 1")[0].id;
   const policy=core.ownerAlpha.configuredPolicy!;
   const oldBoot=randomUUID(),identity=lifecycle.registerBoot(oldBoot);lifecycle.ready(identity);
   const old=core.accept('fixture-owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:persona,text:'retained uncertain predecessor'}});
   const claim=lifecycle.claim(identity)!;lifecycle.submitted(identity,claim.run.id,1,'native:retained-uncertain');
   store.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','synthetic-authority','synthetic-request',?)",randomUUID(),claim.run.id,randomUUID(),core.now());
   store.db.exec('INSERT INTO retry_queue(run_id,due_at,reason) VALUES(?,?,?)',claim.run.id,'2026-01-01T00:00:00.000Z','synthetic-overdue');
   const queued=core.accept('fixture-owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:persona,text:'retained overdue queued context'}});
   store.db.exec("UPDATE commands SET accepted_at='2026-01-01T00:00:00.000Z' WHERE resource_id=?",queued.resource_id!);
   store.db.exec("UPDATE runs SET created_at='2026-01-01T00:00:00.000Z',updated_at='2026-01-01T00:00:00.000Z' WHERE id=?",queued.resource_id!);
   store.db.exec("UPDATE events SET created_at='2026-01-01T00:00:00.000Z' WHERE id=(SELECT command_id FROM runs WHERE id=?)",queued.resource_id!);
   this.clock='2026-09-17T00:02:00.000Z';lifecycle.watchdog();
   store.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP',lease_until=? WHERE singleton=1",policy.expires_at);
   const successor={schema_version:1 as const,transition_id:randomUUID(),owner_binding_sha256:'a'.repeat(64),predecessor:{session_id:policy.session_id,epoch:1,boot_id:oldBoot},retirement_receipt_sha256:'b'.repeat(64),
    successor:{policy:{session_id:randomUUID(),persona_id:persona,expires_at:'2026-09-17T00:06:00.000Z',max_runs:1,max_task_seconds:30,text_only:{profile_version:'codex-text-only-v1' as const,profile_sha256:'c'.repeat(64)}},boot_id:randomUUID()}};
   const commandId=randomUUID(),owner='operator:synthetic';
   store.db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,'applied',?)",commandId,owner,randomUUID(),createHash('sha256').update(JSON.stringify(successor)).digest('hex'),'owner-alpha.activate',JSON.stringify(successor),core.now());
   const binding={ownerBindingSha256:successor.owner_binding_sha256,predecessorPolicy:policy as OwnerAlphaPolicy,epoch:1,bootId:oldBoot,retirementReceiptSha256:successor.retirement_receipt_sha256};
   lifecycle.activateOwnerAlphaSuccessor(successor,binding,owner,commandId);
   return Response.json({runId:claim.run.id,queuedId:queued.resource_id,persona,generation:{epoch:2,boot_id:successor.successor.boot_id,transition_id:successor.transition_id},retained:this.retained(claim.run.id,queued.resource_id!)});
  }
  const ids={runId:url.searchParams.get('run')!,queuedId:url.searchParams.get('queued')!};
  if(url.pathname==='/accept'&&request.method==='POST'){
   const text=await request.text();const result=await this.accept('fixture-owner',randomUUID(),createHash('sha256').update(text).digest('hex'),JSON.parse(text));
   return Response.json({result,retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  }
  if(url.pathname==='/read')return Response.json({result:await this.getState('fixture-owner'),retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  if(url.pathname==='/status')return Response.json(await this.runtime({type:'status',payload:{}}));
  if(url.pathname==='/alarm'&&request.method==='POST'){
   this.clock=(await request.json() as {now:string}).now;await super.alarm();
   return Response.json({lifecycle:lifecycle.get(),retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  }
  return new Response('Not found',{status:404});
 }
}
export default {fetch(request:Request,env:FixtureEnv){
 if(new URL(request.url).hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
 return env.DB.get(env.DB.idFromName('owner-alpha-successor-fixture')).fetch(request);
}};
