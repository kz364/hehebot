import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SkillCatalog } from '../src/core/skills';
import type { SkillBody } from '../src/core/types';
import { fixture } from './helpers';

const bodies: SkillBody[] = Array.from({ length: 6 }, (_, index) => ({
  name: `Historical procedure ${index + 1}`,
  description: `Body isolated at revision ${index + 1}`,
  when_to_use: `Only for synthetic case ${index + 1}`,
  inputs_access: [`input-${index + 1}`],
  steps: [`step-${index + 1}`],
  decision_rules: [`rule-${index + 1}`],
  validation: [`check-${index + 1}`],
  output: `output-${index + 1}`,
  failure_handling: [`failure-${index + 1}`],
  approval_boundaries: [`boundary-${index + 1}`],
  contains_private_facts: false,
}));

function setup(count = 5) {
  const f = fixture();
  const skill = randomUUID();
  for (let revision = 1; revision <= count; revision++) {
    f.setNow(`2026-09-10T00:00:0${revision}.000Z`);
    f.store.put(skill, 'skill', bodies[revision - 1], revision - 1, `actor-${revision}`, `2026-09-10T00:00:0${revision}.000Z`, `source-${revision}`);
  }
  const catalog = new SkillCatalog(f.store, () => '2026-09-10T01:00:00.000Z', randomUUID);
  return { ...f, skill, catalog };
}

const durable = (f: ReturnType<typeof setup>) => ({
  objects: f.db.all('SELECT * FROM objects ORDER BY id'),
  revisions: f.db.all('SELECT * FROM object_revisions ORDER BY object_id,revision'),
  proposals: f.db.all('SELECT * FROM skill_proposals ORDER BY id'),
  enablements: f.db.all('SELECT * FROM skill_enablements ORDER BY skill_id,persona_id'),
  events: f.db.all('SELECT * FROM events ORDER BY sequence'),
  runs: f.db.all('SELECT * FROM runs ORDER BY id'),
  lifecycle: f.db.all('SELECT * FROM lifecycle'),
});

describe('SkillCatalog revision history', () => {
  it('returns isolated historical bodies newest-first without actor, source, or proposal metadata', () => {
    const f = setup(5);
    try {
      expect(f.accept({ schema_version: 1, type: 'skill.propose', payload: { proposal_id: randomUUID(), skill_id: f.skill,
        expected_skill_revision: 5, body: { ...bodies[5], description: 'UNAPPROVED_DRAFT_ONLY' },
        provenance: { kind: 'owner', source_ref: 'fixture' }, executable_files_changed: false } }).status).toBe('applied');
      const before = durable(f);
      const result = f.catalog.history(f.skill);
      expect(result).toEqual({
        skill_id: f.skill,
        current_revision: 5,
        revisions: [5, 4, 3, 2, 1].map(revision => ({
          revision,
          body: bodies[revision - 1],
          created_at: `2026-09-10T00:00:0${revision}.000Z`,
        })),
        next_cursor: null,
      });
      expect(JSON.stringify(result)).not.toMatch(/actor|source|proposal|pending/i);
      expect(JSON.stringify(result)).not.toContain('UNAPPROVED_DRAFT_ONLY');
      expect(durable(f)).toEqual(before);
    } finally { f.close(); }
  });

  it('uses an exclusive cursor and limit-plus-one pagination across asymmetric pages and a newer insertion', () => {
    const f = setup(5);
    try {
      const first = f.catalog.history(f.skill, undefined, 2);
      expect(first.revisions.map(item => item.revision)).toEqual([5, 4]);
      expect(first.next_cursor).toBe(4);

      f.setNow('2026-09-10T00:00:06.000Z');
      f.store.put(f.skill, 'skill', bodies[5], 5, 'later-actor', '2026-09-10T00:00:06.000Z', 'later-source');
      const second = f.catalog.history(f.skill, first.next_cursor!, 2);
      expect(second).toMatchObject({ skill_id: f.skill, current_revision: 6, next_cursor: 2 });
      expect(second.revisions.map(item => item.revision)).toEqual([3, 2]);
      const third = f.catalog.history(f.skill, second.next_cursor!, 3);
      expect(third.revisions.map(item => item.revision)).toEqual([1]);
      expect(third.next_cursor).toBeNull();
    } finally { f.close(); }
  });

  it('does not manufacture a missing historical revision or borrow a sibling body', () => {
    const f = setup(5);
    try {
      const sibling = randomUUID();
      f.store.put(sibling, 'skill', { ...bodies[2], name: 'Sibling only' }, 0, 'actor', '2026-09-10T00:00:03.000Z', 'source');
      f.db.exec('DELETE FROM object_revisions WHERE object_id=? AND revision=3', f.skill);
      const first = f.catalog.history(f.skill, undefined, 2);
      const second = f.catalog.history(f.skill, first.next_cursor!, 10);
      expect(first.revisions.map(item => item.revision)).toEqual([5, 4]);
      expect(second.revisions.map(item => item.revision)).toEqual([2, 1]);
      expect(JSON.stringify(second)).not.toContain('Sibling only');
    } finally { f.close(); }
  });

  it('rejects missing, deleted, and non-skill IDs as NOT_FOUND without writes', () => {
    const f = setup(1);
    try {
      const nonSkill = randomUUID();
      f.store.put(nonSkill, 'memory', { text: 'not a skill' }, 0, 'owner', '2026-09-10T00:00:00.000Z');
      const missing = randomUUID();
      for (const id of [missing, nonSkill]) {
        const before = durable(f);
        expect(() => f.catalog.history(id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
        expect(durable(f)).toEqual(before);
      }
      f.db.exec("UPDATE objects SET deleted_at='2026-09-10T00:01:00.000Z',revision=2 WHERE id=?", f.skill);
      const before = durable(f);
      expect(() => f.catalog.history(f.skill)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
      expect(durable(f)).toEqual(before);
    } finally { f.close(); }
  });

  it.each([
    { before: 0 }, { before: -1 }, { before: 1.5 }, { before: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: Number.NaN },
  ])('rejects malformed direct bounds without mutation: %o', bounds => {
    const f = setup(2);
    try {
      const before = durable(f);
      expect(() => f.catalog.history(f.skill, bounds.before, bounds.limit)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 422 }));
      expect(durable(f)).toEqual(before);
    } finally { f.close(); }
  });
});
