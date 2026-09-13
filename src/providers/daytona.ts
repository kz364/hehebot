import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimePhase, type RuntimeProvider, type RuntimeRef } from './index';

/** Existing non-ephemeral container sandbox only; no provisioning or destructive APIs. */
export class DaytonaProvider implements RuntimeProvider {
  readonly id = 'daytona' as const;
  readonly capabilities: ProviderCapabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: true, confirmedStop: true, persistence: 'filesystem', activityHold: 'controller', maxSessionSeconds: null, restrictions: Object.freeze(['Preprovision a non-ephemeral sandbox with auto-stop/pause disabled, auto-delete disabled, no TTL', 'Lower tiers restrict outbound networking; verify required destinations and account tier', 'HTTP lifecycle integration is unit-tested only, not live-verified']) });
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  private async request(ref: RuntimeRef, suffix = '', method = 'GET'): Promise<Response> {
    validateRef(ref, this.id);
    if (!this.token.trim()) throw new ProviderError('unconfigured', 'Daytona API token is required');
    let response: Response;
    try { response = await this.fetcher(`https://app.daytona.io/api/sandbox/${encodeURIComponent(ref.id)}${suffix}`, { method, headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ProviderError('outcome_unknown', 'Provider request did not return a confirmed outcome'); }
    if (!response.ok) throw new ProviderError(method === 'GET' ? 'http_error' : 'outcome_unknown', 'Provider request failed; reconcile state before retry', response.status);
    return response;
  }
  private async data(ref: RuntimeRef): Promise<Record<string, unknown>> {
    const response = await this.request(ref);
    let value: unknown;
    try { value = await response.json(); } catch { throw new ProviderError('invalid_response', 'Provider returned invalid JSON'); }
    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== ref.id || !('state' in value) || typeof value.state !== 'string') throw new ProviderError('invalid_response', 'Invalid sandbox observation');
    return value as Record<string, unknown>;
  }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    const data = await this.data(ref);
    const mapping: Record<string, RuntimePhase> = { started: 'running', stopped: 'stopped', starting: 'starting', stopping: 'stopping' };
    const phase = mapping[data.state as string] ?? 'unknown';
    return { phase, executionStopped: phase === 'stopped', persistentState: ['running', 'stopped', 'starting', 'stopping'].includes(phase) ? 'retained' : 'unknown', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command);
    const data = await this.data(ref);
    if (data.autoStopInterval !== 0 || (data.autoPauseInterval != null && data.autoPauseInterval !== 0) || typeof data.autoDeleteInterval !== 'number' || data.autoDeleteInterval >= 0 || data.autoDestroyAt != null) {
      throw new ProviderError('unconfigured', 'Sandbox lifecycle policies must disable auto-stop, auto-pause, auto-delete and TTL');
    }
    await this.request(ref, '/start', 'POST');
  }
  async stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void> { validateCommand(command); await this.request(ref, '/stop', 'POST'); }
  async holdActivity(ref: RuntimeRef, _hold: ActivityHold): Promise<void> { validateRef(ref, this.id); throw new ProviderError('unsupported', 'Controller owns activity leases; sandbox auto-stop must be disabled'); }
}
