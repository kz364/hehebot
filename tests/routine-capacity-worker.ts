import {createHash} from 'node:crypto';
import {PersonalControl} from '../src/worker/control-object';
import type {ControlCore} from '../src/core/control';
import type {Store} from '../src/core/store';

type FixtureEnv=Env&{FIXTURE_NOW:string;DB:DurableObjectNamespace};

// Only this disposable Worker entrypoint exposes test routes. No copied scheduler,
// SQL writes, runtime admission bypass, or production ingress changes.
export class RoutineCapacity extends PersonalControl {
 private clock:string;
 constructor(ctx:DurableObjectState,env:FixtureEnv){
  if(env.EXECUTION_ENABLED!=='false'||env.NATIVE_VERIFIED!=='false')throw Error('Execution gates must be false');
  super(ctx,env);this.clock=env.FIXTURE_NOW;
  // Narrow test-only access: replace the existing core's clock, never the core,
  // lifecycle, reconcile or alarm implementation. Readback uses its actual Store.
  this.internals().core.options.now=()=>new Date(this.clock);
 }
 private internals(){return this as unknown as {core:ControlCore;store:Store};}
 async fetch(request:Request){
  const url=new URL(request.url);
  if(url.hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
  if(url.pathname==='/command'&&request.method==='POST'){
   const text=await request.text();
   return Response.json(await this.accept('fixture-owner',crypto.randomUUID(),createHash('sha256').update(text).digest('hex'),JSON.parse(text)));
  }
  if(url.pathname==='/alarm'&&request.method==='POST'){
   const {now}=await request.json() as {now:string};
   if(!['2099-09-10T03:00:00.000Z','2099-09-10T03:30:00.000Z'].includes(now)||now<this.clock)return new Response('Invalid fixture clock',{status:400});
   this.clock=now;
   await super.alarm(); // Explicit real handler invocation, not timed delivery.
  }else if(url.pathname!=='/snapshot'||request.method!=='GET')return new Response('Not found',{status:404});
  const {store,core}=this.internals();
  const tables=['objects','object_revisions','schedule_state','occurrences','runs','attempts','effects','outbox','lifecycle'] as const;
  return Response.json({now:this.clock,execution_enabled:core.options.executionEnabled,native_verified:this.env.NATIVE_VERIFIED,alarm:await this.ctx.storage.getAlarm(),tables:Object.fromEntries(tables.map(table=>[table,store.db.all(`SELECT * FROM ${table} ORDER BY rowid`)]))});
 }
}
export default {fetch(request:Request,env:FixtureEnv){
 if(new URL(request.url).hostname!=='127.0.0.1')return new Response('Loopback fixture only',{status:403});
 return env.DB.get(env.DB.idFromName('routine-capacity-fixture')).fetch(request);
}};
