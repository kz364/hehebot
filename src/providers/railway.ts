import { ProviderError, validateCommand, validateRef, type ActivityHold, type LifecycleCommand, type ProviderCapabilities, type RuntimeObservation, type RuntimeProvider, type RuntimeRef } from './index';

/** Deployment-scoped adapter. No redeploy, remove, service-delete or replica creation. */
export class RailwayProvider implements RuntimeProvider {
  readonly id = 'railway' as const;
  readonly capabilities: ProviderCapabilities = Object.freeze({ implemented: true, explicitWake: true, explicitStop: true, confirmedStop: false, stopMode: 'terminate', persistence: 'volume', activityHold: 'controller', maxSessionSeconds: null, restrictions: Object.freeze(['Preprovision one deployment with persistent volume and provider autosleep disabled', 'Stop/restart API exists, but documented deployment statuses lack authoritative STOPPED; replacement remains blocked', 'SLEEPING and REMOVED are not confirmed process termination; no implicit redeploy']) });
  constructor(private readonly token: string, private readonly tokenKind: 'project' | 'account' = 'project', private readonly lifecycleVerified = false, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  private async request(ref: RuntimeRef, query: string, mutation = false): Promise<Record<string, unknown>> {
    validateRef(ref, this.id);
    if (!this.token.trim()) throw new ProviderError('unconfigured', 'Railway token is required');
    let response: Response;
    try { response = await this.fetcher('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.tokenKind === 'project' ? { 'Project-Access-Token': this.token } : { Authorization: `Bearer ${this.token}` }) }, body: JSON.stringify({ query, variables: { id: ref.id } }), redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new ProviderError('outcome_unknown', 'Railway request outcome is unknown'); }
    if (!response.ok) throw new ProviderError(mutation ? 'outcome_unknown' : 'http_error', 'Railway request failed; reconcile before retry', response.status);
    let data: unknown; try { data = await response.json(); } catch { throw new ProviderError('invalid_response', 'Invalid Railway JSON'); }
    if (!data || typeof data !== 'object' || ('errors' in data && Array.isArray(data.errors) && data.errors.length > 0)) throw new ProviderError(mutation ? 'outcome_unknown' : 'http_error', 'Railway GraphQL operation failed');
    if (!('data' in data) || !data.data || typeof data.data !== 'object') throw new ProviderError('invalid_response', 'Missing Railway GraphQL data');
    return data.data as Record<string, unknown>;
  }
  private async deployment(ref: RuntimeRef): Promise<{ id: string; status: string }> {
    const data = await this.request(ref, 'query deployment($id: String!) { deployment(id: $id) { id status } }');
    const value = data.deployment;
    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== ref.id || !('status' in value) || typeof value.status !== 'string') throw new ProviderError('invalid_response', 'Invalid Railway deployment observation');
    return { id: value.id as string, status: value.status };
  }
  async observe(ref: RuntimeRef): Promise<RuntimeObservation> {
    const data = await this.deployment(ref);
    return { phase: data.status === 'SUCCESS' ? 'running' : data.status === 'DEPLOYING' ? 'starting' : 'unknown', executionStopped: false, executionPaused: data.status === 'SLEEPING', persistentState: 'unknown', observedAt: this.now() };
  }
  async wake(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command);
    if (!this.lifecycleVerified) throw new ProviderError('unconfigured', 'Railway lifecycle, volume and single-deployment settings require verification');
    const current = await this.deployment(ref);
    if (current.status === 'SUCCESS') return;
    if (current.status !== 'CRASHED' && current.status !== 'SLEEPING') throw new ProviderError('unsupported', 'Deployment cannot be safely restarted from this state; explicit reconciliation required');
    const data = await this.request(ref, 'mutation deploymentRestart($id: String!) { deploymentRestart(id: $id) }', true);
    if (data.deploymentRestart !== true) throw new ProviderError('outcome_unknown', 'Railway restart was not accepted');
  }
  async stop(ref: RuntimeRef, command: LifecycleCommand): Promise<void> {
    validateCommand(command);
    const data = await this.request(ref, 'mutation deploymentStop($id: String!) { deploymentStop(id: $id) }', true);
    if (data.deploymentStop !== true) throw new ProviderError('outcome_unknown', 'Railway stop was not accepted');
  }
  async holdActivity(ref: RuntimeRef, _hold: ActivityHold): Promise<void> { validateRef(ref, this.id); throw new ProviderError('unsupported', 'Controller holds require provider autosleep disabled'); }
}
