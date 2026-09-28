import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { TestDatabase } from './helpers';
import { Store } from '../src/core/store';
import { ControlCore, parseCommand } from '../src/core/control';
import type { Command } from '../src/core/types';

const now = '2026-09-28T12:00:00.000Z';
const valid = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };

function setup(vapidPublicKey?: string) {
  const db = new TestDatabase();
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state) VALUES(1,'{}','STOPPED','STOP')");
  const store = new Store(db);
  const core = new ControlCore(store, { executionEnabled: false, actionPolicyIds: [], toolPolicyIds: [], vapidPublicKey, now: () => new Date(now), uuid: randomUUID });
  core.seed();
  const accept = (command: Command, key = randomUUID()) => core.accept('owner', key, createHash('sha256').update(JSON.stringify(command)).digest('hex'), command);
  return { db, store, core, accept };
}

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

it('rejects push.subscribe with CAPABILITY_UNAVAILABLE when no VAPID key is configured', () => {
  const { accept, db } = setup(undefined);
  cleanup = () => db.close();
  const receipt = accept({ schema_version: 1, type: 'push.subscribe', payload: valid });
  expect(receipt.status).toBe('rejected');
  expect(receipt.error?.code).toBe('CAPABILITY_UNAVAILABLE');
});

it('accepts push.subscribe once a VAPID public key is configured, and reflects it in state().settings.push', () => {
  const { accept, core, db } = setup('PUBLICKEYBASE64URL');
  cleanup = () => db.close();
  const receipt = accept({ schema_version: 1, type: 'push.subscribe', payload: valid });
  expect(receipt.status).toBe('applied');
  const state = core.state();
  expect(state.settings.push).toEqual({ public_key: 'PUBLICKEYBASE64URL', subscribed_endpoints_count: 1 });
});

it('omits settings.push entirely when push is unconfigured (the portal hides its toggle on this)', () => {
  const { core, db } = setup(undefined);
  cleanup = () => db.close();
  expect(core.state().settings.push).toBeUndefined();
});

it('push.unsubscribe works even when push is unconfigured, and is idempotent', () => {
  const { accept, core, db } = setup('KEY');
  cleanup = () => db.close();
  accept({ schema_version: 1, type: 'push.subscribe', payload: valid });
  expect(core.state().settings.push?.subscribed_endpoints_count).toBe(1);
  const receipt = accept({ schema_version: 1, type: 'push.unsubscribe', payload: { endpoint: valid.endpoint } });
  expect(receipt.status).toBe('applied');
  expect(core.state().settings.push?.subscribed_endpoints_count).toBe(0);
  const again = accept({ schema_version: 1, type: 'push.unsubscribe', payload: { endpoint: valid.endpoint } }, randomUUID());
  expect(again.status).toBe('applied');
});

it('rejects a malformed subscription payload with INVALID_INPUT via the schema/command validator (parseCommand throws, matching every other command type)', () => {
  const command = { schema_version: 1, type: 'push.subscribe', payload: { endpoint: 'not-a-url', keys: valid.keys } } as unknown as Command;
  expect(() => parseCommand(command)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
