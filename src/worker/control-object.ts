import {FlightRestoreIntegration} from '../core/flight-integration';
import connectorCatalog from '../../config/connector-catalog.json';
import { DurableObject } from 'cloudflare:workers';
import {assertBackgroundSecrets,assertBootstrapSecrets,assertWarmSecrets,bindOwnerAuth,issueBackgroundHostToken,issueBackgroundTaskToken,issueRuntimeTaskToken,issueWarmHostToken,issueWarmTaskToken,type BackgroundHostGrant,type BackgroundTaskGrant,type RuntimeGenerationAuthority,type RuntimeTaskGrant,type WarmHostGrant,type WarmTaskGrant} from './auth';
import {migrateApplication} from '../core/migrations';
import {NativeTaskLedger} from '../core/native-tasks';
import {ResourceLedger} from '../core/resources';
import { rpcResult, type RpcResult } from './rpc';
import schema from '../../DB/schema.sql';
import { Store, type Database, type SqlValue } from '../core/store';
import { ControlCore } from '../core/control';
import { SkillCatalog } from '../core/skills';
import { exportControl } from '../core/control-export';
import { reconcileBackupNotice, runScheduledBackup as runScheduledBackupCore } from '../core/scheduled-backup';
import { TimelineRetention } from '../core/timeline-retention';
import { ResultRetention } from '../core/result-retention';
import { LifecycleCore } from '../core/lifecycle';
import { parseLifecycleTimings } from '../core/lifecycle-config';
import { ProgressWatchdog, parseStuckPolicy } from '../core/progress-watchdog';
import { EffectLedger } from '../core/effects';
import { RootChildEffects } from '../core/root-child-effects';
import { TaskSteering } from '../core/task-steering';
import { OutputPreviews } from '../core/output-preview';
import { BotMessages } from '../core/bot-messages';
import { BrowserTakeovers, validateTakeoverInput } from '../core/browser-takeover';
import { TokenUsageSnapshots } from '../core/token-usage';
import { MeteringLedger, meteringSummary, parseMeteringRates } from '../core/metering';
import { MemoryReadRetention } from '../core/memory-read-retention';
import { ControlError, requireThat, safeError } from '../core/errors';
import { createProvider, ProviderError, type ProviderConfig, type RuntimeRef } from '../providers';
import validateRuntime from '../generated/validate-runtime.js';
import type { RuntimeCommand } from '../core/runtime-types';
import type { RoutinePut } from '../core/types';
import {AgentCommandBoundary} from '../core/agent-commands';
import {parseWhatsAppReadPolicies,WhatsAppReadAccess} from '../core/whatsapp-access';
import {parseHostedOwnerAlpha,parseOwnerAlpha,parseOwnerAlphaSuccessor} from '../core/owner-alpha';
import {parseOwnerAlphaBootstrap,type OwnerAlphaRetirement} from '../core/owner-alpha-bootstrap';
import {parseOwnerAlphaWarm,type WarmGenerationView,type WarmManifest} from '../core/owner-alpha-warm';
import {parseOwnerAlphaBackground,type BackgroundGenerationView,type BackgroundManifest} from '../core/owner-alpha-background';
import {HostedWakeDeliveryError,parseHostedOwnerWake,sendHostedOwnerWake,type HostedOwnerWake} from './hosted-owner-wake';
import {TestCampaign,parseTestCampaignGrant} from '../core/test-campaign';
import {parseTestAuthConfig} from './test-auth';
import {parseExecutionMode,type ExecutionMode} from '../core/execution-mode';
import {NodeBridge,type NodeRequest} from '../core/node-bridge';
export type TriggerPolicy={routine_id:string;event_types:string[]};
/** Per-socket Hibernation API attachment (ARCHITECTURE_V2 A6). `cursor` is the
 * last sequence delivered to this socket; null means the socket has not
 * completed a subscribe (a gap reply also resets it to null, since a pruned
 * cursor is not a safe delivery point). `runtime` is the last mapped
 * runtime-state label sent, so a phase change can be pushed without a client
 * poll. */
type StreamAttachment={cursor:number|null;runtime:string|null};
/** A paired Mac node socket (ARCHITECTURE_V2 A9), tagged 'node'. */
type NodeAttachment={kind:'node';node_id:string};
/** Browser takeover relay sockets (docs/BROWSER_TAKEOVER.md). Tagged
 * `takeover:<id>`; `window`/`count` rate-limit viewer input per second. */
type TakeoverAttachment={kind:'takeover';role:'runtime'|'viewer';id:string;window:number;count:number};
const TAKEOVER_MAX_BINARY=1024*1024,TAKEOVER_MAX_TEXT=4096,TAKEOVER_INPUT_PER_SECOND=60;
function stringList(value:string):string[]{const parsed:unknown=JSON.parse(value);if(!Array.isArray(parsed)||!parsed.every(x=>typeof x==='string'))throw new Error('Invalid policy configuration');return parsed;}
function delegationMap(value:string):Record<string,string[]>{
 const parsed:unknown=JSON.parse(value);
 requireThat(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.entries(parsed).every(([key,targets])=>/^[0-9a-f-]{36}$/i.test(key)&&Array.isArray(targets)&&targets.length<=5&&targets.every(x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x))),'INVALID_CONFIGURATION','Invalid native delegation map.',503);
 return parsed as Record<string,string[]>;
}
/** An alarm may move earlier freely; only the alarm handler (existing=null) may move it later. */
export function shouldSetAlarm(existing:number|null,next:number):boolean{return existing===null||existing>next;}
export class PersonalControl extends DurableObject<Env> {
 private store:Store;
 private core:ControlCore;
 private lifecycle:LifecycleCore;
 private progress:ProgressWatchdog;
 private flights:FlightRestoreIntegration;
 private nodes:NodeBridge;
 private retention:TimelineRetention;
 private resultRetention:ResultRetention;
 private ownerBindingSha256:string|undefined;
 private hostedOwnerAlpha:boolean;
 private hostedWake:HostedOwnerWake|undefined;
 private executionMode:ExecutionMode|undefined;
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  const db:Database={
   all:<T>(sql:string,...values:SqlValue[])=>this.ctx.storage.sql.exec(sql,...values).toArray() as T[],
   exec:(sql:string,...values:SqlValue[])=>{this.ctx.storage.sql.exec(sql,...values);},
   transaction:<T>(fn:()=>T)=>this.ctx.storage.transactionSync(fn)
  };
  this.store=new Store(db);
  const hosted=parseHostedOwnerAlpha(env.HEHEBOT_HOSTED_OWNER_ALPHA,env);
  const successor=parseOwnerAlphaSuccessor(env.HEHEBOT_OWNER_ALPHA_SUCCESSOR);
  const bootstrap=parseOwnerAlphaBootstrap(env.HEHEBOT_OWNER_ALPHA_BOOTSTRAP);
  const warm=parseOwnerAlphaWarm(env.HEHEBOT_OWNER_ALPHA_WARM_GENERATION);
  const background=parseOwnerAlphaBackground(env.HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION);
  const testAccess=parseTestAuthConfig(env.HEHEBOT_TEST_ACCESS,env),testGrant=parseTestCampaignGrant(env.HEHEBOT_TEST_CAMPAIGN);
  requireThat(!!testAccess===!!testGrant&&(!testGrant||testAccess&&testGrant.actor_id===`test-service:${testAccess.client_id}`&&
   testGrant.expires_at===testAccess.expires_at&&bootstrap&&bootstrap.owner_id===testGrant.actor_id&&
   bootstrap.persona_id===testGrant.persona_id&&bootstrap.owner_binding_sha256===testGrant.owner_binding_sha256&&bootstrap.expires_at<=testGrant.expires_at),
   'INVALID_CONFIGURATION','Test service identity and bounded capability grant must match.',503);
  requireThat(!bootstrap||!!hosted&&bootstrap.installation_id===env.INSTALLATION_ID&&bootstrap.owner_id===(testGrant?.actor_id??env.OWNER_SUB),
   'INVALID_CONFIGURATION','Automatic owner alpha requires the authenticated hosted installation.',503);
  requireThat(!warm||!!hosted&&!bootstrap&&!successor&&!env.HEHEBOT_OWNER_ALPHA&&warm.installation_id===env.INSTALLATION_ID&&warm.owner_id===(testGrant?.actor_id??env.OWNER_SUB),
   'INVALID_CONFIGURATION','Warm owner alpha requires its own authenticated hosted installation.',503);
  requireThat(!background||!!hosted&&!bootstrap&&!successor&&!warm&&!env.HEHEBOT_OWNER_ALPHA&&background.installation_id===env.INSTALLATION_ID&&background.owner_id===(testGrant?.actor_id??env.OWNER_SUB),
   'INVALID_CONFIGURATION','Background owner alpha requires its own authenticated hosted installation.',503);
  if(bootstrap)assertBootstrapSecrets(env.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN,env.HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY,env.RUNTIME_TOKEN);
  if(warm)assertWarmSecrets(env.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN,env.HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY,env.HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY,env.RUNTIME_TOKEN);
  if(background)assertBackgroundSecrets(env.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN,env.HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY,env.HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY,env.RUNTIME_TOKEN);
  requireThat(!successor||!!hosted,'INVALID_CONFIGURATION','Owner-alpha successor requires the original hosted owner-alpha configuration.',503);
  this.hostedOwnerAlpha=!!hosted;
  // V8: explicit v2 architecture execution mode (default off; see core/execution-mode.ts).
  const executionMode=parseExecutionMode(env);
  this.executionMode=executionMode;
  this.hostedWake=parseHostedOwnerWake(env.HEHEBOT_OWNER_ALPHA_WAKE,!!hosted,env.PROVIDER_TOKEN,env.HEHEBOT_OWNER_ALPHA_WAKE_TOKEN,!!bootstrap||!!warm||!!background);
  requireThat(!(bootstrap||warm||background)||!!this.hostedWake,'INVALID_CONFIGURATION','Automatic owner alpha requires its private wake destination.',503);
  this.core=new ControlCore(this.store,{testCampaignGrant:testGrant,ownerAlphaBootstrap:bootstrap,ownerAlpha:warm||background?hosted?.policy:hosted?.policy??parseOwnerAlpha(env.HEHEBOT_OWNER_ALPHA,env),ownerAlphaWarm:warm,ownerAlphaBackground:background,ownerAlphaSuccessor:successor,executionEnabled:env.EXECUTION_ENABLED==='true'&&env.NATIVE_VERIFIED==='true'||executionMode==='v2',coordinatorInbox:executionMode==='v2',backupsConfigured:!!env.BACKUPS&&!!env.HEHEBOT_BACKUP_AGE_RECIPIENT,meteringRates:parseMeteringRates(env.HEHEBOT_METERING_RATES),whatsappReadPolicies:parseWhatsAppReadPolicies(JSON.parse(env.HEHEBOT_WHATSAPP_READ_POLICIES??'{}')),delegations:delegationMap(env.NATIVE_DELEGATIONS??'{}'),actionPolicyIds:stringList(env.ACTION_POLICY_IDS),toolPolicyIds:stringList(env.TOOL_POLICY_IDS),now:()=>new Date(),uuid:()=>crypto.randomUUID()});
  this.retention=new TimelineRetention(this.store,()=>this.core.now());
  this.resultRetention=new ResultRetention(this.store,()=>this.core.now());
  let idleMode=false;
  try{idleMode=createProvider(JSON.parse(env.PROVIDER_CONFIG) as ProviderConfig).capabilities.stopMode==='provider-idle';}catch{}
  this.lifecycle=new LifecycleCore(this.store,this.core,{idleMode,...parseLifecycleTimings(env)});
  this.progress=new ProgressWatchdog(this.store,this.core,parseStuckPolicy(env.HEHEBOT_STUCK_POLICY));
  this.nodes=new NodeBridge(this.store,this.core);
  this.flights=new FlightRestoreIntegration(this.store,this.core,this.lifecycle,{enabled:env.FLIGHT_RESTORE_VERIFIED==='true',policyId:env.FLIGHT_RESTORE_POLICY_ID??''});
  this.ctx.blockConcurrencyWhile(async()=>{try{
   if(!db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'").length)db.exec(schema.replace('PRAGMA foreign_keys = ON;',''));
   migrateApplication(db,this.core.now());
   this.ownerBindingSha256=db.transaction(()=>{
    const digest=bindOwnerAuth(db,env);
    requireThat(!hosted||hosted.ownerBindingSha256===digest,'OWNER_BINDING_MISMATCH','Hosted owner binding differs from configuration.',503);
    requireThat(!successor||successor.owner_binding_sha256===digest,'OWNER_BINDING_MISMATCH','Successor owner binding differs from authenticated custody.',503);
    requireThat(!bootstrap||bootstrap.owner_binding_sha256===digest,'OWNER_BINDING_MISMATCH','Automatic owner binding differs from authenticated custody.',503);
    requireThat(!warm||warm.owner_binding_sha256===digest,'OWNER_BINDING_MISMATCH','Warm owner binding differs from authenticated custody.',503);
    requireThat(!background||background.owner_binding_sha256===digest,'OWNER_BINDING_MISMATCH','Background owner binding differs from authenticated custody.',503);
    return digest;
   });
   this.core.options.ownerBindingSha256=this.ownerBindingSha256;
   this.flights.initialize();
   const config=JSON.parse(env.PROVIDER_CONFIG) as {ref?:RuntimeRef};
   this.lifecycle.initialize(config.ref??{});
   const savedRef=JSON.parse(this.lifecycle.get().provider_ref_json) as Record<string,unknown>;
   const desiredRef=(config.ref??{}) as unknown as Record<string,unknown>;
   requireThat(Object.keys({...savedRef,...desiredRef}).every(key=>savedRef[key]===desiredRef[key]),'PROVIDER_MIGRATION_REQUIRED','Runtime identity changed; perform an explicit stopped-state migration.',503);
   this.core.seed();
   new TestCampaign(this.core).initialize();
   const triggers=JSON.parse(env.TRIGGER_CONFIG) as Record<string,TriggerPolicy>;
   for(const [id,policy] of Object.entries(triggers)){
    const existing=db.all<{revision:number;body_json:string}>('SELECT revision,body_json FROM objects WHERE id=?',id)[0];
    if(!existing||existing.body_json!==JSON.stringify(policy))this.store.put(id,'trigger',policy,existing?.revision??0,'operator',this.core.now());
   }
  }catch(error){
   // A failed owner-binding check must leave the Durable Object fail-closed,
   // never serving half-initialized custody. Every RPC rejects with this exact
   // error. Other initialization failures keep their existing behavior.
   if(error instanceof ControlError&&error.code==='OWNER_BINDING_MISMATCH')this.initializationFailure=error;
   throw error;
  }});
 }
 private initializationFailure:ControlError|undefined;
 /** Fail closed with the exact initialization failure instead of serving a
  * half-initialized Durable Object. */
 private rpc<T>(fn:()=>T|Promise<T>):Promise<RpcResult<T>>{
  const failure=this.initializationFailure;
  if(failure)return Promise.resolve({ok:false,error:safeError(failure),status:failure.status});
  // Broadcast-on-commit (ARCHITECTURE_V2 A6): every RPC entry point funnels
  // through here, so this is the single place that notices anything a
  // request may have committed — new events or a runtime-phase change — and
  // pushes it to open stream sockets. It never affects the RPC's own result.
  return rpcResult(fn).then(result=>{this.broadcastStreamCommit();return result;});
 }
 /** GET /v1/stream (Access + same-origin already verified by the Worker):
  * upgrade to a hibernatable WebSocket. Idle/hibernated sockets cost nothing
  * here and are never independently timed; all delivery happens from
  * broadcastStreamCommit, driven by real requests and alarms. */
 async fetch(request:Request):Promise<Response>{
  const failure=this.initializationFailure;
  if(failure)return new Response(JSON.stringify({error:safeError(failure)}),{status:failure.status,headers:{'Content-Type':'application/json'}});
  const path=new URL(request.url).pathname;
  if(path==='/node/stream')return this.nodeConnect(request);
  if(path==='/v1/takeover/stream'||path==='/internal/takeover/stream')return this.takeoverUpgrade(request,path==='/internal/takeover/stream'?'runtime':'viewer');
  try{
   this.rate('stream:connect',120);
   // Auto-response answers "ping" with "pong" without waking the DO or
   // invoking webSocketMessage. Guarded for hosts/tests without the API.
   try{if(typeof WebSocketRequestResponsePair!=='undefined')this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));}catch{}
   const pair=new WebSocketPair();
   const [client,server]=Object.values(pair);
   this.ctx.acceptWebSocket(server);
   server.serializeAttachment({cursor:null,runtime:null} satisfies StreamAttachment);
   return new Response(null,{status:101,webSocket:client});
  }catch(error){
   const status=error instanceof ControlError?error.status:500;
   return new Response(JSON.stringify({error:safeError(error)}),{status,headers:{'Content-Type':'application/json'}});
  }
 }
 /** Client frames: text "ping" is normally intercepted by the auto-response
  * pair and never reaches here; the check below is defensive only. The only
  * JSON frame is `{type:"subscribe",cursor}`. Anything else is ignored, not
  * an error: an idle/misbehaving socket must not affect the request path. */
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer):Promise<void>{
  const takeover=this.takeoverAttachment(ws);
  if(takeover)return this.takeoverMessage(ws,takeover,message);
  if(typeof message!=='string'||message==='ping')return;
  const nodeAttachment=this.nodeAttachment(ws);
  if(nodeAttachment){await this.nodeMessage(ws,nodeAttachment,message);return;}
  try{
   let parsed:unknown;
   try{parsed=JSON.parse(message);}catch{return;}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||(parsed as {type?:unknown}).type!=='subscribe')return;
   const cursor=(parsed as {cursor?:unknown}).cursor??null;
   if(cursor!==null&&!(typeof cursor==='number'&&Number.isSafeInteger(cursor)&&cursor>=0))return;
   const now=this.core.now(),runtime=this.runtimeStreamState();
   if(cursor!==null){
    // Same gap logic as state()/HISTORY_GAP: a cursor at or behind the
    // retention floor, or before the oldest retained sequence, cannot be
    // resumed from safely.
    const first=this.store.db.all<{seq:number|null}>('SELECT MIN(sequence) AS seq FROM events')[0].seq;
    const floor=this.store.retentionFloor(now);
    if(cursor<floor||(first&&cursor<first-1)){
     ws.send(JSON.stringify({type:'snapshot_required'}));
     ws.send(JSON.stringify({type:'runtime',state:runtime}));
     ws.serializeAttachment({cursor:null,runtime} satisfies StreamAttachment);
     return;
    }
   }
   const attachment:StreamAttachment={cursor:cursor===null?this.store.sequence():cursor,runtime};
   if(cursor===null)ws.send(JSON.stringify({type:'events',events:[],cursor:attachment.cursor}));
   else this.deliverStreamEvents(ws,attachment,now);
   ws.send(JSON.stringify({type:'runtime',state:runtime}));
   ws.serializeAttachment(attachment);
  }catch{try{ws.close(1011,'Stream message failed.');}catch{}}
 }
 async webSocketClose(ws:WebSocket,code:number,reason:string):Promise<void>{
  try{ws.close(code,reason);}catch{}
  const takeover=this.takeoverAttachment(ws);if(takeover)this.takeoverPeerGone(ws,takeover);
 }
 async webSocketError(ws:WebSocket):Promise<void>{
  try{ws.close(1011,'Stream error.');}catch{}
  const takeover=this.takeoverAttachment(ws);if(takeover)this.takeoverPeerGone(ws,takeover);
 }
 private takeoverAttachment(ws:WebSocket):TakeoverAttachment|null{
  try{const value=ws.deserializeAttachment() as Partial<TakeoverAttachment>|null;if(value&&value.kind==='takeover')return value as TakeoverAttachment;}catch{}
  return null;
 }
 private takeoverPeers(id:string,role:'runtime'|'viewer',except?:WebSocket):WebSocket[]{
  let sockets:WebSocket[];
  try{sockets=this.ctx.getWebSockets(`takeover:${id}`);}catch{return [];}
  return sockets.filter(ws=>ws!==except&&this.takeoverAttachment(ws)?.id===id&&this.takeoverAttachment(ws)?.role===role);
 }
 private static sendQuiet(ws:WebSocket,data:string|ArrayBuffer){try{ws.send(data);}catch{}}
 /** GET /internal/takeover/stream (runtime token verified by the Worker) and
  * GET /v1/takeover/stream (owner Access + same-origin verified by the
  * Worker). The runtime side must also present the takeover's own run,
  * attempt and current generation; the viewer side only a live takeover id.
  * One viewer at a time: a newer viewer replaces the older one (4001). */
 private takeoverUpgrade(request:Request,role:'runtime'|'viewer'):Response{
  const reply=(status:number,code:string)=>new Response(JSON.stringify({error:{code}}),{status,headers:{'Content-Type':'application/json'}});
  try{
   requireThat(!this.hostedOwnerAlpha,'NOT_FOUND','Route unavailable.',404);
   requireThat(request.method==='GET'&&(request.headers.get('Upgrade')??'').toLowerCase()==='websocket','UPGRADE_REQUIRED','A WebSocket upgrade is required.',426);
   this.rate(`takeover:${role}`,role==='runtime'?120:60);
   const params=new URL(request.url).searchParams,id=params.get('takeover_id')??'';
   const takeovers=new BrowserTakeovers(this.store,this.core),record=takeovers.live(id);
   requireThat(!!record,'NOT_FOUND','This browser takeover is not open.',404);
   if(role==='runtime'){
    const identity={epoch:Number(params.get('epoch')),boot_id:params.get('boot_id')??''},attempt=Number(params.get('attempt'));
    requireThat(params.get('run_id')===record!.run_id&&attempt===record!.attempt&&identity.epoch===record!.epoch&&identity.boot_id===record!.boot_id,'FORBIDDEN','Takeover belongs to another attempt.',403);
    this.lifecycle.authorizeAttempt(identity,record!.run_id,attempt);
   }
   const pair=new WebSocketPair();
   const [client,server]=Object.values(pair);
   this.ctx.acceptWebSocket(server,[`takeover:${id}`]);
   server.serializeAttachment({kind:'takeover',role,id,window:0,count:0} satisfies TakeoverAttachment);
   for(const old of this.takeoverPeers(id,role,server)){try{old.close(4001,role==='viewer'?'Opened in another window.':'Runtime reconnected.');}catch{}}
   const runtimeUp=this.takeoverPeers(id,'runtime').length>0;
   if(role==='viewer'){
    PersonalControl.sendQuiet(server,JSON.stringify({t:'peer',runtime:runtimeUp,reason:record!.reason,expires_at:record!.expires_at}));
    for(const peer of this.takeoverPeers(id,'runtime'))PersonalControl.sendQuiet(peer,JSON.stringify({t:'viewer',connected:true}));
   }else{
    const viewers=this.takeoverPeers(id,'viewer');
    PersonalControl.sendQuiet(server,JSON.stringify({t:'viewer',connected:viewers.length>0}));
    for(const viewer of viewers)PersonalControl.sendQuiet(viewer,JSON.stringify({t:'peer',runtime:true}));
   }
   return new Response(null,{status:101,webSocket:client});
  }catch(error){
   const status=error instanceof ControlError?error.status:500;
   return reply(status,safeError(error).code);
  }
 }
 /** Pipes one frame. Runtime frames (JPEG binary, small JSON meta/end) go to
  * the viewer; viewer frames must be valid input events, are rate-limited and
  * go to the runtime re-serialized (never forwarded verbatim). */
 private takeoverMessage(ws:WebSocket,att:TakeoverAttachment,message:string|ArrayBuffer):void{
  try{
   if(message==='ping')return;
   if(att.role==='runtime'){
    if(typeof message==='string'){
     if(message.length>TAKEOVER_MAX_TEXT)return;
     let frame:unknown;try{frame=JSON.parse(message);}catch{return;}
     const t=(frame as {t?:unknown})?.t;
     if(!['meta','status','end'].includes(t as string))return;
     for(const viewer of this.takeoverPeers(att.id,'viewer'))PersonalControl.sendQuiet(viewer,message);
    }else{
     if(message.byteLength>TAKEOVER_MAX_BINARY)return;
     for(const viewer of this.takeoverPeers(att.id,'viewer'))PersonalControl.sendQuiet(viewer,message);
    }
    return;
   }
   if(typeof message!=='string')return;
   const second=Math.floor(Date.now()/1000);
   if(att.window!==second){att.window=second;att.count=0;}
   if(++att.count>TAKEOVER_INPUT_PER_SECOND){ws.serializeAttachment(att);return;}
   ws.serializeAttachment(att);
   const input=validateTakeoverInput(message);
   if(!input){PersonalControl.sendQuiet(ws,JSON.stringify({t:'error',code:'INVALID_INPUT'}));return;}
   const runtimes=this.takeoverPeers(att.id,'runtime');
   if(!runtimes.length){PersonalControl.sendQuiet(ws,JSON.stringify({t:'peer',runtime:false}));return;}
   for(const peer of runtimes)PersonalControl.sendQuiet(peer,JSON.stringify(input));
  }catch{try{ws.close(1011,'Takeover relay failed.');}catch{}}
 }
 private takeoverPeerGone(ws:WebSocket,att:TakeoverAttachment):void{
  if(att.role==='runtime'){for(const viewer of this.takeoverPeers(att.id,'viewer'))PersonalControl.sendQuiet(viewer,JSON.stringify({t:'peer',runtime:false}));}
  else if(!this.takeoverPeers(att.id,'viewer',ws).length){for(const peer of this.takeoverPeers(att.id,'runtime'))PersonalControl.sendQuiet(peer,JSON.stringify({t:'viewer',connected:false}));}
 }
 private closeTakeover(id:string):void{
  let sockets:WebSocket[];
  try{sockets=this.ctx.getWebSockets(`takeover:${id}`);}catch{return;}
  for(const ws of sockets){if(this.takeoverAttachment(ws)?.id===id){try{ws.close(1000,'Takeover ended.');}catch{}}}
 }
 /** Maps lifecycle phases to the client-facing runtime label (ARCHITECTURE_V2 A6). */
 private runtimeStreamState():'asleep'|'waking'|'running'|'recovery_required'{
  const phase=this.lifecycle.get().phase;
  if(phase==='RECOVERY_REQUIRED')return 'recovery_required';
  if(phase==='START_REQUESTED'||phase==='BOOTING')return 'waking';
  if(phase==='READY'||phase==='DRAINING')return 'running';
  return 'asleep'; // STOPPED, IDLE_PERMITTED, STOP_COMMITTED, STOPPING
 }
 private streamAttachment(ws:WebSocket):StreamAttachment{
  try{const value=ws.deserializeAttachment();if(value&&typeof value==='object')return value as StreamAttachment;}catch{}
  return {cursor:null,runtime:null};
 }
 /** Sends owner-visible events after the attachment's cursor, ≤100 per frame,
  * serialized exactly like the per-conversation timeline endpoint (same
  * TimelineEvent rows, via the same Store method family). */
 private deliverStreamEvents(ws:WebSocket,attachment:StreamAttachment,now:string):void{
  while(attachment.cursor!==null){
   const page=this.store.events(attachment.cursor,100,now);
   if(!page.length)break;
   ws.send(JSON.stringify({type:'events',events:page,cursor:page.at(-1)!.sequence}));
   attachment.cursor=page.at(-1)!.sequence;
   if(page.length<100)break;
  }
 }
 /** Broadcast-on-commit: called after every RPC and after every alarm. Must
  * never throw into the request/alarm path — every layer is caught. A
  * hibernated socket with nothing new costs one attachment read and no I/O. */
 private broadcastStreamCommit():void{
  let sockets:WebSocket[];
  try{sockets=this.ctx.getWebSockets();}catch{return;}
  if(!sockets.length)return;
  let now:string,after:number,runtime:'asleep'|'waking'|'running'|'recovery_required';
  try{now=this.core.now();after=this.store.sequence();runtime=this.runtimeStreamState();}catch{return;}
  for(const ws of sockets){
   if(this.nodeAttachment(ws))continue;
   try{
    if(this.takeoverAttachment(ws))continue;
    const attachment=this.streamAttachment(ws);
    let changed=false;
    if(attachment.cursor!==null&&after>attachment.cursor){this.deliverStreamEvents(ws,attachment,now);changed=true;}
    if(attachment.runtime!==runtime){ws.send(JSON.stringify({type:'runtime',state:runtime}));attachment.runtime=runtime;changed=true;}
    if(changed)ws.serializeAttachment(attachment);
   }catch{try{ws.close(1011,'Stream delivery failed.');}catch{}}
  }
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
 private async beforeRequest(subject:string,limit:number){
  this.rate(subject,limit);
  // Recover missed scheduling/watchdog alarms without making a provider call on ingress.
  try{this.reconcile();}finally{await this.arm();}
 }
 private reconcile(){
  // A retained owner-alpha generation must remain byte-for-byte historical.
  // Its bounded runtime only needs lease/deadline supervision; every other
  // maintenance path can mutate state admitted before the generation cutoff.
  if(this.core.ownerAlpha.activeGeneration()){this.lifecycle.watchdog();return;}
  this.core.expireMemories();this.core.expireCommandPayloads();this.core.expireFollowups();this.core.expireQueuedContexts();this.retention.prune();this.resultRetention.prune();this.core.tick();if(this.flights.nextDue())this.flights.reconcile();this.lifecycle.watchdog();this.lifecycle.retryDue();this.core.reconcileBudget();
  new TaskSteering(this.store,()=>this.core.now()).prune();
  this.nodes.expire();this.nodes.prune();
  this.core.questions.prune();
  new OutputPreviews(this.store,()=>this.core.now()).prune();
  new TokenUsageSnapshots(this.store,()=>this.core.now()).prune();
  new MemoryReadRetention(this.store,()=>this.core.now()).prune();
  // Staleness can be detected between cron-triggered backup attempts, e.g. if
  // the trigger itself stops firing; check on every request too so the owner
  // sees BACKUP_STALE without waiting for the next scheduled run.
  reconcileBackupNotice(this.store,this.core.options.uuid,new Date(this.core.now()));
  new MeteringLedger(this.store,()=>this.core.now()).prune(new Date(Date.parse(this.core.now())-400*86400000).toISOString().slice(0,10));
 }
 /** V-Backups: nightly off-host encrypted export, invoked by the Worker's
  * scheduled() handler (Cron Trigger), never by an owner request. Does
  * nothing if BACKUPS/HEHEBOT_BACKUP_AGE_RECIPIENT are unconfigured. */
 async runScheduledBackup(){return this.rpc(async()=>{
  const result=await runScheduledBackupCore(this.store,{BACKUPS:this.env.BACKUPS,HEHEBOT_BACKUP_AGE_RECIPIENT:this.env.HEHEBOT_BACKUP_AGE_RECIPIENT},new Date(this.core.now()),this.core.options.uuid);
  await this.arm();
  return result;
 });}
 async accept(owner:string,key:string,hash:string,input:unknown){return this.rpc(async()=>{
  // Even rejected activation must leave retained predecessor history untouched.
  // Core.accept still validates the complete envelope and idempotency receipt.
  const activation=!!input&&typeof input==='object'&&'type' in input&&input.type==='owner-alpha.activate';
  if(activation)this.rate(owner+':write',60);else await this.beforeRequest(owner+':write',60);
  const result=this.core.accept(owner,key,hash,input);
  if(!activation||result.status==='applied')await this.arm();
  return result;
 });}
 submitTest(actor:string,campaignId:string,key:string){return this.rpc(async()=>{
  requireThat(this.core.options.testCampaignGrant?.campaign_id===campaignId,'FORBIDDEN','Test campaign is unavailable.',403);
  this.rate(actor+':test-write',2);
  const result=new TestCampaign(this.core).submit(actor,key);
  await this.arm();return result;
 });}
 readTest(actor:string,kind:'receipts'|'runs',id:string){return this.rpc(()=>{
  this.rate(actor+':test-read',60);
  const campaign=new TestCampaign(this.core);
  return kind==='receipts'?campaign.receipt(actor,id):campaign.run(actor,id);
 });}
 getConnectorCatalog(owner:string){return this.rpc(()=>{
  this.rate(owner+':read',120);
  requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Connector setup diagnostics are unavailable in owner-alpha sessions.');
  return {scope:'bundled-diagnostic-baseline',runtime_inventory:'unobserved',authority:'not-granted',catalog:structuredClone(connectorCatalog)};
 });}
 getReceipt(owner:string,id:string){return this.rpc(async()=>{await this.beforeRequest(owner+':read',120);return this.core.receipt(id);});}
 getReceiptByIdempotencyKey(owner:string,key:string){return this.rpc(async()=>{await this.beforeRequest(owner+':read',120);return this.core.receiptByIdempotencyKey(owner,key);});}
 getSchedulePreview(owner:string,cron:string,timezone:string){return this.rpc(()=>{this.rate(owner+':schedule-preview',30);return this.core.schedulePreview(cron,timezone);});}
 getRoutinePreflight(owner:string,id:string){return this.rpc(()=>{this.rate(owner+':schedule-preview',30);return this.core.routinePreflight(id);});}
 getSkillHistory(owner:string,id:string,before?:number,limit=10){return this.rpc(()=>{this.rate(owner+':read',120);return new SkillCatalog(this.store,()=>this.core.now(),this.core.options.uuid).history(id,before,limit);});}
 async getState(owner:string,after?:number,limit=100){return this.rpc(async()=>{await this.beforeRequest(owner+':read',120);return {...this.core.state(after,limit),provider:this.providerSummary()};});}
 getTasks(owner:string,id:string,after?:string,limit=10){return this.rpc(async()=>{await this.beforeRequest(owner+':read',120);return this.core.taskPage(id,after,limit);});}
 getRoutineTasks(owner:string,id:string,after?:string,limit=10){return this.rpc(()=>{this.rate(owner+':read',120);return this.core.routineTaskPage(id,after,limit);});}
 getRecovery(owner:string,id:string,after?:string,limit=20){return this.rpc(async()=>{await this.beforeRequest(owner+':read',120);return this.core.recoveryPage(id,after,limit);});}
 getControlExport(owner:string){return this.rpc(()=>{this.rate(owner+':export',2);return new Blob([exportControl(this.store.db,this.core.now())]).stream();});}
 getTimeline(owner:string,id:string,before?:number,after?:number){return this.rpc(async()=>{
  await this.beforeRequest(owner+':read',120);
  const object=this.store.get(id);
  requireThat(['persona','room'].includes(object.kind),'NOT_FOUND','Conversation unavailable.',404);
  const now=this.core.now();
  const prunedThrough=this.store.retentionFloor(now,id);
  // Forward pagination is the long-poll/fallback cursor for the streamed
  // timeline (ARCHITECTURE_V2 A6): a cursor at or behind the retention floor
  // cannot be resumed from, mirroring state()'s HISTORY_GAP check.
  if(after!==undefined){
   const events=this.store.conversationEventsAfter(id,after,now,100);
   return {events,after_cursor:events.at(-1)?.sequence??after,has_more:events.length===100,history_gap:after<prunedThrough,pruned_through:prunedThrough};
  }
  const events=this.store.conversationEvents(id,now,before,100);
  return {events,before_cursor:events[0]?.sequence??null,has_more:events.length===100,history_gap:prunedThrough>0,pruned_through:prunedThrough};
 });}
 private providerSummary(){
  try{const config=JSON.parse(this.env.PROVIDER_CONFIG) as ProviderConfig;const provider=createProvider({...config,token:this.env.PROVIDER_TOKEN,wakeToken:this.env.SPRITE_WAKE_TOKEN} as ProviderConfig);return {id:provider.id,capabilities:provider.capabilities,live_verified:false};}
  catch{return {id:'unconfigured',capabilities:null,live_verified:false};}
 }
 async trigger(sourceId:string,eventId:string,bodyHash:string,type:string,data:Record<string,unknown>){return this.rpc(async()=>{
  await this.beforeRequest(sourceId+':trigger',120);
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
 async ownerAlphaManager(type:string,input:unknown){return this.rpc(async()=>{
  // A warm or background generation never widens the legacy manager contract;
  // when one is configured or retained, the legacy manager route stays unavailable.
  requireThat(!this.core.options.ownerAlphaWarm&&!this.core.warm.retained()&&!this.core.options.ownerAlphaBackground&&!this.core.background.retained(),'NOT_FOUND','Route unavailable.',404);
  requireThat(this.hostedOwnerAlpha&&this.core.bootstrap.config,'CAPABILITY_UNAVAILABLE','Automatic owner alpha is not configured.');
  this.rate('owner-alpha-manager',60);
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Invalid manager request.',422);
  if(type==='manifest'){
   requireThat(Object.keys(input).length===0,'INVALID_INPUT','Manifest reads do not select work.',422);
   const manifest=this.core.bootstrap.assignedManifest(),state=this.lifecycle.get();
   if(!manifest||state.phase!=='BOOTING'||manifest.issued_at>this.core.now()||Math.floor(Date.parse(manifest.expires_at)/1000)*1000<=Date.parse(this.core.now()))return null;
   const {installation_id,owner_binding_sha256,run_id,epoch,boot_id,transition_id,manifest_sha256,issued_at,expires_at}=manifest;
   const grant:RuntimeTaskGrant={installation_id,owner_binding_sha256,run_id,epoch,boot_id,transition_id,manifest_sha256,issued_at,expires_at};
   return {grant,policy:this.core.ownerAlpha.policy!,runtime_token:await issueRuntimeTaskToken(grant,this.env.HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY!)};
  }
  requireThat(type==='retirement','NOT_FOUND','Manager route unavailable.',404);
  this.core.bootstrap.recordRetirement(input as OwnerAlphaRetirement);
  return {accepted:true};
 });}
 async runtime(input:unknown,authority?:RuntimeGenerationAuthority|RuntimeTaskGrant){return this.rpc(async()=>{
  requireThat(validateRuntime(input),'INVALID_INPUT','Invalid runtime envelope.',422);
  const command=input as RuntimeCommand;
  const generation=this.core.ownerAlpha.activeGeneration();
  // Warm and background generations are reachable only through their versioned
  // routes; legacy runtime credentials never become a bypass into them.
  requireThat(!this.core.options.ownerAlphaWarm&&!this.core.options.ownerAlphaBackground&&
   !(generation&&'kind' in generation.authority&&(generation.authority.kind==='owner-message-warm-generation'||generation.authority.kind==='owner-message-background-generation')),
   'NOT_FOUND','Route unavailable.',404);
  if(this.core.bootstrap.config||generation&&'kind' in generation.authority){
   const manifest=this.core.bootstrap.assignedManifest();
   requireThat(this.core.bootstrap.config&&manifest&&authority&&'manifest_sha256' in authority&&
    authority.installation_id===manifest.installation_id&&authority.owner_binding_sha256===this.ownerBindingSha256&&
    authority.run_id===manifest.run_id&&authority.manifest_sha256===manifest.manifest_sha256&&
    authority.issued_at===manifest.issued_at&&authority.expires_at===manifest.expires_at&&manifest.expires_at>this.core.now(),
    'STALE_EPOCH','Task credential is not bound to the active assignment.',409);
   if('run_id' in command.payload)requireThat(command.payload.run_id===manifest.run_id,'FORBIDDEN','Task credential cannot address another run.',403);
  }
  if(this.hostedOwnerAlpha&&(generation||authority)){
   requireThat(!!generation&&!!authority&&authority.epoch===generation.epoch&&authority.boot_id===generation.boot_id.toLowerCase()&&authority.transition_id===generation.transition_id.toLowerCase(),
    'STALE_EPOCH','Runtime credential is not bound to the active generation.',409);
   const state=this.lifecycle.get();
   requireThat(state.epoch===generation.epoch&&(!state.boot_id||state.boot_id.toLowerCase()===generation.boot_id.toLowerCase()),'STALE_EPOCH','Runtime generation is no longer active.',409);
   if(command.type==='boot')requireThat(command.payload.boot_id.toLowerCase()===generation.boot_id.toLowerCase(),'STALE_EPOCH','Runtime boot identity is not authorized.',409);
   else if(command.type!=='status'){
    const identity=(command.payload as {identity?:{epoch?:number;boot_id?:string}}).identity;
    requireThat(identity?.epoch===generation.epoch&&identity.boot_id?.toLowerCase()===generation.boot_id.toLowerCase(),'STALE_EPOCH','Runtime payload is not bound to the active generation.',409);
   }
  }
  const alpha=this.core.ownerAlpha.policy;
  if(command.type==='status')return this.statusSummary();
  return this.execute(command,!!alpha&&(['boot','ready','claim','heartbeat','submitted','coordinator-release','output-preview','bot-message','pass-turn','token-usage','metering','steer-pending','agent-routines','agent-skill','agent-task-list','agent-task-detail'].includes(command.type)||!!(alpha.text_only&&command.type==='complete')||!!(alpha.background_first_root&&command.type==='native-child')));
 });}
 private statusSummary(){
  const state=this.lifecycle.get(),alpha=this.core.ownerAlpha.policy,generation=this.core.ownerAlpha.activeGeneration();
  const warm=!!generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation';
  const background=!!generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation';
  return {phase:state.phase,epoch:state.epoch,execution_enabled:this.core.options.executionEnabled,...(this.executionMode?{execution_mode:this.executionMode}:{}),...(alpha?{owner_alpha:alpha}:{}),
   ...(generation?background?{owner_alpha_background_generation:{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id}}:warm?{owner_alpha_warm_generation:{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id}}:{owner_alpha_generation:{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id}}:{}),
   ...(this.hostedOwnerAlpha?{owner_alpha_hosted:true}:{}),...(this.ownerBindingSha256?{owner_binding_sha256:this.ownerBindingSha256}:{})};
 }
 private async execute(command:RuntimeCommand,allowed:boolean):Promise<unknown>{
  requireThat(this.core.options.executionEnabled||allowed,'CAPABILITY_UNAVAILABLE','Native execution is not enabled and verified for this operation.');
  if(command.type==='whatsapp-read-authorize')return new WhatsAppReadAccess(this.core,this.lifecycle).authorize(command.payload);
  let result:unknown={ok:true};
  switch(command.type){
   case 'token-usage':{
    const {identity,...snapshot}=command.payload;
    try{
     new TokenUsageSnapshots(this.store,()=>this.core.now()).record(identity,snapshot,this.lifecycle);
     result={accepted:true};
    }catch(error){
     if(!(error instanceof ControlError)||error.code!=='USAGE_FENCED')throw error;
     result={accepted:false,reason:'USAGE_FENCED'};
    }
    break;
   }
   case 'metering':{
    const {identity,...report}=command.payload;
    try{
     new MeteringLedger(this.store,()=>this.core.now()).record(identity,report,this.lifecycle);
     result={accepted:true};
    }catch(error){
     if(!(error instanceof ControlError)||error.code!=='STALE_EPOCH')throw error;
     result={accepted:false,reason:'STALE_EPOCH'};
    }
    break;
   }
   case 'question-record':{
    const p=command.payload;result={id:this.core.questions.record(p.identity,p.run_id,p.attempt,p.question)};break;
   }
   case 'question-take':{
    const p=command.payload;
    result=this.store.db.transaction(()=>{
     const answer=this.core.questions.takeAnswer(p.identity,p.question_id,p.connection_id);
     return {state:this.core.questions.get(p.question_id).state,answer};
    });break;
   }
   case 'question-resolve':{
    const p=command.payload;this.core.questions.resolve(p.identity,p.question_id,p.connection_id);break;
   }
   case 'output-preview':{
    const {identity,...preview}=command.payload;
    try {
     new OutputPreviews(this.store,()=>this.core.now()).record(identity,preview,this.lifecycle);
     result={accepted:true};
    } catch(error) {
     if(!(error instanceof ControlError)||error.code!=='OUTPUT_FENCED')throw error;
     result={accepted:false,reason:'OUTPUT_FENCED'};
    }
    break;
   }
   case 'bot-message':{
    const {identity,...message}=command.payload;
    result=new BotMessages(this.store,()=>this.core.now(),()=>crypto.randomUUID()).post(identity,message,this.lifecycle);
    break;
   }
   case 'pass-turn':{
    const {identity,...input}=command.payload;
    result=this.core.roomTurns.pass(identity,input,this.lifecycle);
    break;
   }
   case 'steer-pending':{
    const p=command.payload;result=new TaskSteering(this.store,()=>this.core.now()).pending(p.identity,p.targets,this.lifecycle);break;
   }
   case 'steer-result':{
    const p=command.payload;new TaskSteering(this.store,()=>this.core.now()).result(p.identity,p,p.command_id,p.status,this.lifecycle);break;
   }
   case 'budget-report':{
    this.store.db.transaction(()=>{
     const p=command.payload;this.lifecycle.authorizeAttempt(p.identity,p.run_id,p.attempt);
     this.core.budget.report(p.report);this.core.reconcileBudget();
    });break;
   }
   case 'flight-register':result=this.flights.register(command.payload);break;
   case 'flight-confirm':this.flights.confirm(command.payload);break;
   case 'flight-reconcile':result=this.flights.reconcileFromRun(command.payload);break;
   case 'native-child':result=new NativeTaskLedger(this.store,this.core,this.lifecycle).register(command.payload.identity,command.payload.child,command.payload.started);break;
   case 'resource-acquire':case 'resource-release':{
    const p=command.payload;this.lifecycle.authorizeAttempt(p.identity,p.run_id,p.attempt);
    const ledger=new ResourceLedger(this.store,()=>this.core.now());
    if(command.type==='resource-acquire')ledger.acquire(p.run_id,p.attempt,p.resources);else ledger.release(p.run_id,p.attempt,p.resources);break;
   }
   case 'boot':result=this.lifecycle.registerBoot(command.payload.boot_id);break;
   case 'ready':this.lifecycle.ready(command.payload.identity);break;
   case 'memory-prepare':result=this.lifecycle.prepareMemory(command.payload.identity,command.payload.persona_models,command.payload.memory_read_personas);break;
   case 'claim':result=this.lifecycle.claim(command.payload.identity,command.payload.persona_models,command.payload.memory_budget,command.payload.memory_read_personas,command.payload.lane,command.payload.memory_notice);break;
   case 'abandon':this.lifecycle.abandon(command.payload.identity,command.payload.code);break;
   case 'browser-takeover':{
    const p=command.payload,takeovers=new BrowserTakeovers(this.store,this.core);
    requireThat(!this.hostedOwnerAlpha,'NOT_FOUND','Route unavailable.',404);
    if(p.action==='open')result=takeovers.open(p.identity,p,this.lifecycle);
    else{result=takeovers.end(p.identity,p,this.lifecycle);this.closeTakeover(p.takeover_id);}
    break;
   }
   case 'progress':this.progress.record(command.payload.identity,command.payload.run_id,command.payload.attempt,command.payload.source,this.lifecycle);break;
   case 'heartbeat':result=this.lifecycle.heartbeat(command.payload.identity,command.payload.operations);break;
   case 'submitted':this.lifecycle.submitted(command.payload.identity,command.payload.run_id,command.payload.attempt,command.payload.native_ref);break;
   case 'coordinator-release':{
    const p=command.payload;this.lifecycle.coordinatorRelease(p.identity,p.run_id,p.attempt,p.native_ref,p.outcome);result={};break;
   }
   case 'complete':this.lifecycle.complete(command.payload.identity,command.payload.run_id,command.payload.attempt,command.payload.result,command.payload.text_only_receipt,command.payload.background_receipt);break;
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
   case 'root-child-effect-intent':result=new RootChildEffects(this.store,this.core,this.lifecycle).intent(command.payload);break;
   case 'root-child-effect-result':new RootChildEffects(this.store,this.core,this.lifecycle).transition(command.payload);break;
   case 'agent-command':result=new AgentCommandBoundary(this.core,this.lifecycle).accept(command.payload);break;
   case 'agent-routines':result=new AgentCommandBoundary(this.core,this.lifecycle).routines(command.payload);break;
   case 'agent-skill':result=new AgentCommandBoundary(this.core,this.lifecycle).skill(command.payload);break;
   case 'agent-skill-search':result=new AgentCommandBoundary(this.core,this.lifecycle).searchSkills(command.payload);break;
   case 'agent-task-list':result=new AgentCommandBoundary(this.core,this.lifecycle).taskList(command.payload);break;
   case 'agent-task-detail':result=new AgentCommandBoundary(this.core,this.lifecycle).taskDetail(command.payload);break;
   case 'memory-read-prepare':result=new AgentCommandBoundary(this.core,this.lifecycle).prepareMemoryRead(command.payload);break;
   case 'memory-read-reserve':result=new AgentCommandBoundary(this.core,this.lifecycle).reserveMemoryRead(command.payload);break;
   case 'node-request':{
    const {identity,...input}=command.payload;
    const queued=this.nodes.enqueue(identity,input,this.lifecycle);
    this.deliverNodeRequests(false);
    result={...queued,status:this.nodes.request(queued.request_id)?.status??queued.status,node_online:this.nodeOnline()};break;
   }
   case 'node-result':{
    const {identity,...input}=command.payload;
    result={...this.nodes.poll(identity,input,this.lifecycle),node_online:this.nodeOnline()};break;
   }
  }
  await this.arm();return result;
 }
 /** Whether a warm generation is retained in this Durable Object's custody. */
 warmRetained():Promise<RpcResult<boolean>>{return this.rpc(()=>this.core.warm.retained());}
 /** Manager-only warm endpoints: the launch envelope exists only while the
  * generation is BOOTING and live; a READY or retired generation never yields a
  * second launch envelope. Retirement is manager-authenticated, valid after the
  * generation expiry, idempotent, and settles nothing by itself. */
 async warmManager(type:string,input:unknown){return this.rpc(async()=>{
  requireThat(type==='generation'||type==='retirement','NOT_FOUND','Manager route unavailable.',404);
  if(type==='retirement'){
   // Retirement of a retained warm generation stays available after its
   // configuration was removed; persisted custody remains reconstructible.
   requireThat(this.core.warm.retained(),'CAPABILITY_UNAVAILABLE','Warm generation retirement is unavailable.');
   this.rate('owner-alpha-warm-manager',60);
   requireThat(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Invalid manager request.',422);
   this.core.warm.recordRetirement(input as OwnerAlphaRetirement);
   return {accepted:true};
  }
  requireThat(this.core.options.ownerAlphaWarm,'CAPABILITY_UNAVAILABLE','Warm owner alpha is not configured.');
  this.rate('owner-alpha-warm-manager',60);
  requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0,'INVALID_INPUT','Generation reads do not select work.',422);
  const generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView|undefined;
  const state=this.lifecycle.get(),now=this.core.now();
  if(!generation||!('kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation')||state.epoch!==generation.epoch||state.boot_id!==generation.boot_id||
   state.phase!=='BOOTING'||Date.parse(generation.policy.expires_at)<=Date.parse(now))return null;
  const warm=this.core.options.ownerAlphaWarm!;
  // The host credential is deterministic: issued_at is frozen at the
  // generation's first admission (its activation) so repeated launch reads at
  // different times produce the identical credential and zero writes.
  const grant:WarmHostGrant={installation_id:warm.installation_id,epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,
   generation_sha256:generation.authority.generation_sha256,issued_at:generation.authority.admissions[0].issued_at,expires_at:generation.policy.expires_at};
  return {schema_version:1,kind:'owner-alpha-warm-launch-v1',
   generation:{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,session_id:generation.policy.session_id,
    generation_sha256:generation.authority.generation_sha256,
    policy:{persona_id:generation.policy.persona_id,expires_at:generation.policy.expires_at,max_runs:generation.policy.max_runs,max_task_seconds:generation.policy.max_task_seconds,text_only:generation.policy.text_only},
    predecessor:{epoch:generation.predecessor.epoch,boot_id:generation.predecessor.boot_id,session_id:generation.predecessor.session_id}},
   host_credential:{grant,token:await issueWarmHostToken(grant,this.env.HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY!)}};
 });}
 /** Versioned warm host/task routes. Host authority is bound to the immutable
  * generation digest and reaches only the host allowlist; task authority is
  * separately signed and reaches only model-facing task reads. Crossed or
  * expired credentials, foreign run IDs and nested child/operation targets are
  * denied. Legacy credentials never reach these routes. */
 async warmRuntime(type:string,input:unknown,authority:WarmHostGrant|WarmTaskGrant,mode:'host'|'task'){return this.rpc(async()=>{
  requireThat(validateRuntime({type,payload:input}),'INVALID_INPUT','Invalid runtime envelope.',422);
  const command={type,payload:input} as RuntimeCommand;
  const generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView|undefined;
  requireThat(generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation','STALE_EPOCH','Warm generation is not active.',409);
  const state=this.lifecycle.get();
  requireThat(state.epoch===generation.epoch&&state.boot_id===generation.boot_id&&!['STOPPED','RECOVERY_REQUIRED'].includes(state.phase),'STALE_EPOCH','Warm generation is no longer live.',409);
  requireThat(authority.epoch===generation.epoch&&authority.boot_id.toLowerCase()===generation.boot_id&&
   authority.transition_id.toLowerCase()===generation.transition_id&&authority.generation_sha256===generation.authority.generation_sha256,
   'STALE_EPOCH','Credential is not bound to the active warm generation.',409);
  const manifestFor=(runId:string):WarmManifest|undefined=>generation.authority.admissions.find(item=>item.run_id===runId);
  if(mode==='task'){
   requireThat(type==='agent-routines'||type==='agent-skill'||type==='bot-message'||type==='pass-turn','FORBIDDEN','Warm task credential cannot reach this route.',403);
   const task=authority as WarmTaskGrant;
   const p=command.payload as {identity?:{epoch?:number;boot_id?:string};run_id?:unknown;attempt?:unknown};
   requireThat(p.identity?.epoch===generation.epoch&&p.identity.boot_id?.toLowerCase()===generation.boot_id,'STALE_EPOCH','Runtime payload is not bound to the active generation.',409);
   requireThat(p.run_id===task.run_id&&p.attempt===1,'FORBIDDEN','Task credential cannot address another run.',403);
   requireThat(manifestFor(task.run_id)?.manifest_sha256===task.manifest_sha256,'STALE_EPOCH','Task credential is not bound to an admitted manifest.',409);
   return this.execute(command,true);
  }
  requireThat(['boot','ready','claim','heartbeat','submitted','coordinator-release','complete','status','output-preview','bot-message','pass-turn','token-usage','steer-pending'].includes(type),
   'FORBIDDEN','Warm host credential cannot reach this route.',403);
  if(type==='boot'){
   requireThat(state.phase==='BOOTING','STALE_EPOCH','No boot is expected.',409);
   requireThat(command.payload&&typeof command.payload==='object'&&!Array.isArray(command.payload)&&Object.keys(command.payload).join(',')==='boot_id'&&
    (command.payload as {boot_id:unknown}).boot_id===generation.boot_id,'STALE_EPOCH','Runtime boot identity is not authorized.',409);
  }else if(type!=='status'){
   const identity=(command.payload as {identity?:{epoch?:number;boot_id?:string}}).identity;
   requireThat(identity?.epoch===generation.epoch&&identity.boot_id?.toLowerCase()===generation.boot_id,'STALE_EPOCH','Runtime payload is not bound to the active generation.',409);
   if(type==='claim'){
    // A claim in the frozen deadline's final partial second is rejected before
    // any claim or attempt mutation: the task credential's exp is the persisted
    // deadline, never a fresh claim-time window.
    const next=this.lifecycle.nextClaimableRun();
    if(next){
     const pending=manifestFor(next.id);
     requireThat(pending&&Date.parse(pending.expires_at)-Date.parse(this.core.now())>=1000,
      'CAPABILITY_UNAVAILABLE','Less than one second remains for the warm task.',409);
    }
    const claimed=await this.execute(command,true) as {run:{id:string;current_attempt:number};submission_key:string;deadline_at:string}|null;
    if(!claimed)return null;
    const m=manifestFor(claimed.run.id);
    requireThat(m,'STALE_EPOCH','Claimed run is not admitted by this warm generation.',409);
    const attempt=this.store.db.all<{started_at:string;attempt:number}>('SELECT started_at,attempt FROM attempts WHERE run_id=? AND attempt=?',m.run_id,claimed.run.current_attempt)[0];
    requireThat(attempt&&attempt.attempt===1,'STALE_EPOCH','Claimed attempt is not the admitted warm attempt.',409);
    const grant:WarmTaskGrant={installation_id:m.installation_id,owner_binding_sha256:m.owner_binding_sha256,run_id:m.run_id,attempt:1,
     manifest_sha256:m.manifest_sha256,epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,
     generation_sha256:generation.authority.generation_sha256,issued_at:attempt.started_at,expires_at:m.expires_at};
    return {schema_version:1,kind:'owner-alpha-warm-claim-v1',run:claimed.run,submission_key:claimed.submission_key,deadline_at:m.expires_at,
     text_only:m.text_only,manifest:m,task_credential:{grant,token:await issueWarmTaskToken(grant,this.env.HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY!)}};
   }
   // Every run reference in the payload — top level, heartbeat operations and
   // steering targets — must be an admitted run at its admitted attempt.
   const admitted=new Set(generation.authority.admissions.map(m=>m.run_id));
   const check=(runId:unknown,attempt:unknown)=>requireThat(runId&&typeof runId==='string'&&admitted.has(runId)&&attempt===1,
    'FORBIDDEN','Host credential cannot address another run.',403);
   const p=command.payload as {run_id?:unknown;attempt?:unknown;operations?:{run_id:unknown;attempt:unknown}[];targets?:{run_id:unknown;attempt:unknown}[]};
   if('run_id' in p)check(p.run_id,p.attempt);
   for(const op of p.operations??[])check(op.run_id,op.attempt);
   for(const target of p.targets??[])check(target.run_id,target.attempt);
  }
  if(type==='status')return this.statusSummary();
  return this.execute(command,true);
 });}
 /** Whether a background generation is retained in this Durable Object's custody. */
 backgroundRetained():Promise<RpcResult<boolean>>{return this.rpc(()=>this.core.background.retained());}
 /** Manager-only background endpoints: the launch envelope exists only while
  * the generation is BOOTING and live; repeated reads produce identical bytes
  * with zero writes. Retirement is manager-authenticated, valid after the
  * generation expiry, idempotent, and settles nothing by itself. */
 async backgroundManager(type:string,input:unknown){return this.rpc(async()=>{
  requireThat(type==='generation'||type==='retirement','NOT_FOUND','Manager route unavailable.',404);
  if(type==='retirement'){
   // Retirement of a retained background generation stays available after its
   // configuration was removed; persisted custody remains reconstructible.
   requireThat(this.core.background.retained(),'CAPABILITY_UNAVAILABLE','Background generation retirement is unavailable.');
   this.rate('owner-alpha-background-manager',60);
   requireThat(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Invalid manager request.',422);
   this.core.background.recordRetirement(input as OwnerAlphaRetirement);
   return {accepted:true};
  }
  requireThat(this.core.options.ownerAlphaBackground,'CAPABILITY_UNAVAILABLE','Background owner alpha is not configured.');
  this.rate('owner-alpha-background-manager',60);
  requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0,'INVALID_INPUT','Generation reads do not select work.',422);
  const generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView|undefined;
  const state=this.lifecycle.get(),now=this.core.now();
  if(!generation||!('kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation')||state.epoch!==generation.epoch||state.boot_id!==generation.boot_id||
   state.phase!=='BOOTING'||Date.parse(generation.policy.expires_at)<=Date.parse(now)||state.lease_until===null||Date.parse(state.lease_until)<=Date.parse(now))return null;
  const background=this.core.options.ownerAlphaBackground!;
  // The host credential is deterministic: issued_at is frozen at the
  // generation's first admission so repeated launch reads at different times
  // produce the identical credential and zero writes.
  const grant:BackgroundHostGrant={installation_id:background.installation_id,epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,
   generation_sha256:generation.authority.generation_sha256,issued_at:generation.authority.admissions[0].issued_at,expires_at:generation.policy.expires_at};
  return {schema_version:1,kind:'owner-alpha-background-launch-v1',
   generation:{epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,session_id:generation.policy.session_id,
    generation_sha256:generation.authority.generation_sha256,
    policy:{persona_id:generation.policy.persona_id,expires_at:generation.policy.expires_at,max_runs:generation.policy.max_runs,max_task_seconds:generation.policy.max_task_seconds,background:generation.policy.background},
    predecessor:{epoch:generation.predecessor.epoch,boot_id:generation.predecessor.boot_id,session_id:generation.predecessor.session_id}},
   host_credential:{grant,token:await issueBackgroundHostToken(grant,this.env.HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY!)}};
 });}
 /** Versioned background host/task routes. Host authority is bound to the
  * immutable generation digest and reaches only the host allowlist; task
  * authority is separately signed and reaches only model-facing task reads.
  * Host payloads may target the admitted roots or A's registered direct
  * descendants at attempt 1; nested or foreign targets are denied. Mutations
  * and effects are default-denied: any type not on the allowlists is denied. */
 async backgroundRuntime(type:string,input:unknown,authority:BackgroundHostGrant|BackgroundTaskGrant,mode:'host'|'task'){return this.rpc(async()=>{
  requireThat(validateRuntime({type,payload:input}),'INVALID_INPUT','Invalid runtime envelope.',422);
  const command={type,payload:input} as RuntimeCommand;
  const generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView|undefined;
  requireThat(generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation','STALE_EPOCH','Background generation is not active.',409);
  const state=this.lifecycle.get();
  requireThat(state.epoch===generation.epoch&&state.boot_id===generation.boot_id&&!['STOPPED','RECOVERY_REQUIRED'].includes(state.phase),'STALE_EPOCH','Background generation is no longer live.',409);
  requireThat(authority.epoch===generation.epoch&&authority.boot_id.toLowerCase()===generation.boot_id&&
   authority.transition_id.toLowerCase()===generation.transition_id&&authority.generation_sha256===generation.authority.generation_sha256,
   'STALE_EPOCH','Credential is not bound to the active background generation.',409);
  const manifestFor=(runId:string):BackgroundManifest|undefined=>generation.authority.admissions.find(item=>item.run_id===runId);
  // The widened target set: the three admitted roots plus A's registered direct
  // descendants at attempt 1. A nested child-of-child never enters this set.
  const rootId=generation.authority.admissions.find(item=>item.role==='background')!.run_id;
  const admitted=new Set<string>([...generation.authority.admissions.map(m=>m.run_id),
   ...this.store.db.all<{run_id:string}>("SELECT n.run_id FROM native_task_links n JOIN runs r ON r.id=n.run_id WHERE n.parent_attempt=1 AND r.current_attempt=1 AND r.role='background' AND n.parent_run_id=?",rootId).map(row=>row.run_id)]);
  const check=(runId:unknown,attempt:unknown)=>requireThat(runId&&typeof runId==='string'&&admitted.has(runId)&&attempt===1,
   'FORBIDDEN','Background credential cannot address another run.',403);
  if(mode==='task'){
   requireThat(type==='agent-routines'||type==='agent-skill'||type==='bot-message'||type==='pass-turn','FORBIDDEN','Background task credential cannot reach this route.',403);
   const task=authority as BackgroundTaskGrant;
   const p=command.payload as {identity?:{epoch?:number;boot_id?:string};run_id?:unknown;attempt?:unknown};
   requireThat(p.identity?.epoch===generation.epoch&&p.identity.boot_id?.toLowerCase()===generation.boot_id,'STALE_EPOCH','Runtime payload is not bound to the active generation.',409);
   requireThat(p.run_id===task.run_id&&p.attempt===1,'FORBIDDEN','Task credential cannot address another run.',403);
   requireThat(manifestFor(task.run_id)?.manifest_sha256===task.manifest_sha256,'STALE_EPOCH','Task credential is not bound to an admitted manifest.',409);
   return this.execute(command,true);
  }
  requireThat(['boot','ready','claim','heartbeat','submitted','coordinator-release','complete','status','output-preview','bot-message','pass-turn','token-usage','steer-pending','steer-result','native-child'].includes(type),
   'FORBIDDEN','Background host credential cannot reach this route.',403);
  if(type==='boot'){
   requireThat(state.phase==='BOOTING','STALE_EPOCH','No boot is expected.',409);
   requireThat(command.payload&&typeof command.payload==='object'&&!Array.isArray(command.payload)&&Object.keys(command.payload).join(',')==='boot_id'&&
    (command.payload as {boot_id:unknown}).boot_id===generation.boot_id,'STALE_EPOCH','Runtime boot identity is not authorized.',409);
  }else if(type!=='status'){
   const identity=(command.payload as {identity?:{epoch?:number;boot_id?:string}}).identity;
   requireThat(identity?.epoch===generation.epoch&&identity.boot_id?.toLowerCase()===generation.boot_id,'STALE_EPOCH','Runtime payload is not bound to the active generation.',409);
   if(type==='claim'){
    // A claim in the frozen deadline's final partial second is rejected before
    // any claim or attempt mutation.
    const next=this.lifecycle.nextClaimableRun();
    if(next){
     const pending=manifestFor(next.id);
     if(pending)requireThat(Date.parse(pending.expires_at)-Date.parse(this.core.now())>=1000,
      'CAPABILITY_UNAVAILABLE','Less than one second remains for the background task.',409);
     else{
      const row=this.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=1',next.id)[0];
      requireThat(row&&Date.parse(row.deadline_at)-Date.parse(this.core.now())>=1000,
       'CAPABILITY_UNAVAILABLE','Less than one second remains for the background task.',409);
     }
    }
    const claimed=await this.execute(command,true) as {run:{id:string;current_attempt:number};submission_key:string;deadline_at:string}|null;
    if(!claimed)return null;
    const m=manifestFor(claimed.run.id);
    requireThat(m,'STALE_EPOCH','Claimed run is not admitted by this background generation.',409);
    const attempt=this.store.db.all<{started_at:string;attempt:number}>('SELECT started_at,attempt FROM attempts WHERE run_id=? AND attempt=?',m.run_id,claimed.run.current_attempt)[0];
    requireThat(attempt&&attempt.attempt===1,'STALE_EPOCH','Claimed attempt is not the admitted background attempt.',409);
    const grant:BackgroundTaskGrant={installation_id:m.installation_id,owner_binding_sha256:m.owner_binding_sha256,run_id:m.run_id,attempt:1,
     manifest_sha256:m.manifest_sha256,epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,
     generation_sha256:generation.authority.generation_sha256,issued_at:attempt.started_at,expires_at:m.expires_at};
    const envelope:{schema_version:1;kind:'owner-alpha-background-claim-v1';run:{id:string};submission_key:string;deadline_at:string;
     role:BackgroundManifest['role'];background:BackgroundManifest['background'];manifest:{admission:number;role:string;manifest_sha256:string;expires_at:string};
     task_credential:{grant:BackgroundTaskGrant;token:string};status_summary?:unknown;owner_alpha_background?:true}=
     {schema_version:1,kind:'owner-alpha-background-claim-v1',run:claimed.run,submission_key:claimed.submission_key,deadline_at:m.expires_at,
      role:m.role,background:m.background,manifest:{admission:m.admission,role:m.role,manifest_sha256:m.manifest_sha256,expires_at:m.expires_at},
      task_credential:{grant,token:await issueBackgroundTaskToken(grant,this.env.HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY!)}};
    // Only the status root receives the frozen durable summary; only the
    // background root reuses the existing V2 claim flag.
    if(m.role==='status')envelope.status_summary=this.core.background.statusSummary(generation.epoch);
    if(m.role==='background')envelope.owner_alpha_background=true;
    return envelope;
   }
   // Every run reference in the payload — top level, heartbeat operations and
   // steering targets — must be an admitted root or A's registered descendant.
   const p=command.payload as {run_id?:unknown;attempt?:unknown;operations?:{run_id:unknown;attempt:unknown}[];targets?:{run_id:unknown;attempt:unknown}[]};
   if('run_id' in p)check(p.run_id,p.attempt);
   for(const op of p.operations??[])check(op.run_id,op.attempt);
   for(const target of p.targets??[])check(target.run_id,target.attempt);
  }
  if(type==='status')return this.statusSummary();
  return this.execute(command,true);
 });}
 /** Owner (Access) routes for the Mac card: status, one-time pairing code, revoke. */
 getNodeStatus(owner:string){return this.rpc(()=>{this.rate(owner+':read',120);return this.nodes.status(this.nodeOnline());});}
 createNodePairing(owner:string){return this.rpc(()=>{this.rate(owner+':node-pair',10);return this.nodes.createPairing();});}
 revokeNode(owner:string){return this.rpc(()=>{
  this.rate(owner+':write',60);
  const sockets=this.nodeSockets();const result=this.nodes.revoke();
  for(const ws of sockets){try{ws.send(JSON.stringify({type:'revoked'}));ws.close(4001,'Node revoked.');}catch{}}
  return result;
 });}
 /** Unauthenticated-by-Access node route: the one-time code is the credential. */
 exchangeNodePairing(code:unknown,name:unknown){return this.rpc(()=>{this.rate('node:exchange',10);return this.nodes.exchange(code,name);});}
 private nodeAttachment(ws:WebSocket):NodeAttachment|undefined{
  try{const value=ws.deserializeAttachment() as NodeAttachment|null;if(value&&typeof value==='object'&&value.kind==='node'&&typeof value.node_id==='string')return value;}catch{}
  return undefined;
 }
 /** Open sockets of the currently paired node (a revoked node's sockets are closed on revoke). */
 private nodeSockets():WebSocket[]{
  const device=this.nodes.device();if(!device)return [];
  let sockets:WebSocket[];try{sockets=this.ctx.getWebSockets('node');}catch{return [];}
  return sockets.filter(ws=>this.nodeAttachment(ws)?.node_id===device.node_id);
 }
 private nodeOnline():boolean{return this.nodeSockets().length>0;}
 /** GET /node/stream: node token (Bearer) authenticates; Access service-token
  * headers are checked at the Cloudflare edge before this Worker runs. */
 private nodeConnect(request:Request):Response{
  const reply=(error:unknown)=>{const status=error instanceof ControlError?error.status:500;return new Response(JSON.stringify({error:safeError(error)}),{status,headers:{'Content-Type':'application/json'}});};
  const failure=this.initializationFailure;if(failure)return reply(failure);
  try{
   this.rate('node:connect',30);
   const authorization=request.headers.get('Authorization')??'';
   const device=this.nodes.authenticate(authorization.startsWith('Bearer ')?authorization.slice(7):null);
   // One live socket per node: a reconnect replaces a half-open predecessor.
   for(const old of this.nodeSockets()){try{old.close(4000,'Replaced by a newer connection.');}catch{}}
   const pair=new WebSocketPair();
   const [client,server]=Object.values(pair);
   this.ctx.acceptWebSocket(server,['node']);
   server.serializeAttachment({kind:'node',node_id:device.node_id} satisfies NodeAttachment);
   server.send(JSON.stringify({type:'welcome',node_id:device.node_id,heartbeat_ms:30000}));
   return new Response(null,{status:101,webSocket:client});
  }catch(error){return reply(error);}
 }
 /** Node frames: hello {capabilities,version}, heartbeat, result {id,ok,result|error}.
  * Anything else is ignored. A result for a parked request enqueues the
  * follow-up coordinator run, so the alarm is re-armed to wake the runtime. */
 private async nodeMessage(ws:WebSocket,attachment:NodeAttachment,message:string):Promise<void>{
   try{
    let frame:{type?:unknown;capabilities?:unknown;version?:unknown}&Record<string,unknown>;
    try{frame=JSON.parse(message);}catch{return;}
    if(!frame||typeof frame!=='object'||Array.isArray(frame))return;
    const device=this.nodes.device();
    if(!device||device.node_id!==attachment.node_id){try{ws.send(JSON.stringify({type:'revoked'}));ws.close(4001,'Node revoked.');}catch{}return;}
    if(frame.type==='hello'){
     const capabilities=Array.isArray(frame.capabilities)?frame.capabilities.filter((c):c is string=>typeof c==='string').slice(0,16):[];
     this.nodes.touch(device.node_id,{capabilities,version:typeof frame.version==='string'?frame.version.slice(0,40):null});
     this.deliverNodeRequests(true);
    }else if(frame.type==='heartbeat'){
     this.nodes.touch(device.node_id);ws.send(JSON.stringify({type:'heartbeat_ack'}));
    }else if(frame.type==='result'){
     this.nodes.touch(device.node_id);
     const settled=this.nodes.result(device.node_id,frame as {id?:unknown;ok?:unknown;result?:unknown;error?:unknown});
     ws.send(JSON.stringify({type:'ack',id:typeof frame.id==='string'?frame.id:null}));
     if(settled?.follow_up_run_id)await this.arm();
     this.broadcastStreamCommit();
    }
   }catch{try{ws.close(1011,'Node message failed.');}catch{}}
 }
 /** Pushes queued (and after a reconnect, delivered-but-open) requests. */
 private deliverNodeRequests(includeDelivered:boolean):void{
  const ws=this.nodeSockets().at(-1);if(!ws)return; // newest connection
  const device=this.nodes.device()!;
  const due:NodeRequest[]=this.nodes.takeDeliverable(device.node_id,includeDelivered);
  for(const request of due){
   try{ws.send(JSON.stringify({type:'request',id:request.id,capability:request.capability,args:request.args,deadline:request.deadline}));}
   catch{break;} // Left 'delivered'; redelivered on the next hello.
  }
 }
 private async arm(delayMs=0,fromAlarm=false):Promise<void>{
  const generation=this.core.ownerAlpha.activeGeneration();
  if(generation){
   const state=this.lifecycle.get();
   if(!['STOPPED','RECOVERY_REQUIRED'].includes(state.phase)){
    const callback=this.core.questions.nextCallbackDeadline();
    const due=Math.max(Date.now()+Math.max(100,delayMs),Math.min(Date.now()+Math.max(delayMs,5000),callback?Date.parse(callback):Infinity)),existing=await this.ctx.storage.getAlarm();
    // Portal refreshes must not continually postpone the wake/lease watchdog.
    if(existing===null||existing>due)await this.ctx.storage.setAlarm(due);
   }
   else await this.ctx.storage.deleteAlarm();
   return;
  }
  const times:number[]=[];
  const budgetDue=this.core.nextBudgetMaintenance();if(budgetDue)times.push(Date.parse(budgetDue));
  const retentionDue=this.retention.nextDue();if(retentionDue)times.push(Date.parse(retentionDue));
  const resultDue=this.resultRetention.nextDue();if(resultDue)times.push(Date.parse(resultDue));
  const previewDue=new OutputPreviews(this.store,()=>this.core.now()).nextDue();if(previewDue)times.push(Date.parse(previewDue));
  const usageDue=new TokenUsageSnapshots(this.store,()=>this.core.now()).nextDue();if(usageDue)times.push(Date.parse(usageDue));
  const memoryReadDue=new MemoryReadRetention(this.store,()=>this.core.now()).nextDue();if(memoryReadDue)times.push(Date.parse(memoryReadDue));
  const steeringDue=new TaskSteering(this.store,()=>this.core.now()).nextExpiry();if(steeringDue)times.push(Date.parse(steeringDue));
  const questionDue=this.core.questions.nextExpiry();if(questionDue)times.push(Date.parse(questionDue));
  const callbackDue=this.core.questions.nextCallbackDeadline();if(callbackDue)times.push(Date.parse(callbackDue));
  const commandExpiry=this.core.nextCommandPayloadExpiry();if(commandExpiry)times.push(Date.parse(commandExpiry));
  const followupExpiry=this.core.nextFollowupExpiry();if(followupExpiry)times.push(Date.parse(followupExpiry));
  const queuedContextExpiry=this.core.nextQueuedContextExpiry();if(queuedContextExpiry)times.push(Date.parse(queuedContextExpiry));
  const memoryExpiry=this.core.nextMemoryExpiry();if(memoryExpiry)times.push(Date.parse(memoryExpiry));
  const flightDue=this.flights.nextDue();if(flightDue)times.push(Date.parse(flightDue));
  const nodeDue=this.nodes.nextDue();if(nodeDue)times.push(Date.parse(nodeDue));
  const due=this.store.db.all<{next_due_at:string}>('SELECT next_due_at FROM schedule_state ORDER BY next_due_at LIMIT 1')[0];
  if(due)times.push(Date.parse(due.next_due_at));
  const retry=this.store.db.all<{due_at:string}>('SELECT due_at FROM retry_queue ORDER BY due_at LIMIT 1')[0];if(retry&&this.core.options.executionEnabled)times.push(Date.parse(retry.due_at));
  const state=this.lifecycle.get();
  const idle=['STOPPED','IDLE_PERMITTED'].includes(state.phase),claimable=this.core.options.executionEnabled&&!!this.lifecycle.nextClaimableRun();
  const productionWatch=this.core.options.executionEnabled&&(!idle||claimable);
  const alphaWatch=this.core.ownerAlpha.policy&&!['STOPPED','RECOVERY_REQUIRED'].includes(state.phase);
  // Work queued on a sleeping runtime wakes it now, not on the next watch tick.
  // The wake moves the phase to START_REQUESTED; the 1 s floor bounds any retry.
  if(idle&&claimable&&!this.core.ownerAlpha.policy)times.push(Date.now()+Math.max(delayMs,1000));
  if(productionWatch||alphaWatch)times.push(Date.now()+Math.max(delayMs,5000));
  if(!times.length){await this.ctx.storage.deleteAlarm();return;}
  const next=Math.max(Date.now()+Math.max(100,delayMs),Math.min(...times));
  // Ingress (portal polls, runtime heartbeats) must never postpone an earlier
  // pending alarm, or a queued wake waits until traffic stops. Only the alarm
  // handler itself may move the alarm later (e.g. its failure backoff).
  if(shouldSetAlarm(fromAlarm?null:await this.ctx.storage.getAlarm(),next))await this.ctx.storage.setAlarm(next);
 }
 protected sendHostedWake(command:{epoch:number;operationId:string}):Promise<void>{
  return sendHostedOwnerWake(this.hostedWake!,command,this.env.PROVIDER_TOKEN!,this.env.HEHEBOT_OWNER_ALPHA_WAKE_TOKEN!);
 }
 async alarm():Promise<void>{
  let failed=false;
  try{
   this.reconcile();
   if(this.hostedWake){
    try{
     const transition=this.hostedWake.transition_id??this.core.ownerAlpha.activeGeneration()?.transition_id;
     if(transition)await this.lifecycle.deliverOwnerAlphaWake(transition,command=>this.sendHostedWake(command));
    }
    // Delivery is already non-replayable. Keep the normal lease watchdog cadence.
    catch(error){console.error(JSON.stringify({event:'control.owner_alpha_wake_unknown',code:safeError(error).code,...(error instanceof HostedWakeDeliveryError?{phase:error.phase,upstream_status:error.upstreamStatus}:{})}));}
   }
   if(this.core.options.executionEnabled)this.progress.sweep();
   if(this.core.options.executionEnabled){const config=JSON.parse(this.env.PROVIDER_CONFIG) as ProviderConfig;const provider=createProvider({...config,token:this.env.PROVIDER_TOKEN,wakeToken:this.env.SPRITE_WAKE_TOKEN} as ProviderConfig);await this.lifecycle.drive(provider);}
  }catch(error){failed=true;console.error(JSON.stringify({event:'control.alarm_failed',code:safeError(error).code,
   ...(error instanceof ProviderError?{provider_code:error.code,provider_status:error.status??null}:{error_name:error instanceof Error?error.name:typeof error})}));}
  finally{this.broadcastStreamCommit();await this.arm(failed?300000:0,true);}
 }
}
