import { ControlError, requireThat } from './errors';
import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';
import type { Run } from './types';

export type TokenUsageCounts = {
 inputTokens: number;
 cachedInputTokens: number;
 cacheWriteInputTokens: number;
 outputTokens: number;
 reasoningOutputTokens: number;
 totalTokens: number;
};
export type TokenUsage = { total: TokenUsageCounts; last: TokenUsageCounts; modelContextWindow: number | null };
export type TokenUsageSnapshot = { run_id: string; attempt: number; native_ref: string; version: number; usage: TokenUsage };
type StoredTokenUsage = TokenUsageSnapshot & { expires_at: string };
const prefix = 'token-usage:';
const countKeys = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'] as const;

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
 return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function validCounts(value: unknown): value is TokenUsageCounts {
 return exactObject(value, countKeys) && countKeys.every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0);
}
function validInput(input: TokenUsageSnapshot): boolean {
 return exactObject(input, ['run_id', 'attempt', 'native_ref', 'version', 'usage']) &&
  typeof input.run_id === 'string' && input.run_id.length > 0 &&
  Number.isSafeInteger(input.attempt) && input.attempt >= 1 &&
  typeof input.native_ref === 'string' && input.native_ref.length > 0 && input.native_ref.length <= 256 &&
  Number.isSafeInteger(input.version) && input.version >= 1 &&
  exactObject(input.usage, ['total', 'last', 'modelContextWindow']) && validCounts(input.usage.total) && validCounts(input.usage.last) &&
  (input.usage.modelContextWindow === null || Number.isSafeInteger(input.usage.modelContextWindow) && input.usage.modelContextWindow >= 0);
}

/** Runtime observations only; these are not billing, freshness, or settlement receipts. */
export class TokenUsageSnapshots {
 constructor(private store: Store, private now: () => string) {}

 record(identity: Identity, input: TokenUsageSnapshot, lifecycle: LifecycleCore): void {
  requireThat(validInput(input), 'INVALID_INPUT', 'Invalid token usage snapshot.', 422);
  this.store.db.transaction(() => {
   try { lifecycle.authorizeAttempt(identity, input.run_id, input.attempt); }
   catch (error) {
    if (error instanceof ControlError) throw new ControlError('USAGE_FENCED', 'Token usage no longer matches runtime custody.');
    throw error;
   }
   const run = this.store.db.all<Pick<Run,'current_attempt'|'status'|'error_code'>>('SELECT current_attempt,status,error_code FROM runs WHERE id=?', input.run_id)[0];
   requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
   const attempt = this.store.db.all<{native_run_ref:string|null;deadline_at:string}>('SELECT native_run_ref,deadline_at FROM attempts WHERE run_id=? AND attempt=?', input.run_id, input.attempt)[0];
   requireThat(run.current_attempt === input.attempt && ['running', 'finishing'].includes(run.status) &&
    !['OWNER_CANCELLED', 'CONTEXT_INVALIDATED'].includes(run.error_code ?? '') && attempt?.native_run_ref === input.native_ref && attempt.deadline_at > this.now(),
   'USAGE_FENCED', 'Token usage no longer matches the active native attempt.');

   const key = prefix + input.run_id;
   const row = this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0];
   const prior = row ? JSON.parse(row.value_json) as StoredTokenUsage : null;
   if (prior?.attempt === input.attempt) {
    requireThat(input.version >= prior.version, 'REVISION_CONFLICT', 'Token usage version is stale.');
    if (input.version === prior.version) {
     requireThat(prior.native_ref === input.native_ref && prior.usage.modelContextWindow === input.usage.modelContextWindow &&
      countKeys.every(key => prior.usage.total[key] === input.usage.total[key] && prior.usage.last[key] === input.usage.last[key]),
      'IDEMPOTENCY_CONFLICT', 'Token usage version changed.');
     return;
    }
   }
   const expires_at = prior?.attempt === input.attempt ? prior.expires_at : new Date(Date.parse(this.now()) + 90 * 86400000).toISOString();
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify({...input, expires_at}));
  });
 }

 read(runId: string, attempt: number): Omit<TokenUsageSnapshot, 'native_ref'> | null {
  const run = this.store.db.all<Pick<Run,'current_attempt'>>('SELECT current_attempt FROM runs WHERE id=?', runId)[0];
  requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
  if (run.current_attempt !== attempt) return null;
  const row = this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?', prefix + runId)[0];
  if (!row) return null;
  const value = JSON.parse(row.value_json) as StoredTokenUsage;
  if (value.attempt !== attempt || value.expires_at <= this.now()) return null;
  return {run_id: value.run_id, attempt: value.attempt, version: value.version, usage: value.usage};
 }

 nextDue(): string | null {
  return this.store.db.all<{due:string|null}>("SELECT MIN(json_extract(value_json,'$.expires_at')) AS due FROM runtime_metadata WHERE key GLOB 'token-usage:*'")[0].due;
 }

 prune(): number {
  return this.store.db.transaction(() => {
   const rows = this.store.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'token-usage:*' AND json_extract(value_json,'$.expires_at')<=? ORDER BY key LIMIT 100", this.now());
   for (const row of rows) this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', row.key);
   return rows.length;
  });
 }
}
