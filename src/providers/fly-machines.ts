import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimePhase, type RuntimeProvider, type RuntimeRef } from './index';

export class FlyMachinesProvider implements RuntimeProvider {
  readonly id = 'fly-machines' as const;
  readonly capabilities: ProviderCapabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: true, confirmedStop: true, persistence: 'volume', activityHold: 'controller', maxSessionSeconds: null, restrictions: Object.freeze(['Preprovision one Machine with mounted persistent volume', 'Disable proxy autostop and automatic replacement; controller owns stop admission', 'No provider operation idempotency or epoch fencing is assumed']) });
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  private path(ref: RuntimeRef): string {
    validateRef(ref, this.id);
    if (!ref.scope || !/^[a-zA-Z0-9_-]+$/.test(ref.scope)) throw new ProviderError('invalid_ref', 'Fly reference requires app scope');
    if (!this.token.trim()) throw new ProviderError('unconfigured', 'Fly API token is required');
    return `https://api.machines.dev/v1/apps/${encodeURIComponent(ref.scope)}/machines/${encodeURIComponent(ref.id)}`;
  }
  private async request(ref: RuntimeRef, suffix = '', method = 'GET'): Promise<Response> {
    const url = this.path(ref);
    let response: Response;
    try {
      response = await this.fetcher(url + suffix, { method, headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      // Never echo response bodies or thrown messages, which may contain credentials.
      throw new ProviderError('outcome_unknown', 'Provider request did not return a confirmed outcome');
    }
    if (!response.ok) throw new ProviderError(method === 'GET' ? 'http_error' : 'outcome_unknown', 'Provider request failed; reconcile state before retry', response.status);
    return response;
  }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    const response = await this.request(ref);
    let data: unknown;
    try { data = await response.json(); } catch { throw new ProviderError('invalid_response', 'Provider returned invalid JSON'); }
    if (!data || typeof data !== 'object' || !('id' in data) || data.id !== ref.id || !('state' in data) || typeof data.state !== 'string') {
      throw new ProviderError('invalid_response', 'Provider returned an invalid Machine observation');
    }
    const states: Record<string, RuntimePhase> = { started: 'running', stopped: 'stopped', starting: 'starting', stopping: 'stopping' };
    const phase = states[data.state] ?? 'unknown';
    const config = 'config' in data && data.config && typeof data.config === 'object' ? data.config : undefined;
    const mounts = config && 'mounts' in config && Array.isArray(config.mounts) ? config.mounts : [];
    const retained = !!ref.persistentStateId && mounts.some((mount: unknown) => !!mount && typeof mount === 'object' && 'volume' in mount && mount.volume === ref.persistentStateId);
    return { phase, executionStopped: phase === 'stopped', persistentState: retained ? 'retained' : 'unknown', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> { validateCommand(command); await this.request(ref, '/start', 'POST'); }
  async stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void> { validateCommand(command); await this.request(ref, '/stop', 'POST'); }
  async holdActivity(ref: RuntimeRef, _hold: ActivityHold): Promise<void> {
    validateRef(ref, this.id);
    throw new ProviderError('unsupported', 'Fly activity leases are enforced by the controller; no native hold endpoint');
  }
}
