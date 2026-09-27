import { createHash } from 'node:crypto';
import { requireThat } from './errors';
import type { ControlCore } from './control';
import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';
import type { Run } from './types';

/** Stuck detection for attempts that report progress (today: browser use via
 * runtime/browser-gateway.mjs). An attempt is active while it reports new
 * progress or its token usage grows. After no_progress_ms of neither it is
 * nudged once through ordinary steering; if it stays idle for nudge_grace_ms
 * more it is stopped (cancelling, STUCK_NO_PROGRESS) and the owner is told.
 * Attempts that never report progress are not watched. */
export type StuckPolicy = { noProgressMs: number; nudgeGraceMs: number };
type ProgressRow = { run_id: string; attempt: number; source: string; progress_at: string; active_at: string; tokens: number | null; nudged_at: string | null };
const prefix = 'progress:';
const NUDGE = 'You appear to have made no progress for a while. Try a different approach, or tell the owner with hehebot_send_message what is blocking you and stop.';

export function parseStuckPolicy(raw: string | undefined): StuckPolicy | undefined {
 if (!raw) return undefined;
 let value: unknown; try { value = JSON.parse(raw); } catch { value = null; }
 const v = value as { no_progress_ms?: unknown; nudge_grace_ms?: unknown } | null;
 const int = (x: unknown, min: number, max: number) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
 requireThat(!!v && typeof v === 'object' && Object.keys(v).every(k => ['no_progress_ms', 'nudge_grace_ms'].includes(k)) &&
  int(v.no_progress_ms, 10000, 86400000) && int(v.nudge_grace_ms, 5000, 86400000),
  'INVALID_CONFIGURATION', 'HEHEBOT_STUCK_POLICY must be {"no_progress_ms","nudge_grace_ms"}.', 503);
 return { noProgressMs: v!.no_progress_ms as number, nudgeGraceMs: v!.nudge_grace_ms as number };
}

export class ProgressWatchdog {
 constructor(private store: Store, private core: ControlCore, private policy?: StuckPolicy) {}
 private tokens(runId: string, attempt: number): number | null {
  const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', `token-usage:${runId}`)[0];
  if (!row) return null;
  const usage = JSON.parse(row.value_json) as { attempt: number; usage: { total: { totalTokens: number } } };
  return usage.attempt === attempt ? usage.usage.total.totalTokens : null;
 }
 private save(row: ProgressRow) {
  this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', prefix + row.run_id, JSON.stringify(row));
 }
 record(identity: Identity, runId: string, attempt: number, source: string, lifecycle: LifecycleCore): void {
  this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, runId, attempt);
   const now = this.core.now();
   const prior = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', prefix + runId)[0];
   const row = prior ? JSON.parse(prior.value_json) as ProgressRow : null;
   const same = row?.attempt === attempt;
   this.save({ run_id: runId, attempt, source, progress_at: now, active_at: now, tokens: same ? row!.tokens : this.tokens(runId, attempt), nudged_at: null });
  });
 }
 sweep(): void {
  if (!this.policy) return;
  const policy = this.policy, nowIso = this.core.now(), now = Date.parse(nowIso);
  for (const { value_json } of this.store.db.all<{ value_json: string }>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'progress:*' LIMIT 64")) {
   const row = JSON.parse(value_json) as ProgressRow;
   const run = this.store.db.all<Pick<Run, 'id' | 'status' | 'current_attempt' | 'persona_id' | 'command_id' | 'title'>>('SELECT id,status,current_attempt,persona_id,command_id,title FROM runs WHERE id=?', row.run_id)[0];
   if (!run || run.status !== 'running' || run.current_attempt !== row.attempt) { this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', prefix + row.run_id); continue; }
   const tokens = this.tokens(row.run_id, row.attempt);
   if (tokens !== null && tokens !== row.tokens) { row.tokens = tokens; row.active_at = nowIso; }
   if (row.nudged_at && row.active_at > row.nudged_at) row.nudged_at = null;
   const idle = now - Math.max(Date.parse(row.progress_at), Date.parse(row.active_at));
   if (idle > policy.noProgressMs && !row.nudged_at) {
    row.nudged_at = nowIso;
    const command = { schema_version: 1, type: 'run.steer', payload: { run_id: run.id, expected_attempt: row.attempt, text: NUDGE } };
    const key = `stuck-nudge:${run.id}:${row.attempt}`;
    // A refused nudge (e.g. an unknown effect is pending) still starts the grace period.
    try { this.core.accept('system', key, createHash('sha256').update(JSON.stringify(command)).digest('hex'), command); } catch { /* grace still applies */ }
   } else if (row.nudged_at && now - Date.parse(row.nudged_at) > policy.nudgeGraceMs) {
    this.store.db.transaction(() => {
     this.store.db.exec("UPDATE runs SET status='cancelling',error_code='STUCK_NO_PROGRESS',updated_at=? WHERE id=? AND status='running'", nowIso, run.id);
     this.store.event(this.core.options.uuid(), run.persona_id, 'run.cancellation_requested', 'system', run.command_id, { run_id: run.id, status: 'cancelling', reason: 'No progress; stopped by the stuck-task watchdog.' }, nowIso);
     const minutes = Math.round((policy.noProgressMs + policy.nudgeGraceMs) / 60000);
     this.store.event(this.core.options.uuid(), run.persona_id, 'notice', 'system', run.command_id, { kind: 'runtime', reason: 'STUCK_NO_PROGRESS', run_id: run.id,
      message: `${run.title ? `Task "${run.title}"` : 'A run'} made no progress for about ${minutes} min (even after a nudge) and was stopped. Retry it if it still matters.` }, nowIso);
     this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', prefix + run.id);
    });
    continue;
   }
   this.save(row);
  }
 }
}
