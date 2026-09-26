// G2 (GROK_ALIGNMENT A2/A3, AGENTS.md traps 1/2/3/4/7): the five behavioral
// scenarios the G2 checkpoint requires, exercised end to end rather than as
// unit-level variants of invariants already proven elsewhere.
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { BotMessages } from '../src/core/bot-messages';

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

it('scenario 1: kill mid-turn abandons never-dispatched intents, leaves dispatched ones unknown, and holds locks', () => {
 const { life, runId } = running();
 f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)', 'external-record', runId, f.core.now());
 const neverDispatched = randomUUID(), dispatched = randomUUID();
 f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','intent','policy','digest-1',?)", neverDispatched, runId, randomUUID(), f.core.now());
 f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest-2',?)", dispatched, runId, randomUUID(), f.core.now());
 // A boot-lease loss (no confirmed provider-termination proof) interrupts the attempt directly.
 f.setNow('2026-09-10T08:02:00.000Z'); life.watchdog();
 expect(f.store.run(runId).status).toBe('interrupted');
 expect(f.db.all('SELECT id,status,receipt_json FROM effects WHERE id=?', neverDispatched))
  .toEqual([{ id: neverDispatched, status: 'failed', receipt_json: JSON.stringify({ kind: 'abandoned_interrupted' }) }]);
 expect(f.db.all('SELECT id,status FROM effects WHERE id=?', dispatched)).toEqual([{ id: dispatched, status: 'outcome_unknown' }]);
 expect(f.db.all('SELECT resource_id FROM resource_locks WHERE run_id=?', runId)).toEqual([{ resource_id: 'external-record' }]);
});

it('scenario 2: a read-only run with no unknowns auto-retries with a seeded continuation carrying delivered messages', () => {
 // Interrupted via the deadline-then-unconfirmed-cancellation-grace site
 // (a neutral, retry-eligible reason) rather than an owner-directed cancel
 // (OWNER_CANCELLED is deliberately never auto-retried) or the boot-lease
 // site (which also closes the whole lifecycle for new claims) -- isolating
 // the retry/continuation behavior under test.
 const { life, identity, runId } = running();
 const messages = new BotMessages(f.store, () => f.core.now(), () => randomUUID());
 messages.post(identity, { run_id: runId, attempt: 1, message_key: `${runId}:1:a`, text: 'Working on it...' }, life);
 f.db.exec("UPDATE attempts SET deadline_at=? WHERE run_id=? AND attempt=1", '2026-09-10T08:00:05.000Z', runId);
 f.setNow('2026-09-10T08:00:05.000Z'); life.watchdog();
 expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED' });
 f.setNow('2026-09-10T08:00:35.000Z'); life.watchdog();
 expect(f.store.run(runId)).toMatchObject({ status: 'waiting', error_code: 'CANCEL_UNCONFIRMED' });
 f.setNow('2026-09-10T08:00:45.000Z'); life.retryDue();
 expect(f.store.run(runId)).toMatchObject({ status: 'queued', current_attempt: 1 });
 const reclaim = life.claim(identity)!;
 life.submitted(identity, reclaim.run.id, 2, 'native-2');
 const context = JSON.parse(reclaim.run.context_json);
 expect(context.continuation).toEqual({ previous_attempt: 1, reason: 'CANCEL_UNCONFIRMED', delivered_messages: ['Working on it...'] });
 // A second interruption schedules a second (still allowed, attempt<3) auto-retry.
 f.db.exec("UPDATE attempts SET deadline_at=? WHERE run_id=? AND attempt=2", '2026-09-10T08:01:00.000Z', runId);
 f.setNow('2026-09-10T08:01:00.000Z'); life.watchdog();
 f.setNow('2026-09-10T08:01:30.000Z'); life.watchdog();
 expect(f.store.run(runId)).toMatchObject({ status: 'waiting', current_attempt: 2 });
 // A retried attempt beyond the first backs off 60s, not 10s.
 f.setNow('2026-09-10T08:02:31.000Z'); life.retryDue();
 expect(f.store.run(runId)).toMatchObject({ status: 'queued', current_attempt: 2 });
});

it('scenario 3: an outcome_unknown effect blocks auto-retry and raises an owner-visible needs_you notice', () => {
 const { life, runId } = running();
 const effectId = randomUUID();
 f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)", effectId, runId, randomUUID(), f.core.now());
 f.setNow('2026-09-10T08:02:00.000Z'); life.watchdog();
 expect(f.store.run(runId).status).toBe('interrupted');
 expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
 const notices = f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='notice'");
 expect(notices).toHaveLength(1);
 expect(JSON.parse(notices[0].payload_json)).toMatchObject({ kind: 'needs_you', run_id: runId, choices: ['reconcile', 'retry', 'abandon'] });
 expect(JSON.parse(notices[0].payload_json).effect_ids).toEqual([effectId]);
 // The three choices are wired to existing commands: reconcile the effect...
 expect(f.accept({ schema_version: 1, type: 'effect.reconcile', payload: { run_id: runId, effect_id: effectId, expected_attempt: 1, expected_request_digest: 'digest', outcome: 'confirmed', evidence_ref: 'evidence-1' } }).status).toBe('applied');
 expect(f.db.all('SELECT status FROM effects WHERE id=?', effectId)).toEqual([{ status: 'confirmed' }]);
});

it('scenario 4: sleep is honest -- false with a live current-generation attempt, true once only dead-generation records remain', () => {
 const { life, identity, runId } = running();
 // A live running attempt of the current generation blocks sleep outright.
 expect(() => life.prepareSleep(identity)).toThrow(expect.objectContaining({ code: 'SLEEP_DENIED' }));
 // Interrupted via the deadline-then-unconfirmed-cancellation-grace site (not
 // an owner-directed cancel, and not the boot-lease site), so the runtime's
 // own lease/phase stay untouched -- isolating the sleep predicate itself.
 f.db.exec("UPDATE attempts SET deadline_at=? WHERE run_id=? AND attempt=1", '2026-09-10T08:00:05.000Z', runId);
 f.setNow('2026-09-10T08:00:05.000Z'); life.watchdog();
 f.setNow('2026-09-10T08:00:35.000Z'); life.watchdog();
 // Read-only with no unresolved custody: auto-retried immediately, leaving
 // only a dead-generation attempt record behind for the old boot.
 expect(f.store.run(runId).status).toBe('waiting');
 f.setNow('2026-09-10T08:01:00.000Z'); life.heartbeat(identity, []);
 const stop = life.prepareSleep(identity);
 life.commitSleep(identity, stop.stop_token, stop.queue_sequence, { marker: 'ok' });
 expect(life.get().phase).toBe('STOP_COMMITTED');
});

it('scenario 5: a bot.message committed by the interrupted attempt stays final in the timeline', () => {
 const { life, identity, runId } = running();
 const messages = new BotMessages(f.store, () => f.core.now(), () => randomUUID());
 const receipt = messages.post(identity, { run_id: runId, attempt: 1, message_key: `${runId}:1:final`, text: 'Here is what I found.' }, life);
 // A dispatched-and-unresolved effect keeps the attempt genuinely terminal
 // (no auto-retry masking it back into 'waiting') so this checks the message
 // survives exactly the interrupted state, not an incidental retry.
 f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)", randomUUID(), runId, randomUUID(), f.core.now());
 f.setNow('2026-09-10T08:02:00.000Z'); life.watchdog();
 expect(f.store.run(runId).status).toBe('interrupted');
 const event = f.db.all<{ id: string; type: string; payload_json: string }>('SELECT id,type,payload_json FROM events WHERE id=?', receipt.event_id)[0];
 expect(event.type).toBe('bot.message');
 expect(JSON.parse(event.payload_json).text).toBe('Here is what I found.');
});
