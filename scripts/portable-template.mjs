#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import validateCommand from '../src/generated/validate-command.js';

const contracts = JSON.parse(await readFile(new URL('../SCHEMAS/contracts.json', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../SCHEMAS/template.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false }); addFormats(ajv); ajv.addSchema(contracts);
const validate = ajv.compile(schema);
const fail = () => { throw new Error('INVALID_TEMPLATE'); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const stableId = value => {
  const bytes = createHash('sha256').update(JSON.stringify(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x80; bytes[8] = (bytes[8] & 63) | 0x80;
  const h = bytes.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const objectId = command => command.type === 'skill.propose' ? command.payload.skill_id : command.payload.id;

/** Explicit selection only. This produces a private review artifact, not authority. */
export function exportTemplate(state, selectedIds) {
  if (!Array.isArray(state?.objects) || !Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 100 ||
      !selectedIds.every(isId) || new Set(selectedIds).size !== selectedIds.length) fail();
  const selected = selectedIds.map(id => {
    const matches = state.objects.filter(object => object.id === id);
    if (matches.length !== 1 || matches[0].deleted_at) fail();
    return matches[0];
  });
  const personas = new Set(selected.filter(object => object.kind === 'persona').map(object => object.id));
  const commands = selected.map(object => {
    const body = structuredClone(object.body);
    let type, payload;
    if (object.kind === 'persona') {
      if (body.archived) fail();
      type = 'persona.put'; payload = { ...body, id: object.id, expected_revision: 0, tool_policy_ids: [], archived: false };
    } else if (object.kind === 'routine') {
      // Trigger/account mappings cannot be imported as authorized configuration.
      if (!body.schedule || body.trigger_source_id !== null || !personas.has(body.persona_id)) fail();
      type = 'routine.put'; payload = { ...body, id: object.id, expected_revision: 0, enabled: false, action_policy_ids: [] };
    } else if (object.kind === 'skill') {
      type = 'skill.propose'; payload = { proposal_id: stableId(['export-proposal', object.id]), skill_id: object.id,
        expected_skill_revision: 0, body, provenance: { kind: 'import', source_ref: 'selected-template' }, executable_files_changed: false };
    } else fail();
    const command = { schema_version: 1, type, payload };
    if (!validateCommand(command)) fail();
    return command;
  }).sort((a, b) => (a.type === 'persona.put' ? 0 : 1) - (b.type === 'persona.put' ? 0 : 1) || objectId(a).localeCompare(objectId(b)));
  const content = { schema_version: 1, kind: 'hehebot-template-draft', commands, omissions: structuredClone(schema.properties.omissions.const) };
  return { ...content, sha256: hash(content) };
}

/** Stable command IDs permit explicit receipt reconciliation, never automatic replay.
 * New IDs and revision zero prevent this plan from overwriting destination state.
 */
export function planTemplate(bundle, namespace) {
  if (!isId(namespace) || !validate(bundle)) fail();
  const { sha256, ...content } = bundle;
  if (hash(content) !== sha256 || new Set(bundle.commands.map(objectId)).size !== bundle.commands.length) fail();
  const personas = new Set(bundle.commands.filter(command => command.type === 'persona.put').map(objectId));
  const remap = id => stableId(['hehebot-template-v1', namespace, sha256, id]);
  const commands = bundle.commands.map(source => {
    const command = structuredClone(source), p = command.payload;
    if (command.type === 'persona.put') {
      if (p.archived || p.expected_revision !== 0 || p.tool_policy_ids.length) fail();
      p.id = remap(p.id);
    } else if (command.type === 'routine.put') {
      if (p.enabled || p.expected_revision !== 0 || p.action_policy_ids.length || !p.schedule || p.trigger_source_id !== null || !personas.has(p.persona_id)) fail();
      p.id = remap(p.id); p.persona_id = remap(p.persona_id);
    } else {
      if (p.expected_skill_revision !== 0 || p.executable_files_changed || p.provenance.kind !== 'import') fail();
      p.skill_id = remap(p.skill_id); p.proposal_id = stableId(['proposal', namespace, sha256, p.skill_id]);
      p.provenance = { kind: 'import', source_ref: `template:${sha256}` };
    }
    if (!validateCommand(command)) fail();
    return { idempotency_key: stableId(['command', namespace, sha256, objectId(command)]), command };
  }).sort((a, b) => (a.command.type === 'persona.put' ? 0 : 1) - (b.command.type === 'persona.put' ? 0 : 1));
  return { schema_version: 1, kind: 'hehebot-template-import-plan', source_sha256: sha256,
    namespace, requires_owner_review: true, atomic: false, omissions: structuredClone(bundle.omissions), commands };
}

async function privateJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 4 * 1024 * 1024) fail();
  return JSON.parse(await readFile(path, 'utf8'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input, selection, output, ...extra] = process.argv.slice(2);
    if (extra.length || !input || !selection || !output || !['export', 'plan'].includes(mode)) fail();
    const data = await privateJson(input);
    const result = mode === 'export' ? exportTemplate(data, selection.split(',')) : planTemplate(data, selection);
    // Exclusive creation prevents silently overwriting a reviewed artifact.
    const file = await open(output, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(result, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    console.log(JSON.stringify({ kind: result.kind, commands: result.commands.length, executed: false }));
  } catch {
    console.error('Template operation failed. Use export <private-state.json> <comma-separated-IDs> <new-output.json> or plan <private-template.json> <namespace-UUID> <new-output.json>. Private content withheld.');
    process.exitCode = 1;
  }
}
