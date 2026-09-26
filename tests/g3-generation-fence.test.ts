// G3 (GROK_ALIGNMENT A2, AGENTS.md trap 1): generation fencing and successor
// start without process-death proof. `advanceGeneration` atomically bumps the
// epoch and fences the retiring generation in one transaction; every runtime
// RPC choke point rejects a stale (epoch,boot_id) with STALE_EPOCH; a
// successor may boot from RECOVERY_REQUIRED even while the provider still
// reports the prior process running.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { BotMessages } from '../src/core/bot-messages';
import { OutputPreviews } from '../src/core/output-preview';
import { FakeProvider, type RuntimeRef } from '../src/providers';

let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());

function running() {
 f = fixture(true);
 const life = new LifecycleCore(f.store, f.core), boot = randomUUID();
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until=?", '2026-09-10T08:02:00.000Z');
 f.setNow('2026-09-10T08:00:00.000Z');
 const identity = life.registerBoot(boot);
 life.ready(identity);
 f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Read-only test.' } });
 const claim = life.claim(identity)!;
 life.submitted(identity, claim.run.id, 1, 'native');
 return { life, identity, runId: claim.run.id };
}

describe('advanceGeneration', () => {
 it('refuses to advance from a live READY runtime with an unexpired lease', () => {
  const { life } = running();
  expect(() => life.advanceGeneration('GENERATION_ADVANCED')).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }));
 });
 it('atomically bumps the epoch and fences the retiring generation, in one transaction, from RECOVERY_REQUIRED', () => {
  const { life, identity, runId } = running();
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  const { epoch } = life.advanceGeneration('GENERATION_ADVANCED');
  expect(epoch).toBe(identity.epoch + 1);
  const state = life.get();
  expect(state).toMatchObject({ epoch, phase: 'BOOTING', boot_id: null });
  // The prior generation's live run was fenced in the SAME call, not left for
  // a later reconciliation pass.
  expect(f.store.run(runId)).toMatchObject({ status: 'interrupted', error_code: 'GENERATION_ADVANCED' });
 });
 it('is idempotent when the prior generation was already fenced (e.g. by watchdog on lease loss)', () => {
  const { life, runId } = running();
  // A dispatched-and-unresolved effect keeps the fenced attempt genuinely
  // terminal (no auto-retry masking it back into 'waiting'), isolating the
  // re-fencing idempotency this test checks.
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)", randomUUID(), runId, randomUUID(), f.core.now());
  f.setNow('2026-09-10T08:02:00.000Z'); life.watchdog();
  expect(f.store.run(runId).status).toBe('interrupted');
  const before = f.store.run(runId);
  const { epoch } = life.advanceGeneration('GENERATION_ADVANCED');
  expect(epoch).toBe(2);
  expect(f.store.run(runId)).toEqual(before); // re-fencing an already-terminal run is a no-op.
 });
 it('refuses to advance a staged owner-alpha generation (its own authorization path governs successor start)', () => {
  f = fixture(true);
  const life = new LifecycleCore(f.store, f.core);
  Object.defineProperty(f.core.ownerAlpha, 'policy', { value: { session_id: randomUUID() }, configurable: true });
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  expect(() => life.advanceGeneration('GENERATION_ADVANCED')).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }));
 });
});

describe('G-A2: every runtime RPC choke point rejects a stale generation after an advance', () => {
 it('rejects the old (epoch,boot_id) across the full RPC surface, while the new generation is admitted', () => {
  const { life, identity, runId } = running();
  const messages = new BotMessages(f.store, () => f.core.now(), () => randomUUID());
  const previews = new OutputPreviews(f.store, () => f.core.now());
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  const { epoch } = life.advanceGeneration('GENERATION_ADVANCED');
  const stale: Identity = identity;
  // Table-driven: every distinct runtime RPC choke point the runtime uses,
  // exercised with the now-retired identity. Each must reject STALE_EPOCH.
  const cases: Array<[string, () => void]> = [
   ['heartbeat', () => life.heartbeat(stale, [])],
   ['claim (coordinator lane)', () => { life.claim(stale); }],
   ['claim (background lane)', () => { life.claim(stale, undefined, undefined, [], 'background'); }],
   ['submitted', () => life.submitted(stale, runId, 1, 'native-2')],
   ['coordinator-release', () => life.coordinatorRelease(stale, runId, 1, 'native', 'completed')],
   ['complete', () => life.complete(stale, runId, 1, { status: 'completed', text: 'late' })],
   ['prepareMemory', () => { life.prepareMemory(stale, {}); }],
   ['prepareSleep', () => life.prepareSleep(stale)],
   ['authorizeAttempt (effect-intent/effect-result/resource-acquire/budget-report choke point)', () => life.authorizeAttempt(stale, runId, 1)],
   ['bot-message', () => messages.post(stale, { run_id: runId, attempt: 1, message_key: `${runId}:1:stale`, text: 'stale' }, life)],
   ['output-preview', () => previews.record(stale, { run_id: runId, attempt: 1, version: 1, text: 'stale', truncated: false, native_ref: 'native' }, life)],
  ];
  for (const [name, invoke] of cases) {
   expect(invoke, name).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  }
  // The new generation is unaffected and may proceed once it boots.
  const nextIdentity = life.registerBoot(randomUUID());
  expect(nextIdentity.epoch).toBe(epoch);
  life.ready(nextIdentity);
  expect(life.claim(nextIdentity)).toBeNull(); // no fresh queued work yet, but no STALE_EPOCH either.
 });
 it('rejects an old-generation bot-message, but its already-committed message stays in the timeline', () => {
  const { life, identity, runId } = running();
  const messages = new BotMessages(f.store, () => f.core.now(), () => randomUUID());
  const receipt = messages.post(identity, { run_id: runId, attempt: 1, message_key: `${runId}:1:final`, text: 'Committed before the advance.' }, life);
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  life.advanceGeneration('GENERATION_ADVANCED');
  expect(() => messages.post(identity, { run_id: runId, attempt: 1, message_key: `${runId}:1:late`, text: 'Too late.' }, life))
   .toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  const event = f.db.all<{ type: string; payload_json: string }>('SELECT type,payload_json FROM events WHERE id=?', receipt.event_id)[0];
  expect(event.type).toBe('bot.message');
  expect(JSON.parse(event.payload_json).text).toBe('Committed before the advance.');
 });
});

describe('G2 follow-up: seeded continuation lists unknown_effects', () => {
 it('a re-seeded attempt carries its own outcome_unknown effects for the model to reconcile before redoing them', () => {
  const { life, identity, runId } = running();
  const effectId = randomUUID();
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)", effectId, runId, 'send-payment', f.core.now());
  f.db.exec("UPDATE effects SET status='outcome_unknown' WHERE id=?", effectId);
  // Force a retryable interruption (not the owner-cancel/context-invalidated
  // path) whose scheduleRetry would normally decline solely because of the
  // unresolved effect -- so we seed the retry directly to isolate the
  // continuation-building logic in claim() from scheduleRetry's own gating.
  f.db.exec("UPDATE runs SET status='queued',error_code='STALE_EPOCH' WHERE id=?", runId);
  const reclaim = life.claim(identity)!;
  const context = JSON.parse(reclaim.run.context_json);
  expect(context.continuation.reason).toBe('STALE_EPOCH');
  expect(context.continuation.unknown_effects).toEqual([{ effect_id: effectId, kind: 'send-payment' }]);
 });
 it('omits unknown_effects entirely when there is nothing left to reconcile', () => {
  const { life, identity, runId } = running();
  f.db.exec("UPDATE runs SET status='queued',error_code='CANCEL_UNCONFIRMED' WHERE id=?", runId);
  const reclaim = life.claim(identity)!;
  const context = JSON.parse(reclaim.run.context_json);
  expect(context.continuation.unknown_effects).toBeUndefined();
 });
});

describe('successor boot without observeStopped', () => {
 it('drive() advances the generation and requests a wake from RECOVERY_REQUIRED even while the provider still reports the prior process running', async () => {
  const { life, runId } = running();
  const ref: RuntimeRef = { provider: 'fake', id: 'synthetic-runtime' };
  f.db.exec('UPDATE lifecycle SET provider_ref_json=?', JSON.stringify(ref));
  const provider = new FakeProvider();
  provider.setPhase(ref, 'running'); // the prior process is NOT confirmed stopped.
  // Queue fresh work so the successor has something to claim, and put the
  // runtime into RECOVERY_REQUIRED the same way a lost boot lease does.
  f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'New work for the successor.' } });
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  await life.drive(provider);
  // No `stop` was requested and no stop observation occurred -- the successor
  // boots purely off the atomic epoch fence.
  expect(provider.calls.map(c => c.action)).toEqual(['wake']);
  const state = life.get();
  expect(state).toMatchObject({ phase: 'BOOTING', epoch: 2 });
  // The prior generation's live run is now terminal, not silently forgotten.
  expect(f.store.run(runId)).toMatchObject({ status: 'interrupted', error_code: 'GENERATION_ADVANCED' });
  const nextBoot = life.registerBoot(randomUUID());
  life.ready(nextBoot);
  const nextClaim = life.claim(nextBoot);
  expect(nextClaim).not.toBeNull();
  expect(nextClaim!.run.id).not.toBe(runId);
 });
});
