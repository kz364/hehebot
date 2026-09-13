export type ProviderId = 'fake' | 'fly-machines' | 'fly-sprites' | 'daytona' | 'railway' | 'e2b';
/** Portable identifiers only: credentials belong in the Worker secret store. */
export interface RuntimeRef {
  readonly provider: ProviderId;
  readonly id: string;
  readonly scope?: string;
  readonly persistentStateId?: string;
}
export interface LifecycleCommand { readonly operationId: string; readonly epoch: number }
export interface ActivityHold { readonly id: string; readonly expiresAt: number }
export type RuntimePhase = 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
export interface RuntimeObservation {
  readonly phase: RuntimePhase;
  /** Only explicit stopped state permits replacement; 404, timeout and suspension do not. */
  readonly executionStopped: boolean;
  readonly persistentState: 'retained' | 'unknown' | 'missing';
  readonly observedAt: number;
  readonly executionPaused?: boolean;
}
export interface ProviderCapabilities {
  readonly stopMode?: 'terminate' | 'pause-filesystem' | 'provider-idle' | 'unsupported';
  readonly implemented: boolean;
  readonly explicitWake: boolean;
  readonly explicitStop: boolean;
  readonly confirmedStop: boolean;
  readonly persistence: 'volume' | 'filesystem' | 'snapshot' | 'unknown';
  readonly activityHold: 'controller' | 'native' | 'unsupported';
  readonly maxSessionSeconds: number | null;
  readonly restrictions: readonly string[];
}
export interface RuntimeProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  observe(ref: RuntimeRef): Promise<RuntimeObservation>;
  /** Commands request transitions; successful return is NOT a state confirmation. */
  wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void>;
  stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void>;
  holdActivity(ref: RuntimeRef, hold: ActivityHold): Promise<void>;
}
export type ProviderErrorCode = 'unsupported' | 'unconfigured' | 'invalid_ref' | 'http_error' | 'outcome_unknown' | 'invalid_response';
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly status?: number) {
    super(message); this.name = 'ProviderError';
  }
}
export function validateRef(ref: RuntimeRef, provider: ProviderId): void {
  if (ref.provider !== provider || !ref.id || ref.id.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(ref.id)) {
    throw new ProviderError('invalid_ref', 'Runtime reference does not match provider');
  }
}
export function validateCommand(command: LifecycleCommand): void {
  if (!command.operationId || !Number.isSafeInteger(command.epoch) || command.epoch < 0) {
    throw new ProviderError('invalid_ref', 'Invalid lifecycle command');
  }
}
export { FakeProvider } from './fake';
export { FlyMachinesProvider } from './fly-machines';
export { DaytonaProvider } from './daytona';
export { createProvider, type ProviderConfig } from './factory';
export { E2BProvider, type E2BSdkPort } from './e2b';
export { SpritesProvider, SpritesTasksClient, type SpritesTaskTransport, type SpritesTaskRequest, type SpritesTaskReceipt } from './sprites';
export { RailwayProvider } from './railway';
export { createE2BHttpClient } from './e2b-http';
