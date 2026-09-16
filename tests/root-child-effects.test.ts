import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { RootChildEffects, type RootChildEffectIntent, type RootChildEffectResult } from '../src/core/root-child-effects';
import type { ContextSnapshot, RunStatus } from '../src/core/types';
import { fixture, bot, otherBot, routine } from './helpers';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, native: NativeTaskLedger, boundary: RootChildEffects;
let root: string, child: string, sibling: string, grandchild: string;
const policy = 'connector:calendar-write';
function context(id: string, patch: Partial<ContextSnapshot>) {
 const current = JSON.parse(f.store.run(id).context_json) as ContextSnapshot;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?', JSON.stringify({ ...current, ...patch }), id);
}
function status(id: string, value: RunStatus) { f.db.exec('UPDATE runs SET status=? WHERE id=?', value, id); }
function spawn(parent: string, persona = bot) {
 const ref = randomUUID();
 const run = native.register(identity, { parent_run_id: parent, parent_attempt: 1, persona_id: persona,
  native_run_ref: ref, native_session_key: `synthetic:${ref}`, title: 'Synthetic descendant' });
 life.submitted(identity, run.id, 1, ref); return run.id;
}
function intent(id = child): RootChildEffectIntent {
 return { identity, root_run_id: root, root_attempt: 1, resources: ['calendar:z', 'browser:a'],
  effect: { id: randomUUID(), run_id: id, attempt: 1, action_key: randomUUID(), classification: 'mutation',
   authorization_ref: policy, request_digest: 'synthetic-request-73', provider_idempotency_key: null } };
}
function result(input: RootChildEffectIntent, state: RootChildEffectResult['status'], receipt: RootChildEffectResult['receipt'] = null): RootChildEffectResult {
 return { identity: input.identity, root_run_id: input.root_run_id, root_attempt: input.root_attempt,
  run_id: input.effect.run_id, attempt: input.effect.attempt, effect_id: input.effect.id, status: state, receipt };
}
const locks = () => f.db.all('SELECT resource_id,run_id,attempt FROM resource_locks ORDER BY resource_id');
const effects = () => f.db.all('SELECT * FROM effects ORDER BY id');
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));

beforeEach(() => {
 f = fixture(true); life = new LifecycleCore(f.store, f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=7,lease_until='2026-09-10T00:02:00.000Z'");
 identity = life.registerBoot(randomUUID()); life.ready(identity);
 root = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic root' } }).resource_id!;
 expect(life.claim(identity)?.run.id).toBe(root); life.submitted(identity, root, 1, 'root-native-19');
 context(root, { authorization_policy_ids: [policy, 'root-only'] });
 native = new NativeTaskLedger(f.store, f.core, life);
 child = spawn(root); context(child, { authorization_policy_ids: [policy] });
 sibling = spawn(root); grandchild = spawn(child);
 boundary = new RootChildEffects(f.store, f.core, life);
});
afterEach(() => f.close());

it('records child-owned intent and canonical locks after root completion; envelope binds original custody and request', () => {
 life.complete(identity, root, 1, { status: 'completed', text: 'Root result is not descendant settlement' });
 const input = intent(grandchild);
 const receipt = boundary.intent(input);
 expect(receipt).toEqual({ id: input.effect.id, status: 'intent' });
 expect(locks()).toEqual(input.resources.slice().sort().map(resource_id => ({ resource_id, run_id: grandchild, attempt: 1 })));
 const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const expected = `root-child-v1:${sha([7, identity.boot_id, root, 1, grandchild, 1])}:${sha(['synthetic-request-73', ['browser:a', 'calendar:z']])}`;
 expect(f.db.all<{ request_digest: string }>('SELECT request_digest FROM effects')[0].request_digest).toBe(expected);
 expect(f.store.run(root).status).toBe('completed'); expect(f.store.run(child).status).toBe('running');
 rejects(() => life.prepareSleep(identity), 'SLEEP_DENIED');
});

it('allows only admissible root states and running selected children', () => {
 for (const value of ['claimed', 'running', 'finishing', 'completed'] as const) {
  status(root, value); const input = intent(); input.resources = []; input.effect.classification = 'read_only'; expect(boundary.intent(input).status).toBe('intent');
 }
 const before = effects();
 for (const value of ['queued', 'waiting', 'failed', 'cancelling', 'cancelled', 'recovery_required'] as const) {
  status(root, value); rejects(() => boundary.intent(intent()), 'REVISION_CONFLICT');
 }
 status(root, 'running');
 for (const value of ['claimed', 'finishing', 'completed', 'waiting', 'failed', 'cancelling', 'cancelled', 'recovery_required'] as const) {
  status(child, value); rejects(() => boundary.intent(intent()), 'REVISION_CONFLICT');
 }
 expect(effects()).toEqual(before); expect(locks()).toEqual([]);
});

it('requires policy in both stored snapshots, not current persona configuration, with a read-only exception', () => {
 const input = intent();
 input.effect.authorization_ref = 'root-only'; rejects(() => boundary.intent(input), 'FORBIDDEN');
 context(child, { authorization_policy_ids: ['child-only'] }); input.effect.authorization_ref = 'child-only';
 rejects(() => boundary.intent(input), 'FORBIDDEN');
 context(root, { authorization_policy_ids: [] }); input.effect.classification = 'read_only'; input.resources = [];
 expect(boundary.intent(input).status).toBe('intent'); expect(locks()).toEqual([]);
 const mutation = intent(); mutation.effect.classification = 'idempotent';
 context(root, { authorization_policy_ids: [policy] }); context(child, { authorization_policy_ids: [policy] });
 rejects(() => boundary.intent(mutation), 'INVALID_INPUT');
 mutation.effect.provider_idempotency_key = 'provider-key-31'; expect(boundary.intent(mutation).status).toBe('intent');
});

it('rejects root-as-subject, unrelated trees, cross-persona and changed room/routine scope', () => {
 rejects(() => boundary.intent(intent(root)), 'FORBIDDEN');
 f.core.options.delegations = { [bot]: [otherBot] };
 const delegated = spawn(root, otherBot); rejects(() => boundary.intent(intent(delegated)), 'FORBIDDEN');
 life.complete(identity, root, 1, { status: 'completed', text: 'Coordinator finished' });
 const otherRoot = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Unrelated root' } }).resource_id!;
 expect(life.claim(identity)?.run.id).toBe(otherRoot);
 const unrelated = spawn(otherRoot); rejects(() => boundary.intent(intent(unrelated)), 'FORBIDDEN');
 context(sibling, { room_id: randomUUID(), scope_key: 'another-room' }); rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN');
 context(child, { scope_key: 'another-routine' }); rejects(() => boundary.intent(intent(grandchild)), 'FORBIDDEN');
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});

it('requires exact epoch, boot, lease, selected attempt and unchanged ancestor attempt', () => {
 const input = intent(grandchild);
 rejects(() => boundary.intent({ ...input, identity: { ...identity, epoch: 8 } }), 'STALE_EPOCH');
 rejects(() => boundary.intent({ ...input, identity: { ...identity, boot_id: randomUUID() } }), 'STALE_EPOCH');
 rejects(() => boundary.intent({ ...input, effect: { ...input.effect, attempt: 2 } }), 'STALE_EPOCH');
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', child);
 rejects(() => boundary.intent(input), 'STALE_EPOCH'); f.db.exec('UPDATE runs SET current_attempt=1 WHERE id=?', child);
 f.db.exec('UPDATE attempts SET boot_id=? WHERE run_id=?', randomUUID(), child);
 rejects(() => boundary.intent(input), 'STALE_EPOCH'); f.db.exec('UPDATE attempts SET boot_id=? WHERE run_id=?', identity.boot_id, child);
 f.setNow(life.get().lease_until!); rejects(() => boundary.intent(input), 'STALE_EPOCH');
 expect(effects()).toEqual([]);
});

it('accepts same-task room and routine snapshots but not a personal-scope sibling', () => {
 const scheduled = routine({ enabled: false });
 f.store.put(scheduled.id, 'routine', scheduled, 0, 'owner', f.core.now());
 const roomId = randomUUID();
 f.store.put(roomId, 'room', { id: roomId, expected_revision: 0, name: 'Synthetic room', member_ids: [bot], default_responder_id: bot }, 0, 'owner', f.core.now());
 for (const [routineId, conversationId] of [[scheduled.id, null], [null, roomId]]) {
  for (const id of [root, child, grandchild]) {
   f.db.exec('UPDATE runs SET routine_id=? WHERE id=?', routineId, id);
   context(id, f.core.context(bot, 'Synthetic scoped read', routineId, conversationId));
  }
  const input = intent(grandchild); input.effect.classification = 'read_only'; input.resources = [];
  expect(boundary.intent(input).status).toBe('intent');
  rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN');
 }
 expect(effects()).toHaveLength(2); expect(locks()).toEqual([]);
});

it('rejects missing links, mismatched native attempts, cycles and cancelling intermediate ancestry', () => {
 status(child, 'cancelling'); rejects(() => boundary.intent(intent(grandchild)), 'REVISION_CONFLICT'); status(child, 'running');
 f.db.exec("UPDATE attempts SET native_run_ref='wrong-ref' WHERE run_id=?", grandchild);
 rejects(() => boundary.intent(intent(grandchild)), 'FORBIDDEN');
 f.db.exec('UPDATE runs SET parent_run_id=? WHERE id=?', child, child);
 f.db.exec('UPDATE native_task_links SET parent_run_id=? WHERE run_id=?', child, child);
 rejects(() => boundary.intent(intent()), 'FORBIDDEN');
 f.db.exec('DELETE FROM native_task_links WHERE run_id=?', sibling);
 rejects(() => boundary.intent(intent(sibling)), 'FORBIDDEN'); expect(effects()).toEqual([]);
});

it('canonical replay preserves original ID and conflicts on resource set, digest, child, classification and custody changes', () => {
 const input = intent(); const original = boundary.intent(input), before = effects(), held = locks();
 expect(boundary.intent({ ...input, resources: [...input.resources].reverse(), effect: { ...input.effect, id: randomUUID() } })).toEqual(original);
 for (const changed of [{ ...input, resources: ['browser:a'] }, { ...input, effect: { ...input.effect, request_digest: 'changed-request' } },
  { ...input, effect: { ...input.effect, run_id: sibling } }, { ...input, effect: { ...input.effect, classification: 'read_only' as const } },
  { ...input, effect: { ...input.effect, authorization_ref: 'root-only' } }, { ...input, effect: { ...input.effect, provider_idempotency_key: 'other' } }]) {
  rejects(() => boundary.intent(changed), 'IDEMPOTENCY_CONFLICT');
 }
 // Even if all current ancestry attempts are changed consistently, old custody is not reusable.
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', root);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,2,'new-root-key',?,?,'running','2026-09-10T00:20:00.000Z')", root, identity.epoch, identity.boot_id);
 f.db.exec('UPDATE native_task_links SET parent_attempt=2 WHERE parent_run_id=?', root);
 rejects(() => boundary.intent({ ...input, root_attempt: 2 }), 'IDEMPOTENCY_CONFLICT');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), root_attempt: 2 }), 'FORBIDDEN');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held);
});

it('new and intent-replay contention rolls back every partial lock and new effect', () => {
 const input = intent();
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, ['calendar:z']);
 const held = locks(); rejects(() => boundary.intent(input), 'RESOURCE_BUSY');
 expect(effects()).toEqual([]); expect(locks()).toEqual(held);
 new ResourceLedger(f.store, () => f.core.now()).release(sibling, 1, ['calendar:z']);
 boundary.intent(input); const before = effects();
 rejects(() => new ResourceLedger(f.store, () => f.core.now()).release(child, 1, input.resources), 'OUTCOME_UNKNOWN');
 // Simulate missing locks in legacy/restored state, not a permitted release.
 f.db.exec('DELETE FROM resource_locks WHERE run_id=?', child);
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, ['calendar:z']);
 const contended = locks(); rejects(() => boundary.intent(input), 'RESOURCE_BUSY');
 expect(effects()).toEqual(before); expect(locks()).toEqual(contended);
});

it.each(['root', 'parent', 'child'] as const)('cancelling %s after intent fences descendant dispatch without changing locks or unrelated work', target => {
 const input = intent(grandchild); boundary.intent(input);
 const held = locks(), before = effects(), other = f.store.run(sibling);
 const id = target === 'root' ? root : target === 'parent' ? child : grandchild;
 expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Stop selected task' } }).status).toBe('applied');
 rejects(() => boundary.transition(result(input, 'dispatched')), 'REVISION_CONFLICT');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held); expect(f.store.run(sibling)).toEqual(other);
 boundary.transition(result(input, 'failed', { reason: 'not-dispatched' }));
 expect(effects()).toEqual([expect.objectContaining({ status: 'failed' })]); expect(locks()).toEqual(held);
});

it('unknown and terminal replay never reacquire or release locks, even while cancellation/recovery is pending', () => {
 const input = intent(); boundary.intent(input); const held = locks();
 boundary.transition(result(input, 'dispatched'));
 status(root, 'recovery_required'); status(child, 'cancelling');
 boundary.transition(result(input, 'outcome_unknown', { reason: 'synthetic lost acknowledgement' }));
 expect(boundary.intent(input)).toEqual({ id: input.effect.id, status: 'outcome_unknown' }); expect(locks()).toEqual(held);
 rejects(() => life.complete(identity, child, 1, { status: 'cancelled', text: '' }), 'RESOURCE_BUSY');
 // Simulate legacy lock loss; replay must not take locks back or dispatch again.
 rejects(() => new ResourceLedger(f.store, () => f.core.now()).release(child, 1, input.resources), 'OUTCOME_UNKNOWN');
 f.db.exec('DELETE FROM resource_locks WHERE run_id=?', child);
 new ResourceLedger(f.store, () => f.core.now()).acquire(sibling, 1, input.resources);
 const differentOwner = locks(); expect(boundary.intent(input).status).toBe('outcome_unknown');
 rejects(() => boundary.transition(result(input, 'confirmed', {})), 'INVALID_INPUT');
 boundary.transition(result(input, 'confirmed', { destination_id: 'synthetic-receipt-97' }));
 const before = effects(); expect(boundary.intent({ ...input, effect: { ...input.effect, id: randomUUID() } })).toEqual({ id: input.effect.id, status: 'confirmed' });
 boundary.transition(result(input, 'confirmed', { ignored_duplicate: true }));
 expect(effects()).toEqual(before); expect(locks()).toEqual(differentOwner);
 expect(f.store.run(child).status).toBe('cancelling'); expect(f.store.run(root).status).toBe('recovery_required');
});

it('transition cannot target sibling, generic ledger records or stale attempts and keeps receipt validation', () => {
 const input = intent(grandchild); boundary.intent(input); const before = effects(), held = locks();
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), run_id: sibling }), 'FORBIDDEN');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), attempt: 2 }), 'STALE_EPOCH');
 rejects(() => boundary.transition({ ...result(input, 'outcome_unknown'), identity: { ...identity, epoch: 8 } }), 'STALE_EPOCH');
 rejects(() => boundary.transition(result(input, 'confirmed', { not_a_valid_transition: true })), 'REVISION_CONFLICT');
 rejects(() => boundary.transition(result(input, 'failed')), 'INVALID_INPUT');
 expect(effects()).toEqual(before); expect(locks()).toEqual(held);
 f.db.exec("UPDATE effects SET request_digest='generic-effect-digest' WHERE id=?", input.effect.id);
 rejects(() => boundary.transition(result(input, 'outcome_unknown')), 'FORBIDDEN');
});

it('deadline expiry denies new work but permits exact reconciliation with a current lease', () => {
 const input = intent(); boundary.intent(input);
 f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:20.000Z' WHERE run_id=?", root);
 f.setNow('2026-09-10T00:00:20.000Z');
 rejects(() => boundary.intent(intent(sibling)), 'DEADLINE_EXCEEDED');
 rejects(() => boundary.intent(input), 'DEADLINE_EXCEEDED');
 boundary.transition(result(input, 'outcome_unknown')); expect(boundary.intent(input).status).toBe('outcome_unknown');
 expect(locks()).toHaveLength(2);
});

it('invalid or duplicated resource sets and oversized digests never leave intent rows', () => {
 const input = intent();
 for (const resources of [[], ['same', 'same'], ['has space'], Array.from({ length: 9 }, (_, i) => `resource:${i}`)]) {
  rejects(() => boundary.intent({ ...input, resources }), 'INVALID_INPUT');
 }
 rejects(() => boundary.intent({ ...input, resources: [], effect: { ...input.effect, classification: 'idempotent', provider_idempotency_key: 'synthetic-key' } }), 'INVALID_INPUT');
 rejects(() => boundary.intent({ ...input, effect: { ...input.effect, request_digest: 'x'.repeat(257) } }), 'INVALID_INPUT');
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});
