import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot, RoomPut } from '../src/core/types';
import { bot, fixture, otherBot, routine } from './helpers';

let f: ReturnType<typeof fixture>;

beforeEach(() => { f = fixture(); });
afterEach(() => f.close());

function addBackground(title: string, context: ContextSnapshot | Record<string, unknown>, updatedAt: string) {
  const id = randomUUID();
  f.db.exec(
    `INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at,role,title)
     VALUES(?,?,?,'running',1,?,?, 'background',?)`,
    id, (context as ContextSnapshot).persona?.id ?? bot, JSON.stringify(context), updatedAt, updatedAt, title,
  );
  return id;
}

function addRoom(name: string) {
  const room: RoomPut = {
    id: randomUUID(), expected_revision: 0, name,
    member_ids: [bot], default_responder_id: bot,
  };
  expect(f.accept({ schema_version: 1, type: 'room.put', payload: room }).status).toBe('applied');
  return room.id;
}

describe('task summary scope', () => {
  it('returns same-scope titles while isolating personas, private chat, sibling rooms and sibling routines', () => {
    const roomA = addRoom('Room A'), roomB = addRoom('Room B');
    const routineA = routine({ name: 'Routine A' }), routineB = routine({ name: 'Routine B' });
    for (const value of [routineA, routineB]) {
      expect(f.accept({ schema_version: 1, type: 'routine.put', payload: value }).status).toBe('applied');
    }

    const scopes = {
      private: f.core.context(bot, 'private seed', null, null),
      otherPersona: f.core.context(otherBot, 'other persona seed', null, null),
      roomA: f.core.context(bot, 'room A seed', null, roomA),
      roomB: f.core.context(bot, 'room B seed', null, roomB),
      routineA: f.core.context(bot, 'routine A seed', routineA.id, null),
      routineB: f.core.context(bot, 'routine B seed', routineB.id, null),
    };
    Object.entries(scopes).forEach(([name, context], index) =>
      addBackground(`${name} title`, context, `2026-09-10T00:00:0${index}.000Z`));
    addBackground('legacy missing-scope title', { persona: { id: bot } }, '2026-09-10T00:00:09.000Z');

    const titles = (context: ContextSnapshot) => context.task_summaries?.map(summary => summary.title);
    expect(titles(f.core.context(bot, 'private read', null, null))).toEqual(['private title']);
    expect(titles(f.core.context(otherBot, 'other read', null, null))).toEqual(['otherPersona title']);
    expect(titles(f.core.context(bot, 'room A read', null, roomA))).toEqual(['roomA title']);
    expect(titles(f.core.context(bot, 'room B read', null, roomB))).toEqual(['roomB title']);
    expect(titles(f.core.context(bot, 'routine A read', routineA.id, null))).toEqual(['routineA title']);
    expect(titles(f.core.context(bot, 'routine B read', routineB.id, null))).toEqual(['routineB title']);
  });

  it('filters by captured scope before LIMIT 30 and reads without writes, wake, claim, or identity changes', () => {
    const roomId = addRoom('Limit target');
    const target = f.core.context(bot, 'target seed', null, roomId);
    const unrelated = f.core.context(bot, 'private seed', null, null);
    const targetId = addBackground('older same-room title', target, '2026-09-09T23:59:00.000Z');
    for (let index = 0; index < 31; index++) {
      addBackground(`newer private title ${index}`, unrelated, `2026-09-10T00:00:${String(index).padStart(2, '0')}.000Z`);
    }

    const beforeChanges = f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
    const beforeRuns = f.db.all('SELECT * FROM runs ORDER BY id');
    const beforeLifecycle = f.db.all('SELECT * FROM lifecycle');
    const beforeAttempts = f.db.all('SELECT * FROM attempts ORDER BY run_id,attempt');

    const context = f.core.context(bot, 'read only', null, roomId);

    expect(context.task_summaries).toEqual([expect.objectContaining({ id: targetId, title: 'older same-room title' })]);
    expect(JSON.stringify(context.task_summaries)).not.toContain('private title');
    expect(f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n).toBe(beforeChanges);
    expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(beforeRuns);
    expect(f.db.all('SELECT * FROM lifecycle')).toEqual(beforeLifecycle);
    expect(f.db.all('SELECT * FROM attempts ORDER BY run_id,attempt')).toEqual(beforeAttempts);
  });
});
