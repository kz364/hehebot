import {createHash,randomUUID} from 'node:crypto';
import {PersonalControl} from '../src/worker/control-object';
import {digest} from '../src/worker/http';
import type {ControlCore} from '../src/core/control';
import type {LifecycleCore} from '../src/core/lifecycle';
import type {Store} from '../src/core/store';
import {ownerAlphaSuccessorSha256} from '../src/core/owner-alpha';
import type {HostedOwnerWake} from '../src/worker/hosted-owner-wake';
import worker from '../src/worker/index';

type FixtureEnv=Env&{FIXTURE_NOW:string;DB:DurableObjectNamespace};
type Internals={core:ControlCore;lifecycle:LifecycleCore;store:Store;hostedWake:HostedOwnerWake|undefined};

export class OwnerAlphaSuccessorWorker extends PersonalControl {
 private clock:string;
 private wakeDeliveries:{url:string;body:string}[]|undefined;
 private wakeCallbackEvidence:{claimableRunId:string|null;messageEvent:{id:string;conversation_id:string|null;type:string;payload_json:string}|null}[]|undefined;
 protected async sendHostedWake(command:{epoch:number;operationId:string}):Promise<void>{
  if(!this.wakeDeliveries)throw Error('Fixture refuses live wake');
  const {lifecycle,store}=this.internals(),claimable=lifecycle.nextClaimableRun();
  const messageEvent=claimable?store.db.all<{id:string;conversation_id:string|null;type:string;payload_json:string}>('SELECT id,conversation_id,type,payload_json FROM events WHERE id=(SELECT command_id FROM runs WHERE id=?)',claimable.id)[0]??null:null;
  this.wakeCallbackEvidence?.push({claimableRunId:claimable?.id??null,messageEvent});
  this.wakeDeliveries.push({url:'https://hehebot-fixture.sprites.app/wake',body:JSON.stringify(command)});
 }
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
  const body=request.method==='POST'?await request.text():undefined;
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
   // Loopback-only synthetic grant: these values exercise admission, not real retirement evidence.
   core.options.ownerAlphaSuccessor=successor;core.options.ownerBindingSha256=successor.owner_binding_sha256;
   const command={schema_version:1 as const,type:'owner-alpha.activate' as const,payload:{transition_id:successor.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(successor)}};
   const key=randomUUID(),before=this.retained(claim.run.id,queued.resource_id!);
   const beforeRejected={lifecycle:lifecycle.get(),alarm:await this.ctx.storage.getAlarm()};
   const changed={...command,payload:{...command.payload,envelope_sha256:'d'.repeat(64)}};
   const rejected=await this.accept('fixture-owner',randomUUID(),await digest(changed),changed);
   const afterRejected={lifecycle:lifecycle.get(),alarm:await this.ctx.storage.getAlarm(),retained:this.retained(claim.run.id,queued.resource_id!)};
   const activation=await this.accept('fixture-owner',key,await digest(command),command);
   return Response.json({runId:claim.run.id,queuedId:queued.resource_id,persona,key,command,activation,rejected,beforeRejected,afterRejected,generation:{epoch:2,boot_id:successor.successor.boot_id,transition_id:successor.transition_id},before,retained:this.retained(claim.run.id,queued.resource_id!)});
  }
  const ids={runId:url.searchParams.get('run')!,queuedId:url.searchParams.get('queued')!};
  if(url.pathname==='/retry-activation'&&request.method==='POST'){
   const input=JSON.parse(body!);
   const result=await this.accept('fixture-owner',request.headers.get('idempotency-key')!,await digest(input),input);
   return Response.json({result,retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  }
  if(url.pathname==='/hosted-wake'&&request.method==='POST'){
   const internals=this.internals(),active=core.ownerAlpha.activeGeneration()!;
   const hostedWake={transition_id:active.transition_id,url:'https://hehebot-fixture.sprites.app'};
   const original=internals.hostedWake;
   const deliveries:{url:string;body:string}[]=[];
   const callbackEvidence:{claimableRunId:string|null;messageEvent:{id:string;conversation_id:string|null;type:string;payload_json:string}|null}[]=[];
   try{
    internals.hostedWake=hostedWake;this.wakeDeliveries=deliveries;this.wakeCallbackEvidence=callbackEvidence;
    const before={lifecycle:lifecycle.get(),retained:this.retained(ids.runId,ids.queuedId)};
    const earliestAlarm=Date.now()+2000;await this.ctx.storage.setAlarm(earliestAlarm);
    await this.getState('fixture-owner');await this.getTimeline('fixture-owner',active.policy.persona_id);await this.getState('fixture-owner');
    const alarmAfterReads=await this.ctx.storage.getAlarm();
    await super.alarm();await super.alarm();
    const passiveIntent=store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key=?",`owner_alpha_wake:${active.epoch}`);
    const passive={deliveries:[...deliveries],intent:passiveIntent.length?JSON.parse(passiveIntent[0].value_json):null,callbackEvidence:[...callbackEvidence]};
    const after={lifecycle:lifecycle.get(),retained:this.retained(ids.runId,ids.queuedId)};
    const message={schema_version:1 as const,type:'message.send' as const,payload:{conversation_id:active.policy.persona_id,text:'fresh successor input'}};
    const accepted=await this.accept('fixture-owner',randomUUID(),await digest(message),message);
    const acceptedRunId=accepted.ok?accepted.value.resource_id:null;
    const queued=acceptedRunId?store.db.all('SELECT * FROM runs WHERE id=?',acceptedRunId):[];
    const queuedEvent=acceptedRunId?store.db.all('SELECT * FROM events WHERE id=(SELECT command_id FROM runs WHERE id=?)',acceptedRunId):[];
    await super.alarm();await super.alarm();
    const intent=store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key=?",`owner_alpha_wake:${active.epoch}`);
    return Response.json({before,after,earliestAlarm,alarmAfterReads,passive,accepted,queued,queuedEvent,deliveries,callbackEvidence,intent:intent.length?JSON.parse(intent[0].value_json):null,alarm:await this.ctx.storage.getAlarm()});
   }finally{
    internals.hostedWake=original;this.wakeDeliveries=undefined;this.wakeCallbackEvidence=undefined;
   }
  }
  if(url.pathname==='/accept'&&request.method==='POST'){
   const text=body!;const result=await this.accept('fixture-owner',randomUUID(),createHash('sha256').update(text).digest('hex'),JSON.parse(text));
   return Response.json({result,retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  }
  if(url.pathname==='/read')return Response.json({result:await this.getState('fixture-owner'),retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  if(url.pathname==='/status'){
   const generation=core.ownerAlpha.activeGeneration();
   return Response.json(await this.runtime({type:'status',payload:{}},generation&&{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id}));
  }
  if(url.pathname==='/continue'&&request.method==='POST'){
   this.clock='2026-09-17T00:07:00.000Z';
   const prior=core.ownerAlpha.activeGeneration()!;
   const successor={...prior.authority,transition_id:randomUUID(),
    predecessor:{session_id:prior.policy.session_id,epoch:prior.epoch,boot_id:prior.boot_id},
    successor:{policy:{...prior.policy,session_id:randomUUID(),expires_at:'2026-09-17T00:11:00.000Z'},boot_id:randomUUID()}};
   core.options.ownerAlphaSuccessor=successor;core.options.ownerBindingSha256=successor.owner_binding_sha256;
   const command={schema_version:1 as const,type:'owner-alpha.activate' as const,payload:{transition_id:successor.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(successor)}};
   const result=await this.accept('fixture-owner',randomUUID(),await digest(command),command);
   return Response.json({result,retained:this.retained(ids.runId,ids.queuedId),generation:{epoch:3,boot_id:successor.successor.boot_id,transition_id:successor.transition_id}});
  }
  if(url.pathname==='/alarm'&&request.method==='POST'){
   this.clock=(JSON.parse(body!) as {now:string}).now;await super.alarm();
   return Response.json({lifecycle:lifecycle.get(),retained:this.retained(ids.runId,ids.queuedId),alarm:await this.ctx.storage.getAlarm()});
  }
  return new Response('Not found',{status:404});
 }
}
/** Actual hosted constructor and private HTTP auth, with only clock/owner-login and
 * wake transport replaced. No public fixture can run off loopback. */
export class OwnerAlphaBootstrapWorker extends PersonalControl {
 private clock:string;
 private callbackOrigin:string|undefined;
 constructor(ctx:DurableObjectState,env:FixtureEnv){
  if(env.EXECUTION_ENABLED!=='false'||env.NATIVE_VERIFIED!=='false'||env.AUTH_MODE!=='access'||!env.HEHEBOT_OWNER_ALPHA_BOOTSTRAP)throw Error('Unsafe bootstrap fixture configuration');
  super(ctx,env);this.clock=env.FIXTURE_NOW;this.internals().core.options.now=()=>new Date(this.clock);
 }
 private internals(){return this as unknown as Internals;}
 protected async sendHostedWake(command:{epoch:number;operationId:string}):Promise<void>{
  const {store,lifecycle}=this.internals(),run=lifecycle.nextClaimableRun();
  const receipt=run?store.db.all('SELECT id,status,resource_id,body_hash FROM commands WHERE id=?',run.command_id)[0]:null;
  const event=run?store.db.all("SELECT id,type,payload_json FROM events WHERE id=? AND type='message.user'",run.command_id)[0]:null;
  const prior=store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='fixture_bootstrap_deliveries'")[0];
  // The real listener must authenticate back to this same DO before acknowledging
  // wake. Exercise that round trip while the sending alarm is still awaiting us.
  if(!this.callbackOrigin)throw Error('Missing loopback callback origin');
  const response=await fetch(`${this.callbackOrigin}/internal/manager/manifest`,{method:'POST',
   headers:{'content-type':'application/json',authorization:`Bearer ${this.env.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN}`},
   body:'{}',signal:AbortSignal.timeout(5000)});
  if(response.status!==200)throw Error(`Manager callback status ${response.status}`);
  const assignment=await response.json() as {grant:{run_id:string;epoch:number;transition_id:string;manifest_sha256:string}}|null;
  const intent=store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_wake:${command.epoch}`)[0];
  const callback={grant:assignment?.grant??null,wake_status:intent?JSON.parse(intent.value_json).status:null};
  const deliveries=prior?JSON.parse(prior.value_json):[];deliveries.push({command,run_id:run?.id??null,receipt,event,callback});
  store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('fixture_bootstrap_deliveries',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",JSON.stringify(deliveries));
 }
 async fetch(request:Request){
  const url=new URL(request.url);if(url.hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
  // Consume every POST, including inspection/alarms, before returning or forwarding.
  const body=request.method==='POST'?await request.text():undefined;
  this.callbackOrigin=url.origin;
  const {core,lifecycle,store}=this.internals();
  if(url.pathname==='/bootstrap-prepare'){
   const policy=core.ownerAlpha.configuredPolicy!,identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
   const message={schema_version:1 as const,type:'message.send' as const,payload:{conversation_id:policy.persona_id,text:'retained bootstrap predecessor'}};
   const old=core.accept(this.env.OWNER_SUB,randomUUID(),await digest(message),message),claim=lifecycle.claim(identity)!;
   lifecycle.submitted(identity,claim.run.id,1,'native:bootstrap-unknown');
   store.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','fixture-auth','fixture-request',?)",randomUUID(),claim.run.id,randomUUID(),core.now());
   this.clock=(JSON.parse(body!) as {now:string}).now;lifecycle.watchdog();
   const waiting=core.accept(this.env.OWNER_SUB,randomUUID(),await digest(message),message);
   store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('fixture_bootstrap_ids',?)",JSON.stringify({old:old.resource_id,waiting:waiting.resource_id}));
   return Response.json({retirement:{...identity,session_id:policy.session_id,transition_id:null,observed_at:core.now(),direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'credential-free-workerd-fixture'}});
  }
  if(url.pathname==='/bootstrap-alarm'){
   const input=JSON.parse(body!);if(input.now)this.clock=input.now;
   await super.alarm();return Response.json({phase:lifecycle.get().phase});
  }
  if(url.pathname==='/bootstrap-inspect'){
   const ids=store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='fixture_bootstrap_ids'")[0];
   const selected=ids?JSON.parse(ids.value_json):null;
   const metadata=(key:string)=>{const r=store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];return r?JSON.parse(r.value_json):null;};
   return Response.json({lifecycle:lifecycle.get(),manifest:core.bootstrap.assignedManifest()??null,summary:core.bootstrap.summary(),
    deliveries:metadata('fixture_bootstrap_deliveries')??[],reservations:store.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'"),
    wakeIntents:store.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'"),
    retained:selected?{old:store.db.all('SELECT * FROM runs WHERE id=?',selected.old),waiting:store.db.all('SELECT * FROM runs WHERE id=?',selected.waiting),attempt:store.db.all('SELECT * FROM attempts WHERE epoch=1'),effects:store.db.all('SELECT * FROM effects WHERE run_id=?',selected.old),original:metadata('owner_alpha')}:null});
  }
  return new Response('Not found',{status:404});
 }
}
export default {fetch(request:Request,env:FixtureEnv){
 if(new URL(request.url).hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
 if(env.HEHEBOT_OWNER_ALPHA_BOOTSTRAP){
  if(new URL(request.url).pathname.startsWith('/bootstrap-'))return env.CONTROL.getByName(env.INSTALLATION_ID).fetch(request);
  // Synthetic loopback owner login only. The DO still receives real Access-mode
  // constructor configuration/binding; private manager/task routes use it unchanged.
  return worker.fetch(request,new URL(request.url).pathname.startsWith('/v1/')?{...env,AUTH_MODE:'local'}:env);
 }
 return env.DB.get(env.DB.idFromName('owner-alpha-successor-fixture')).fetch(request);
}};
