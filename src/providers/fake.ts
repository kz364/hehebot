import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimePhase, type RuntimeProvider, type RuntimeRef } from './index';

/** Deliberately asynchronous transitions let tests exercise uncertain stop/wake races. */
export class FakeProvider implements RuntimeProvider {
  readonly id = 'fake' as const;
  readonly capabilities: ProviderCapabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: true, confirmedStop: true, persistence: 'filesystem', activityHold: 'controller', maxSessionSeconds: null, restrictions: Object.freeze(['Test only; no remote execution']) });
  readonly calls: { action: 'wake' | 'stop'; ref: RuntimeRef; command: LifecycleCommand }[] = [];
  private states = new Map<string, RuntimePhase>();
  constructor(private readonly now: () => number = Date.now) {}
  setPhase(ref: RuntimeRef, phase: RuntimePhase): void { validateRef(ref, this.id); this.states.set(ref.id, phase); }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    validateRef(ref, this.id);
    const phase = this.states.get(ref.id) ?? 'stopped';
    return { phase, executionStopped: phase === 'stopped', persistentState: 'retained', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> { this.request('wake', ref, command); }
  async stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void> { this.request('stop', ref, command); }
  private request(action: 'wake' | 'stop', ref: RuntimeRef, command: LifecycleCommand): void {
    validateRef(ref, this.id); validateCommand(command);
    this.calls.push({ action, ref: { ...ref }, command: { ...command } });
    this.states.set(ref.id, action === 'wake' ? 'starting' : 'stopping');
  }
  async holdActivity(ref: RuntimeRef, _hold: ActivityHold): Promise<void> {
    validateRef(ref, this.id);
    throw new ProviderError('unsupported', 'Activity leases are owned by the controller');
  }
}
