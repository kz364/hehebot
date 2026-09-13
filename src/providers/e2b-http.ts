import { ProviderError } from './index';
import type { E2BSdkPort } from './e2b';

/** Worker-compatible bridge to the documented E2B Platform REST API, no Node SDK. */
export function createE2BHttpClient(token: string, fetcher: typeof fetch = fetch): E2BSdkPort {
  async function request(id: string, suffix: string, method: string, body?: unknown): Promise<Response> {
    if (!token.trim()) throw new ProviderError('unconfigured', 'E2B API key is required');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ProviderError('invalid_ref', 'Invalid E2B sandbox ID');
    let response: Response;
    try { response = await fetcher(`https://api.e2b.app/sandboxes/${encodeURIComponent(id)}${suffix}`, { method, headers: { 'X-API-Key': token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
    catch { throw new ProviderError('outcome_unknown', 'E2B request outcome is unknown'); }
    if (!response.ok) throw new ProviderError(method === 'GET' ? 'http_error' : 'outcome_unknown', 'E2B request failed; reconcile before retry', response.status);
    return response;
  }
  return {
    async getInfo(id) {
      const response = await request(id, '', 'GET');
      let data: unknown; try { data = await response.json(); } catch { throw new ProviderError('invalid_response', 'Invalid E2B JSON'); }
      if (!data || typeof data !== 'object' || !('sandboxID' in data) || data.sandboxID !== id || !('state' in data)) throw new ProviderError('invalid_response', 'Invalid E2B response identity');
      // Expose only control fields; sandbox/traffic access tokens stay out of observations.
      return { sandboxId: data.sandboxID, state: data.state, lifecycle: 'lifecycle' in data ? data.lifecycle : undefined };
    },
    async connect(id, options) { await request(id, '/connect', 'POST', { timeout: Math.ceil(options.timeoutMs / 1000) }); },
    async pause(id) { await request(id, '/pause', 'POST', { memory: false }); return true; },
  };
}
