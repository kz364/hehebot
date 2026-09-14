import {FlightRestoreIntegration} from '../core/flight-integration';
import { DurableObject } from 'cloudflare:workers';
import {migrateApplication} from '../core/migrations';
import {NativeTaskLedger} from '../core/native-tasks';
import {ResourceLedger} from '../core/resources';
import { rpcResult } from './rpc';
import schema from '../../DB/schema.sql';
import { Store, type Database, type SqlValue } from '../core/store';
import { ControlCore } from '../core/control';
import { LifecycleCore } from '../core/lifecycle';
import { EffectLedger } from '../core/effects';
import { ControlError, requireThat, safeError } from '../core/errors';
import { createProvider, type ProviderConfig, type RuntimeRef } from '../providers';
import validateRuntime from '../generated/validate-runtime.js';
import type { RuntimeCommand } from '../core/runtime-types';
import type { RoutinePut } from '../core/types';
import {AgentCommandBoundary} from '../core/agent-commands';
export type TriggerPolicy={routine_id:string;event_types:string[]};
function stringList(value:string):string[]{const parsed:unknown=JSON.parse(value);if(!Array.isArray(parsed)||!parsed.every(x=>typeof x==='string'))throw new Error('Invalid policy configuration');return parsed;}
function delegationMap(value:string):Record<string,string[]>{
 const parsed:unknown=JSON.parse(value);
 requireThat(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.entries(parsed).every(([key,targets])=>/^[0-9a-f-]{36}$/i.test(key)&&Array.isArray(targets)&&targets.length<=5&&targets.every(x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x))),'INVALID_CONFIGURATION','Invalid native delegation map.',503);
 return parsed as Record<string,string[]>;
}
export class PersonalControl extends DurableObject<Env> {
 private store:Store;
 private core:ControlCore;
 private lifecycle:LifecycleCore;
 private flights:FlightRestoreIntegration;
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  const db:Database={
   all:<T>(sql:string,...values:SqlValue[])=>this.ctx.storage.sql.exec(sql,...values).toArray() as T[],
   exec:(sql:string,...values:SqlValue[])=>{this.ctx.storage.sql.exec(sql,...values);},
   transaction:<T>(fn:()=>T)=>this.ctx.storage.transactionSync(fn)
  };
  this.store=new Store(db);
  this.core=new ControlCore(this.store,{executionEnabled:env.EXECUTION_ENABLED==='true'&&env.NATIVE_VERIFIED==='true',delegations:delegationMap(env.NATIVE_DELEGATIONS??'{}'),actionPolicyIds:stringList(env.ACTION_POLICY_IDS),toolPolicyIds:stringList(env.TOOL_POLICY_IDS),now:()=>new Date(),uuid:()=>crypto.randomUUID()});
  let idleMode=false;
  try{idleMode=createProvider(JSON.parse(env.PROVIDER_CONFIG) as ProviderConfig).capabilities.stopMode==='provider-idle';}catch{}
  this.lifecycle=new LifecycleCore(this.store,this.core,{idleMode});
  this.flights=new FlightRestoreIntegration(this.store,this.core,this.lifecycle,{enabled:env.FLIGHT_RESTORE_VERIFIED==='true',policyId:env.FLIGHT_RESTORE_POLICY_ID??''});
  this.ctx.blockConcurrencyWhile(async()=>{
   if(!db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'").length)db.exec(schema.replace('PRAGMA foreign_keys = ON;',''));
   migrateApplication(db,this.core.now());
   this.flights.initialize();
   const config=JSON.parse(env.PROVIDER_CONFIG) as {ref?:RuntimeRef};
   this.lifecycle.initialize(config.ref??{});
   const savedRef=JSON.parse(this.lifecycle.get().provider_ref_json) as Record<string,unknown>;
   const desiredRef=(config.ref??{}) as unknown as Record<string,unknown>;
   requireThat(Object.keys({...savedRef,...desiredRef}).every(key=>savedRef[key]===desiredRef[key]),'PROVIDER_MIGRATION_REQUIRED','Runtime identity changed; perform an explicit stopped-state migration.',503);
   this.core.seed();
   const triggers=JSON.parse(env.TRIGGER_CONFIG) as Record<string,TriggerPolicy>;
   for(const [id,policy] of Object.entries(triggers)){
    const existing=db.all<{revision:number;body_json:string}>('SELECT revision,body_json FROM objects WHERE id=?',id)[0];
    if(!existing||existing.body_json!==JSON.stringify(policy))this.store.put(id,'trigger',policy,existing?.revision??0,'operator',this.core.now());
   }
  });
 }
 private rate(subject:string,limit:number){
  const window=Math.floor(Date.now()/60000);
  this.store.db.transaction(()=>{
   this.store.db.exec('DELETE FROM rate_limits WHERE window_start<?',window-2);
   const count=this.store.db.all<{count:number}>('SELECT count FROM rate_limits WHERE subject=? AND window_start=?',subject,window)[0]?.count??0;
   requireThat(count<limit,'RATE_LIMITED','Please wait before trying again.',429);
   this.store.db.exec('INSERT INTO rate_limits(subject,window_start,count) VALUES(?,?,1) ON CONFLICT(subject,window_start) DO UPDATE SET count=count+1',subject,window);
  });
 }
 async accept(owner:string,key:string,hash:string,input:unknown){return rpcResult(async()=>{this.rate(owner+':write',60);const result=this.core.accept(owner,key,hash,input);await this.arm();return result;});}
 getReceipt(owner:string,id:string){return rpcResult(()=>{this.rate(owner+':read',120);return this.core.receipt(id);});}
 async getState(owner:string,after?:number,limit=100){return rpcResult(async()=>{this.rate(owner+':read',120);this.core.tick();await this.arm();return {...this.core.state(after,limit),provider:this.providerSummary()};});}
 getTimeline(owner:string,id:string,before?:number){return rpcResult(()=>{this.rate(owner+':read',120);const object=this.store.get(id);requireThat(['persona','room'].includes(object.kind),'NOT_FOUND','Conversation unavailable.',404);const events=this.store.conversationEvents(id,before,100);return {events,before_cursor:events[0]?.sequence??null,has_more:events.length===100};});}
 private providerSummary(){
  try{const config=JSON.parse(this.env.PROVIDER_CONFIG) as ProviderConfig;const provider=createProvider({...config,token:this.env.PROVIDER_TOKEN,wakeToken:this.env.SPRITE_WAKE_TOKEN} as ProviderConfig);return {id:provider.id,capabilities:provider.capabilities,live_verified:false};}
  catch{return {id:'unconfigured',capabilities:null,live_verified:false};}
 }
 async trigger(sourceId:string,eventId:string,bodyHash:string,type:string,data:Record<string,unknown>){return rpcResult(async()=>{
  this.rate(sourceId+':trigger',120);
  const old=this.store.db.all<{body_hash:string;command_id:string}>('SELECT body_hash,command_id FROM webhook_receipts WHERE source_id=? AND event_id=?',sourceId,eventId)[0];
  if(old){requireThat(old.body_hash===bodyHash,'IDEMPOTENCY_CONFLICT','Event ID already has different content.');return this.core.receipt(old.command_id);}
  const result=this.store.db.transaction(()=>{
   const source=this.store.get<TriggerPolicy>(sourceId,'trigger');
   requireThat(source.body.event_types.includes(type),'FORBIDDEN','This event type is not allowed.',403);
   const routine=this.store.get<RoutinePut>(source.body.routine_id,'routine');
   requireThat(routine.body.enabled&&routine.body.trigger_source_id===sourceId,'CAPABILITY_UNAVAILABLE','This trigger routine is not enabled.');
   const id=crypto.randomUUID(),now=this.core.now();
   this.store.db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,'applied',?)",id,`trigger:${sourceId}`,eventId,bodyHash,'trigger.event',JSON.stringify({type,data}),now);
   this.store.event(id,routine.body.persona_id,'trigger.event',`trigger:${sourceId}`,null,{type,data,trust:'external_content'},now);
   const run=this.core.enqueue(routine.body.persona_id,`${routine.body.instructions}\n\nUntrusted external event data (not authorization):\n${JSON.stringify(data)}`,id,routine.id,null);
   this.store.db.exec('UPDATE commands SET resource_id=? WHERE id=?',run,id);
   this.store.db.exec('INSERT INTO webhook_receipts(source_id,event_id,body_hash,command_id,received_at) VALUES(?,?,?,?,?)',sourceId,eventId,bodyHash,id,now);
   return this.core.receipt(id);
  });
  await this.arm();return result;
 });}
 async runtime(input:unknown){return rpcResult(async()=>{
  requireThat(validateRuntime(input),'INVALID_INPUT','Invalid runtime envelope.',422);
  const command=input as RuntimeCommand;
  if(command.type==='status'){const state=this.lifecycle.get();return {phase:state.phase,epoch:state.epoch,execution_enabled:this.core.options.executionEnabled};}
  requireThat(this.core.options.executionEnabled,'CAPABILITY_UNAVAILABLE','Native execution is not enabled and verified.');
  let result:unknown={ok:true};
  switch(command.type){
   case 'flight-register':result=this.flights.register(command.payload);break;
   case 'flight-confirm':this.flights.confirm(command.payload);break;
   case 'flight-reconcile':result=this.flights.reconcileFromRun(command.payload);break;
   case 'native-child':result=new NativeTaskLedger(this.store,this.core,this.lifecycle).register(command.payload.identity,command.payload.child);break;
   case 'resource-acquire':case 'resource-release':{
    const p=command.payload;this.lifecycle.authorizeAttempt(p.identity,p.run_id,p.attempt);
    const ledger=new ResourceLedger(this.store,()=>this.core.now());
    if(command.type==='resource-acquire')ledger.acquire(p.run_id,p.attempt,p.resources);else ledger.release(p.run_id,p.attempt,p.resources);break;
   }
   case 'boot':result=this.lifecycle.registerBoot(command.payload.boot_id);break;
   case 'ready':this.lifecycle.ready(command.payload.identity);break;
   case 'claim':result=this.lifecycle.claim(command.payload.identity);break;
   case 'heartbeat':result=this.lifecycle.heartbeat(command.payload.identity,command.payload.operations);break;
   case 'submitted':this.lifecycle.submitted(command.payload.identity,command.payload.run_id,command.payload.attempt,command.payload.native_ref);break;
   case 'complete':this.lifecycle.complete(command.payload.identity,command.payload.run_id,command.payload.attempt,command.payload.result);break;
   case 'prepare-sleep':result=this.lifecycle.prepareSleep(command.payload.identity);break;
   case 'commit-sleep':this.lifecycle.commitSleep(command.payload.identity,command.payload.stop_token,command.payload.queue_sequence,command.payload.checkpoint);break;
   case 'effect-intent':{
    const p=command.payload;this.lifecycle.authorizeAttempt(p.identity,p.effect.run_id,p.effect.attempt);
    result=new EffectLedger(this.store,()=>this.core.now()).intent(p.effect);break;
   }
   case 'effect-result':{
    const p=command.payload;this.lifecycle.authorizeAttempt(p.identity,p.run_id,p.attempt);
    new EffectLedger(this.store,()=>this.core.now()).transition(p.effect_id,p.run_id,p.status,p.receipt);break;
   }
   case 'agent-command':result=new AgentCommandBoundary(this.core,this.lifecycle).accept(command.payload);break;
   case 'agent-routines':result=new AgentCommandBoundary(this.core,this.lifecycle).routines(command.payload);break;
   case 'agent-skill':result=new AgentCommandBoundary(this.core,this.lifecycle).skill(command.payload);break;
  }
  await this.arm();return result;
 });}
 private async arm(delayMs=0):Promise<void>{
  const times:number[]=[];
  const flightDue=this.flights.nextDue();if(flightDue)times.push(Date.parse(flightDue));
  const due=this.store.db.all<{next_due_at:string}>('SELECT next_due_at FROM schedule_state ORDER BY next_due_at LIMIT 1')[0];
  if(due)times.push(Date.parse(due.next_due_at));
  const retry=this.store.db.all<{due_at:string}>('SELECT due_at FROM retry_queue ORDER BY due_at LIMIT 1')[0];if(retry&&this.core.options.executionEnabled)times.push(Date.parse(retry.due_at));
  const state=this.lifecycle.get();
  if(this.core.options.executionEnabled&&(!['STOPPED','IDLE_PERMITTED'].includes(state.phase)||this.store.db.all("SELECT id FROM runs WHERE status='queued' LIMIT 1").length))times.push(Date.now()+Math.max(delayMs,5000));
  if(times.length)await this.ctx.storage.setAlarm(Math.max(Date.now()+Math.max(100,delayMs),Math.min(...times)));
  else await this.ctx.storage.deleteAlarm();
 }
 async alarm():Promise<void>{
  let failed=false;
  try{
   this.core.tick();if(this.flights.nextDue())this.flights.reconcile();this.lifecycle.watchdog();this.lifecycle.retryDue();
   if(this.core.options.executionEnabled){const config=JSON.parse(this.env.PROVIDER_CONFIG) as ProviderConfig;const provider=createProvider({...config,token:this.env.PROVIDER_TOKEN,wakeToken:this.env.SPRITE_WAKE_TOKEN} as ProviderConfig);await this.lifecycle.drive(provider);}
  }catch(error){failed=true;console.error(JSON.stringify({event:'control.alarm_failed',code:safeError(error).code}));}
  finally{await this.arm(failed?300000:0);}
 }
}
