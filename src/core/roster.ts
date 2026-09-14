import { requireThat } from './errors';
import { Store } from './store';

export const ROSTER_LAYOUT_KEY = 'roster-layout';
export const MAX_ROSTER_SECTIONS = 20;
export const MAX_ROSTER_PERSONAS = 200;
export type RosterSection = { id: string; name: string; persona_ids: string[]; collapsed: boolean };
export type RosterLayout = { expected_revision: number; sections: RosterSection[]; hidden_persona_ids: string[] };
export type RosterSummary = { revision: number; sections: RosterSection[]; hidden_persona_ids: string[] };
type StoredLayout = RosterSummary & { version: 1; owner_id: string; command_id: string; updated_at: string };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fields = (value: unknown, names: string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(names.slice().sort()));
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validLayout(sections: unknown, hidden: unknown): sections is RosterSection[] {
  if (!Array.isArray(sections) || sections.length > MAX_ROSTER_SECTIONS || !Array.isArray(hidden) ||
      hidden.length > MAX_ROSTER_PERSONAS || !hidden.every(uuid) || new Set(hidden).size !== hidden.length) return false;
  const sectionIds = new Set<string>(), members = new Set<string>();
  for (const section of sections) {
    if (!fields(section, ['id', 'name', 'persona_ids', 'collapsed']) || !uuid(section.id) || sectionIds.has(section.id) ||
        typeof section.name !== 'string' || section.name !== section.name.trim() || !section.name.length ||
        [...section.name].length > 80 || /[\p{Cc}\p{Cs}]/u.test(section.name) || typeof section.collapsed !== 'boolean' ||
        !Array.isArray(section.persona_ids) || section.persona_ids.length > MAX_ROSTER_PERSONAS) return false;
    sectionIds.add(section.id);
    for (const id of section.persona_ids) {
      if (!uuid(id) || members.has(id)) return false;
      members.add(id);
    }
  }
  return new Set([...members, ...hidden]).size <= MAX_ROSTER_PERSONAS;
}

/** Owner-command display metadata only. Never admission, archival or task authority. */
export class RosterLedger {
  constructor(private store: Store, private now: () => string) {}

  summary(): RosterSummary {
    const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', ROSTER_LAYOUT_KEY)[0];
    if (!row) return { revision: 0, sections: [], hidden_persona_ids: [] };
    let value: unknown;
    if (new TextEncoder().encode(row.value_json).length <= 65536) {
      try { value = JSON.parse(row.value_json); } catch { /* report bounded error below */ }
    }
    requireThat(fields(value, ['version', 'revision', 'sections', 'hidden_persona_ids', 'owner_id', 'command_id', 'updated_at']) &&
      value.version === 1 && Number.isSafeInteger(value.revision) && (value.revision as number) > 0 &&
      typeof value.owner_id === 'string' && value.owner_id.length > 0 && value.owner_id.length <= 256 && uuid(value.command_id) &&
      timestamp(value.updated_at) && validLayout(value.sections, value.hidden_persona_ids),
    'ROSTER_INVALID', 'The roster layout requires review.');
    // Do not scrub references on read: a separately deleted persona cannot silently rewrite owner metadata.
    return { revision: value.revision as number, sections: value.sections, hidden_persona_ids: value.hidden_persona_ids as string[] };
  }

  set(owner: string, commandId: string, input: RosterLayout): string {
    return this.store.db.transaction(() => {
      const command = this.store.db.all<{ owner_id: string; type: string; status: string }>('SELECT owner_id,type,status FROM commands WHERE id=?', commandId)[0];
      requireThat(typeof owner === 'string' && owner.length > 0 && owner.length <= 256 && uuid(commandId) &&
        command && command.owner_id === owner && command.type === 'roster.set' && ['accepted', 'applied'].includes(command.status),
      'FORBIDDEN', 'An accepted owner roster command is required.', 403);
      requireThat(fields(input, ['expected_revision', 'sections', 'hidden_persona_ids']) && Number.isSafeInteger(input.expected_revision) &&
        input.expected_revision >= 0 && input.expected_revision < Number.MAX_SAFE_INTEGER && validLayout(input.sections, input.hidden_persona_ids),
      'INVALID_INPUT', 'The roster layout is invalid.', 422);
      const current = this.summary();
      requireThat(current.revision === input.expected_revision, 'REVISION_CONFLICT', 'Reload the roster before saving this edit.');
      for (const id of new Set([...input.sections.flatMap(section => section.persona_ids), ...input.hidden_persona_ids])) this.store.get(id, 'persona');
      const updated_at = this.now();
      requireThat(timestamp(updated_at), 'ROSTER_INVALID', 'The roster clock is unavailable.');
      const stored: StoredLayout = { version: 1, revision: current.revision + 1, sections: input.sections, hidden_persona_ids: input.hidden_persona_ids,
        owner_id: owner, command_id: commandId, updated_at };
      this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
        ROSTER_LAYOUT_KEY, JSON.stringify(stored));
      return ROSTER_LAYOUT_KEY;
    });
  }
}
