import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Store, type Database, type SqlValue } from '../src/core/store';
import { ControlCore, DEFAULT_BOTS } from '../src/core/control';
import type { Command, RoutinePut } from '../src/core/types';

export class TestDatabase implements Database {
  readonly sqlite: DatabaseSync;
  private transactionDepth = 0;
  constructor(existing?: DatabaseSync) {
    this.sqlite = existing ?? new DatabaseSync(':memory:');
    if (!existing) this.sqlite.exec(readFileSync(new URL('../DB/schema.sql', import.meta.url), 'utf8'));
  }
  all<T>(sql: string, ...values: SqlValue[]): T[] { return this.sqlite.prepare(sql).all(...values) as T[]; }
  exec(sql: string, ...values: SqlValue[]): void { this.sqlite.prepare(sql).run(...values); }
  transaction<T>(fn: () => T): T {
    const name = `test_tx_${this.transactionDepth++}`;
    this.sqlite.exec(`SAVEPOINT ${name}`);
    try { const result = fn(); this.sqlite.exec(`RELEASE SAVEPOINT ${name}`); return result; }
    catch (error) { this.sqlite.exec(`ROLLBACK TO SAVEPOINT ${name}`); this.sqlite.exec(`RELEASE SAVEPOINT ${name}`); throw error; }
    finally { this.transactionDepth--; }
  }
  close(): void { this.sqlite.close(); }
}
export function fixture(executionEnabled = false) {
  let clock = new Date('2026-09-10T00:00:00.000Z');
  const db = new TestDatabase();
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state) VALUES(1,'{}','STOPPED','STOP')");
  const store = new Store(db);
  const core = new ControlCore(store, { executionEnabled, actionPolicyIds: [], toolPolicyIds: [], now: () => new Date(clock), uuid: randomUUID });
  core.seed();
  return { db, store, core, setNow(value: string) { clock = new Date(value); },
    accept(command: Command, key = randomUUID()) {
      return core.accept('owner', key, createHash('sha256').update(JSON.stringify(command)).digest('hex'), command);
    }, close() { db.close(); } };
}
export const bot = DEFAULT_BOTS[0].id;
export const otherBot = DEFAULT_BOTS[1].id;
export function routine(overrides: Partial<RoutinePut> = {}): RoutinePut {
  return { id: randomUUID(), expected_revision: 0, persona_id: bot, name: 'Synthetic routine', instructions: 'Read synthetic data.',
    schedule: { cron: '*/15 * * * *', timezone: 'UTC' }, trigger_source_id: null, enabled: true,
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 86400 }, action_policy_ids: [], ...overrides };
}
