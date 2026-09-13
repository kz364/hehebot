import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimeProvider, type RuntimeRef } from './index';

/** Structural subset of e2b Sandbox static API v2.38.2; inject authenticated bound methods. */
export interface E2BSdkPort {
  getInfo(id: string, options: { requestTimeoutMs: number }): Promise<unknown>;
  connect(id: string, options: { timeoutMs: number; requestTimeoutMs: number }): Promise<unknown>;
  pause(id: string, options: { keepMemory: false; requestTimeoutMs: number }): Promise<boolean>;
}
export class E2BProvider implements RuntimeProvider {
  readonly id = 'e2b' as const;
  readonly capabilities: ProviderCapabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: true, confirmedStop: false, stopMode: 'pause-filesystem', persistence: 'snapshot', activityHold: 'controller', maxSessionSeconds: 3600, restrictions: Object.freeze(['Inject authenticated e2b Sandbox SDK v2.38.2 compatible static methods', 'Preprovision lifecycle onTimeout pause and autoResume false; verify bootstrap after filesystem-only resume', 'Pause is separately observed and never authorizes replacement; account session deadline must be enforced']) });
  constructor(private readonly client?: E2BSdkPort, private readonly lifecycleVerified = false, private readonly now: () => number = Date.now) {}
  private configured(ref: RuntimeRef): E2BSdkPort { validateRef(ref, this.id); if (!this.client) throw new ProviderError('unconfigured', 'E2B SDK client is not configured'); return this.client; }
  private async call<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('outcome_unknown', 'E2B operation failed; reconcile before retry'); } }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    const client = this.configured(ref);
    const data = await this.call(() => client.getInfo(ref.id, { requestTimeoutMs: 15_000 }));
    if (!data || typeof data !== 'object' || !('sandboxId' in data) || data.sandboxId !== ref.id || !('state' in data) || typeof data.state !== 'string') throw new ProviderError('invalid_response', 'Invalid E2B sandbox observation');
    const known = data.state === 'running' || data.state === 'paused';
    return { phase: data.state === 'running' ? 'running' : 'unknown', executionStopped: false, executionPaused: data.state === 'paused', persistentState: known ? 'retained' : 'unknown', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command); const client = this.configured(ref);
    if (!this.lifecycleVerified) throw new ProviderError('unconfigured', 'E2B timeout lifecycle and cold bootstrap must be verified before wake');
    const info = await this.call(() => client.getInfo(ref.id, { requestTimeoutMs: 15_000 }));
    const lifecycle = info && typeof info === 'object' && 'lifecycle' in info ? info.lifecycle : undefined;
    if (!lifecycle || typeof lifecycle !== 'object' || !('onTimeout' in lifecycle) || lifecycle.onTimeout !== 'pause' || !('autoResume' in lifecycle) || lifecycle.autoResume !== false) throw new ProviderError('unconfigured', 'E2B lifecycle readback must show onTimeout pause and autoResume false');
    await this.call(() => client.connect(ref.id, { timeoutMs: 30 * 60 * 1000, requestTimeoutMs: 15_000 }));
  }
  async stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command); const client = this.configured(ref);
    // No kill fallback: kill permanently deletes the sandbox and its resumable state.
    await this.call(() => client.pause(ref.id, { keepMemory: false, requestTimeoutMs: 15_000 }));
  }
  async holdActivity(ref: RuntimeRef, _hold: ActivityHold): Promise<void> { this.configured(ref); throw new ProviderError('unsupported', 'Controller must enforce session deadlines and checkpoint before expiry'); }
}
