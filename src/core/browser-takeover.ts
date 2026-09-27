import { requireThat } from './errors';
import type { ControlCore } from './control';
import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';

/** Owner browser takeover (docs/BROWSER_TAKEOVER.md). The Worker only records
 * the request, posts the owner notice and relays frames between the runtime's
 * outbound socket and one owner viewer. It never drives the browser itself. */
export type TakeoverOutcome = 'handed_back' | 'cancelled' | 'timeout' | 'failed';
export type TakeoverRecord = { id: string; run_id: string; attempt: number; persona_id: string; epoch: number; boot_id: string; reason: string;
 status: 'waiting' | 'ended'; created_at: string; expires_at: string; outcome: TakeoverOutcome | null };
const prefix = 'browser-takeover:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Viewer → runtime input frames. Mirrors runtime/browser-takeover.mjs
// validateTakeoverInput (tests/browser-takeover.test.ts runs both on the same
// vectors). Only input events, a restricted http(s) URL bar, hand-back and
// cancel exist; nothing can run script or open file:// URLs.
export const TAKEOVER_NAMED_KEYS = Object.freeze(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta']);
export const TAKEOVER_MAX_INPUT_BYTES = 4096;
export type TakeoverInput =
 | { t: 'mouse'; type: 'down' | 'up' | 'move'; x: number; y: number; button: 'left' | 'right' | 'middle' | 'none'; clicks: number; mods: number }
 | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
 | { t: 'key'; type: 'down' | 'up'; key: string; mods: number }
 | { t: 'text'; text: string }
 | { t: 'navigate'; url: string }
 | { t: 'handback' } | { t: 'cancel' };
const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const mods = (v: unknown) => v === undefined || Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 15;
const exact = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every(k => keys.includes(k));
export function validateTakeoverInput(raw: unknown): TakeoverInput | null {
 let v: unknown = raw;
 if (typeof raw === 'string') {
  if (raw.length > TAKEOVER_MAX_INPUT_BYTES) return null;
  try { v = JSON.parse(raw); } catch { return null; }
 }
 if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
 const o = v as Record<string, unknown>;
 switch (o.t) {
  case 'mouse':
   if (!exact(o, ['t', 'type', 'x', 'y', 'button', 'clicks', 'mods']) || !['down', 'up', 'move'].includes(o.type as string) || !unit(o.x) || !unit(o.y) ||
    !['left', 'right', 'middle', 'none', undefined].includes(o.button as string) || !(o.clicks === undefined || Number.isInteger(o.clicks) && (o.clicks as number) >= 0 && (o.clicks as number) <= 3) || !mods(o.mods)) return null;
   return { t: 'mouse', type: o.type as 'down', x: o.x as number, y: o.y as number, button: (o.button ?? (o.type === 'move' ? 'none' : 'left')) as 'left', clicks: (o.clicks ?? (o.type === 'move' ? 0 : 1)) as number, mods: (o.mods ?? 0) as number };
  case 'wheel':
   if (!exact(o, ['t', 'x', 'y', 'dx', 'dy']) || !unit(o.x) || !unit(o.y) || ![o.dx ?? 0, o.dy ?? 0].every(d => typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= 5000)) return null;
   return { t: 'wheel', x: o.x as number, y: o.y as number, dx: (o.dx ?? 0) as number, dy: (o.dy ?? 0) as number };
  case 'key':
   if (!exact(o, ['t', 'type', 'key', 'mods']) || !['down', 'up'].includes(o.type as string) || typeof o.key !== 'string' || !mods(o.mods)) return null;
   if (!TAKEOVER_NAMED_KEYS.includes(o.key) && !(Array.from(o.key).length === 1 && !/[\p{Cc}\p{Cf}]/u.test(o.key))) return null;
   return { t: 'key', type: o.type as 'down', key: o.key, mods: (o.mods ?? 0) as number };
  case 'text':
   if (!exact(o, ['t', 'text']) || typeof o.text !== 'string' || !o.text.length || o.text.length > 1000 || /[\p{Cc}]/u.test(o.text.replace(/\n/g, ''))) return null;
   return { t: 'text', text: o.text };
  case 'navigate': {
   if (!exact(o, ['t', 'url']) || typeof o.url !== 'string' || o.url.length > 2048) return null;
   let url: URL; try { url = new URL(o.url); } catch { return null; }
   if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
   return { t: 'navigate', url: url.href };
  }
  case 'handback': case 'cancel':
   return exact(o, ['t']) ? { t: o.t } : null;
  default: return null;
 }
}

export class BrowserTakeovers {
 constructor(private store: Store, private core: ControlCore) {}
 get(id: string): TakeoverRecord | null {
  if (!UUID.test(id)) return null;
  const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', prefix + id)[0];
  return row ? JSON.parse(row.value_json) as TakeoverRecord : null;
 }
 private save(record: TakeoverRecord) {
  this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', prefix + record.id, JSON.stringify(record));
 }
 /** Viewable: waiting, unexpired, and its attempt is still the run's current
  * running attempt. */
 live(id: string): TakeoverRecord | null {
  const record = this.get(id);
  if (!record || record.status !== 'waiting' || record.expires_at <= this.core.now()) return null;
  const run = this.store.db.all<{ status: string; current_attempt: number }>('SELECT status,current_attempt FROM runs WHERE id=?', record.run_id)[0];
  return run && run.status === 'running' && run.current_attempt === record.attempt ? record : null;
 }
 open(identity: Identity, input: { run_id: string; attempt: number; takeover_id: string; reason?: string; timeout_ms?: number }, lifecycle: LifecycleCore): { takeover_id: string; expires_at: string } {
  requireThat(typeof input.reason === 'string' && Number.isInteger(input.timeout_ms), 'INVALID_INPUT', 'A takeover needs a reason and a timeout.', 422);
  return this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, input.run_id, input.attempt);
   const run = this.store.db.all<{ status: string; current_attempt: number; persona_id: string; command_id: string | null; title: string | null }>(
    'SELECT status,current_attempt,persona_id,command_id,title FROM runs WHERE id=?', input.run_id)[0];
   requireThat(run && run.status === 'running' && run.current_attempt === input.attempt, 'REVISION_CONFLICT', 'Only a running attempt can ask for the browser.', 409);
   const existing = this.get(input.takeover_id);
   if (existing) {
    requireThat(existing.run_id === input.run_id && existing.attempt === input.attempt, 'REVISION_CONFLICT', 'Takeover id is taken.', 409);
    return { takeover_id: existing.id, expires_at: existing.expires_at };
   }
   const open = this.store.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM runtime_metadata WHERE key GLOB 'browser-takeover:*' AND json_extract(value_json,'$.run_id')=? AND json_extract(value_json,'$.attempt')=?", input.run_id, input.attempt)[0].n;
   requireThat(open < 5, 'RATE_LIMITED', 'This attempt already asked for the browser too often.', 429);
   const now = this.core.now();
   // Keep the table small: ended/expired records older than a day go.
   this.store.db.exec("DELETE FROM runtime_metadata WHERE key GLOB 'browser-takeover:*' AND json_extract(value_json,'$.expires_at')<?", new Date(Date.parse(now) - 86400000).toISOString());
   const record: TakeoverRecord = { id: input.takeover_id, run_id: input.run_id, attempt: input.attempt, persona_id: run.persona_id, epoch: identity.epoch, boot_id: identity.boot_id,
    reason: input.reason!, status: 'waiting', created_at: now, expires_at: new Date(Date.parse(now) + input.timeout_ms!).toISOString(), outcome: null };
   this.save(record);
   const persona = this.store.db.all<{ body_json: string }>("SELECT body_json FROM objects WHERE id=? AND kind='persona'", run.persona_id)[0];
   const name = persona ? (JSON.parse(persona.body_json) as { name?: string }).name : undefined;
   this.store.event(this.core.options.uuid(), run.persona_id, 'notice', 'system', run.command_id, { kind: 'needs_you', reason: 'BROWSER_TAKEOVER', run_id: input.run_id, attempt: input.attempt,
    persona_id: run.persona_id, takeover_id: record.id, expires_at: record.expires_at, detail: record.reason,
    message: `${name ?? 'A bot'}${run.title ? ` (task "${run.title}")` : ''} needs you in its browser: ${record.reason}` }, now);
   return { takeover_id: record.id, expires_at: record.expires_at };
  });
 }
 end(identity: Identity, input: { run_id: string; attempt: number; takeover_id: string; outcome?: TakeoverOutcome }, lifecycle: LifecycleCore): { ended: boolean } {
  requireThat(typeof input.outcome === 'string', 'INVALID_INPUT', 'An ended takeover needs an outcome.', 422);
  return this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, input.run_id, input.attempt);
   const record = this.get(input.takeover_id);
   requireThat(record && record.run_id === input.run_id && record.attempt === input.attempt, 'NOT_FOUND', 'Takeover unavailable.', 404);
   if (record.status === 'ended') return { ended: false };
   this.close(record, input.outcome!);
   return { ended: true };
  });
 }
 private close(record: TakeoverRecord, outcome: TakeoverOutcome) {
  const now = this.core.now();
  this.save({ ...record, status: 'ended', outcome, expires_at: record.expires_at < now ? record.expires_at : now });
  const text = { handed_back: 'You handed the browser back to the bot.', cancelled: 'Browser takeover cancelled.', timeout: 'Browser takeover timed out; the bot stopped waiting.', failed: 'Browser takeover ended (the browser is unavailable).' }[outcome];
  this.store.event(this.core.options.uuid(), record.persona_id, 'notice', 'system', null, { kind: 'runtime', reason: 'BROWSER_TAKEOVER_ENDED', run_id: record.run_id, takeover_id: record.id, outcome, message: text }, now);
 }
}
