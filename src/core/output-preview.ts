import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';
import { requireThat } from './errors';

export type OutputPreview = { run_id: string; attempt: number; native_ref: string; version: number; text: string; truncated: boolean };
type StoredPreview = OutputPreview & { expires_at: string };
const prefix = 'output-preview:';

/** Latest provisional display text only. Never a result, checkpoint or settlement receipt. */
export class OutputPreviews {
 constructor(private store: Store, private now: () => string) {}
 record(identity: Identity, input: OutputPreview, lifecycle: LifecycleCore): void {
  requireThat(Number.isSafeInteger(input.version) && input.version >= 1 && typeof input.text === 'string' && input.text.length <= 8192 &&
   typeof input.truncated === 'boolean' && typeof input.native_ref === 'string' && input.native_ref.length > 0 && input.native_ref.length <= 256,
   'INVALID_INPUT', 'Invalid provisional output.', 422);
  this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, input.run_id, input.attempt);
   const run = this.store.run(input.run_id);
   requireThat(run.current_attempt === input.attempt && ['running', 'finishing'].includes(run.status) &&
    !['OWNER_CANCELLED', 'CONTEXT_INVALIDATED'].includes(run.error_code ?? ''), 'OUTPUT_FENCED', 'Task no longer accepts provisional output.');
   const attempt = this.store.db.all<{native_run_ref:string;deadline_at:string}>('SELECT native_run_ref,deadline_at FROM attempts WHERE run_id=? AND attempt=?', run.id, input.attempt)[0];
   requireThat(attempt.native_run_ref === input.native_ref && attempt.deadline_at > this.now(), 'OUTPUT_FENCED', 'Provisional output does not match the active native attempt.');
   const key = prefix + run.id;
   const row = this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0];
   const prior = row ? JSON.parse(row.value_json) as StoredPreview : null;
   if (prior?.attempt === input.attempt) {
    requireThat(input.version >= prior.version, 'REVISION_CONFLICT', 'Provisional output version is stale.');
    if (input.version === prior.version) {
     requireThat(prior.native_ref === input.native_ref && prior.text === input.text && prior.truncated === input.truncated, 'IDEMPOTENCY_CONFLICT', 'Provisional output version changed.');
     return;
    }
   }
   // The first preview's expiry is not extended by polling or later messages.
   const expires_at = prior?.attempt === input.attempt ? prior.expires_at : new Date(Date.parse(this.now()) + 90 * 86400000).toISOString();
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify({ ...input, expires_at }));
  });
 }
 read(runId: string, attempt: number): Pick<OutputPreview,'run_id'|'attempt'|'version'|'text'|'truncated'> | null {
  const run = this.store.run(runId);
  if (run.current_attempt !== attempt || !['running', 'finishing', 'recovery_required'].includes(run.status) || ['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code ?? '')) return null;
  const row = this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?', prefix + runId)[0];
  if (!row) return null;
  const value = JSON.parse(row.value_json) as StoredPreview;
  if (value.attempt !== attempt || value.expires_at <= this.now()) return null;
  return { run_id: runId, attempt, version: value.version, text: value.text, truncated: value.truncated };
 }
 nextDue(): string | null {
  return this.store.db.all<{due:string|null}>("SELECT MIN(json_extract(value_json,'$.expires_at')) AS due FROM runtime_metadata WHERE key GLOB 'output-preview:*'")[0].due;
 }
 prune(): number {
  return this.store.db.transaction(() => {
   const rows = this.store.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'output-preview:*' AND json_extract(value_json,'$.expires_at')<=? ORDER BY key LIMIT 100", this.now());
   for (const row of rows) this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', row.key);
   return rows.length;
  });
 }
 discard(runId: string): void { this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', prefix + runId); }
}
