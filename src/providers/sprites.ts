import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimeProvider, type RuntimeRef } from './index';

export interface SpritesTaskRequest {
  readonly socketPath: '/.sprite/api.sock';
  readonly host: 'sprite';
  readonly method: 'GET' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: Readonly<{ expire: number }>;
}
/** Bind to Node http.request({socketPath, host, path, method}) inside the Sprite only.
 * Transport must enforce a bounded timeout and JSON Content-Type when body is present. */
export type SpritesTaskTransport = (request: SpritesTaskRequest) => Promise<{ status: number; body?: unknown }>;
export interface SpritesTaskReceipt { readonly name: string; readonly expiresAt: number }

/** Native task hold implementation; no API token and no external management URL. */
export class SpritesTasksClient {
  constructor(private readonly transport: SpritesTaskTransport, private readonly now: () => number = Date.now) {}
  private path(name: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new ProviderError('invalid_ref', 'Invalid Sprite task name');
    return `/v1/tasks/${encodeURIComponent(name)}`;
  }
  private async request(method: SpritesTaskRequest['method'], name: string, expire?: number) {
    const path = this.path(name);
    try { return await this.transport({ socketPath: '/.sprite/api.sock', host: 'sprite', method, path, ...(expire === undefined ? {} : { body: { expire } }) }); }
    catch { throw new ProviderError('outcome_unknown', 'Native Sprite task request failed'); }
  }
  async observe(name: string): Promise<SpritesTaskReceipt | null> {
    const response = await this.request('GET', name);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new ProviderError('http_error', 'Native Sprite task observation failed', response.status);
    const task = response.body;
    if (!task || typeof task !== 'object' || !('name' in task) || task.name !== name || !('expires_at' in task) || typeof task.expires_at !== 'string') throw new ProviderError('invalid_response', 'Invalid Sprite task receipt');
    const expiresAt = Date.parse(task.expires_at);
    if (!Number.isFinite(expiresAt)) throw new ProviderError('invalid_response', 'Invalid Sprite task expiry');
    return { name, expiresAt };
  }
  async hold(hold: ActivityHold): Promise<SpritesTaskReceipt> {
    const seconds = Math.ceil((hold.expiresAt - this.now()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new ProviderError('invalid_ref', 'Sprite task expiry must be within the next hour');
    const response = await this.request('PUT', hold.id, seconds);
    if (response.status !== 200) throw new ProviderError('outcome_unknown', 'Native Sprite task renewal was not accepted', response.status);
    const receipt = await this.observe(hold.id);
    if (!receipt || receipt.expiresAt < hold.expiresAt) throw new ProviderError('outcome_unknown', 'Native Sprite task expiry was not confirmed');
    return receipt;
  }
  async release(name: string): Promise<void> {
    const response = await this.request('DELETE', name);
    if (response.status !== 204 && response.status !== 404) throw new ProviderError('outcome_unknown', 'Native Sprite task release was not accepted', response.status);
    if (await this.observe(name)) throw new ProviderError('outcome_unknown', 'Native Sprite task remains present after release');
  }
}

/** Partial adapter: observed VM state and named service start, never unsafe VM stop emulation. */
export class SpritesProvider implements RuntimeProvider {
  readonly id = 'fly-sprites' as const;
  readonly capabilities: ProviderCapabilities;
  constructor(private readonly token: string, private readonly service = 'gateway', private readonly tasksBridgeVerified = false, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now, private readonly tasksBridge?: { readonly runtimeId: string; readonly client: SpritesTasksClient }, private readonly wakeTarget?: {readonly url:string;readonly token:string}) {
    this.capabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: false, confirmedStop: false, stopMode: 'provider-idle', persistence: 'filesystem', activityHold: tasksBridge ? 'native' : 'unsupported', maxSessionSeconds: null, restrictions: Object.freeze(['Service wake and observation; whole-runtime stop is unsupported', 'Native Tasks transport is bound inside one Sprite; renew while operations are active', 'Warm/cold distinctions do not authorize replacing a runtime']) });
  }
  private async request(ref: RuntimeRef, suffix = '', method = 'GET'): Promise<Response> {
    validateRef(ref, this.id);
    if (!this.token.trim()) throw new ProviderError('unconfigured', 'Sprites API token is required');
    let response: Response;
    try { response = await this.fetcher(`https://api.sprites.dev/v1/sprites/${encodeURIComponent(ref.id)}${suffix}`, { method, headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ProviderError('outcome_unknown', 'Sprites request outcome is unknown'); }
    if (!response.ok) throw new ProviderError(method === 'GET' ? 'http_error' : 'outcome_unknown', 'Sprites request failed; reconcile before retry', response.status);
    return response;
  }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    const response = await this.request(ref);
    let data: unknown; try { data = await response.json(); } catch { throw new ProviderError('invalid_response', 'Invalid Sprite JSON'); }
    if (!data || typeof data !== 'object' || !('name' in data) || data.name !== ref.id || !('status' in data) || typeof data.status !== 'string') throw new ProviderError('invalid_response', 'Invalid Sprite observation');
    const active = data.status === 'running';
    const idle = data.status === 'warm' || data.status === 'cold';
    return { phase: active ? 'running' : 'unknown', executionStopped: false, executionPaused: idle, persistentState: active || idle ? 'retained' : 'unknown', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command); validateRef(ref, this.id);
    if (!this.tasksBridgeVerified) throw new ProviderError('unconfigured', 'Sprites Tasks lease bridge must be verified before wake');
    let target:URL;
    try{target=new URL(this.wakeTarget?.url??'');}catch{throw new ProviderError('unconfigured','Sprite supervisor wake URL is required');}
    if(target.protocol!=='https:'||!target.hostname.endsWith('.sprites.app')||!target.hostname.startsWith(ref.id+'-')||target.port||target.username||target.password||target.pathname!=='/'||target.search||target.hash||!this.wakeTarget?.token||this.wakeTarget.token.length<32)throw new ProviderError('unconfigured','Private Sprite supervisor wake configuration is invalid');
    if (!/^[a-zA-Z0-9_-]+$/.test(this.service)) throw new ProviderError('invalid_ref', 'Invalid Sprite service name');
    const response = await this.request(ref, `/services/${encodeURIComponent(this.service)}/start`, 'POST');
    // Service endpoint returns NDJSON: 200 alone can still contain an error event.
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('invalid_response', 'Missing Sprite service response');
    let content = ''; const decoder = new TextDecoder();
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; content += decoder.decode(value, { stream: true }); if (content.length > 256_000) throw new ProviderError('invalid_response', 'Sprite service response exceeds limit'); }
      content += decoder.decode();
      const events = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as { type?: string });
      if (events.some(event => event.type === 'error') || !events.some(event => event.type === 'started' || event.type === 'complete')) throw new ProviderError('outcome_unknown', 'Sprite service start was not confirmed');
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('outcome_unknown', 'Sprite service start was not confirmed'); }
    finally { await reader.cancel().catch(() => undefined); }
    // Starting an already-running warm Service is not an application wake event.
    // Explicit authenticated HTTP notification wakes its event loop without idle polling.
    try{
      const wake=await this.fetcher(new URL('/wake',target),{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'X-Claw-Wake-Token':this.wakeTarget!.token,'Content-Type':'application/json'},body:JSON.stringify(command),redirect:'error',signal:AbortSignal.timeout(15000)});
      if(wake.status!==202)throw new Error('not accepted');
      const stream=wake.body?.getReader();if(!stream)throw new Error('missing response');
      let size=0,text='';const decode=new TextDecoder();
      try{for(;;){const {done,value}=await stream.read();if(done)break;size+=value.length;if(size>4096)throw new Error('oversized response');text+=decode.decode(value,{stream:true});}text+=decode.decode();}finally{await stream.cancel().catch(()=>{});}
      const receipt=JSON.parse(text) as {accepted?:boolean;epoch?:number};if(receipt.accepted!==true||receipt.epoch!==command.epoch)throw new Error('invalid receipt');
    }catch{throw new ProviderError('outcome_unknown','Sprite supervisor wake outcome is unknown; reconcile before retry');}
  }
  async stop(ref: RuntimeRef, _command: LifecycleCommand): Promise<void> { validateRef(ref, this.id); throw new ProviderError('unsupported', 'Stopping one Sprite service cannot establish whole-runtime termination'); }
  async holdActivity(ref: RuntimeRef, hold: ActivityHold): Promise<void> {
    validateRef(ref, this.id);
    if (!this.tasksBridge) throw new ProviderError('unsupported', 'Native Tasks require an in-runtime transport');
    if (this.tasksBridge.runtimeId !== ref.id) throw new ProviderError('invalid_ref', 'Native Tasks bridge belongs to a different Sprite');
    await this.tasksBridge.client.hold(hold);
  }
}
