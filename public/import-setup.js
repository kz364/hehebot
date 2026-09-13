// File contents stay in this dialog's memory until the owner adopts the reviewed batch.
const element = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
export async function digestCommands(commands) {
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(commands)));
 return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function prepareReview(bundle, objects) {
 const invalid = () => { throw new Error('Choose the prepared bot-import-draft JSON file. The bundle must contain five bots, seven disabled routines, empty grants and matching command hashes.'); };
 if (!bundle || bundle.schema_version !== 1 || bundle.kind !== 'bot-import-draft' || !Array.isArray(bundle.commands) || bundle.commands.length !== 12 || !Array.isArray(bundle.preview)) invalid();
 const commands = structuredClone(bundle.commands), personas = commands.filter(c => c.type === 'persona.put'), routines = commands.filter(c => c.type === 'routine.put');
 if (personas.length !== 5 || routines.length !== 7 || new Set(commands.map(c => c.payload?.id)).size !== 12) invalid();
 if (bundle.manifest?.counts?.personas !== 5 || bundle.manifest?.counts?.routines !== 7 || bundle.manifest?.counts?.commands !== 12 || bundle.manifest?.all_routines_disabled !== true) invalid();
 if (await digestCommands(bundle.commands) !== bundle.manifest.commands_sha256) invalid();
 const personaIds = new Set(personas.map(c => c.payload.id));
 for (const c of commands) {
  const p = c.payload;
  if (c.schema_version !== 1 || !p || p.expected_revision !== 0 || typeof p.name !== 'string' || typeof p.instructions !== 'string') invalid();
  if (c.type === 'persona.put' ? p.archived !== false || !Array.isArray(p.tool_policy_ids) || p.tool_policy_ids.length : p.enabled !== false || !Array.isArray(p.action_policy_ids) || p.action_policy_ids.length || !personaIds.has(p.persona_id) || p.schedule?.timezone !== 'Asia/Singapore') invalid();
  const existing = objects.find(o => o.id === p.id);
  if (existing && existing.kind !== (c.type === 'persona.put' ? 'persona' : 'routine')) invalid();
  p.expected_revision = existing?.revision ?? 0;
 }
 for (const c of routines) {
  const matches = bundle.preview.filter(p => p.routine_id === c.payload.id);
  if (matches.length !== 1 || matches[0].cron !== c.payload.schedule.cron || matches[0].timezone !== c.payload.schedule.timezone || !Array.isArray(matches[0].next_executions) || matches[0].next_executions.length !== 3 || matches[0].next_executions.some(t => !Number.isFinite(Date.parse(t)))) invalid();
 }
 if (bundle.manifest?.timezone_conflict?.source_header !== 'Asia/Jakarta' || bundle.manifest?.timezone_conflict?.proposed_monitoring !== 'Asia/Singapore') invalid();
 return { commands, reviewed_hash: await digestCommands(commands), monitoring_timezone: 'Asia/Singapore', bundle };
}
export function installImportSetup({ trigger, api, command, onAdopted }) {
 const dialog = element('dialog', undefined, 'import-dialog'); dialog.setAttribute('aria-labelledby', 'import-title');
 const heading = element('div', undefined, 'dialog-heading'), title = element('h2', 'Review bot setup'); title.id = 'import-title';
 const close = element('button', '×', 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close setup review'); heading.append(title, close);
 const intro = element('p', 'Choose prepared-bots.json from your private import folder. Selecting it only previews the file; adoption saves the reviewed batch with every routine disabled. Do not choose the private profile reference file.', 'hint');
 const fileLabel = element('label', 'Prepared setup file', 'field'), file = element('input'); file.type = 'file'; file.accept = '.json,application/json'; fileLabel.append(file);
 const content = element('div'), error = element('p', '', 'error'); error.hidden = true; error.setAttribute('role', 'alert');
 const footer = element('div', undefined, 'dialog-footer'), adopt = element('button', 'Adopt disabled setup', 'primary'); adopt.type = 'button'; adopt.disabled = true; footer.append(adopt);
 dialog.append(heading, intro, fileLabel, content, error, footer); document.body.append(dialog);
 let reviewed = null, acknowledgement = null, generation = 0, busy = false;
 const fail = message => { error.textContent = message; error.hidden = false; };
 const clear = () => { generation++; reviewed = null; acknowledgement = null; content.replaceChildren(); file.value = ''; adopt.disabled = true; error.hidden = true; };
 close.onclick = () => { if (!busy) dialog.close(); };
 dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
 dialog.addEventListener('close', clear);
 trigger.onclick = () => { clear(); dialog.showModal(); };
 file.onchange = async () => {
  const ticket = ++generation; reviewed = null; content.replaceChildren(); error.hidden = true; adopt.disabled = true;
  const chosen = file.files[0]; if (!chosen) return;
  try {
   if (chosen.size > 512000) throw new Error('This file is too large for a prepared setup bundle.');
   let bundle; try { bundle = JSON.parse(await chosen.text()); } catch { throw new Error('The selected file is not valid JSON.'); }
   const state = await api('/v1/state'); const result = await prepareReview(bundle, state.objects);
   if (ticket !== generation || !dialog.open) return;
   reviewed = result;
   content.append(element('p', '5 bots · 7 disabled routines · 0 tool or action grants', 'import-summary'));
   content.append(element('p', 'Timezone decision: the source header says Asia/Jakarta. This prepared batch proposes Asia/Singapore for monitoring. School events retain Asia/Jakarta. Adoption below accepts the Singapore monitoring proposal; to choose Jakarta, prepare and review a revised bundle first.', 'import-notice'));
   content.append(element('p', 'The proposed schedules total 52 daily occurrences: 50 monitoring runs, a digest and a restore check. Nothing is enabled by adoption. Connector setup, cost review and flight restore alarms remain prerequisites.', 'hint'));
   content.append(element('p', 'Existing objects below will have their instructions and settings replaced at the shown revision. Imported permissions are empty. Private profiles are excluded.', 'hint'));
   for (const c of result.commands) {
    const p = c.payload, card = element('details', undefined, 'import-item'), summary = element('summary', `${p.name} · ${c.type === 'persona.put' ? 'Bot' : 'Disabled routine'} · ${p.expected_revision ? 'Replace revision ' + p.expected_revision : 'New'}`);
    card.append(summary, element('p', `ID: ${p.id}`, 'hint'));
    if (c.type === 'routine.put') {
     card.append(element('p', `${p.schedule.cron} · ${p.schedule.timezone}`, 'hint'));
     const preview = bundle.preview.find(row => row.routine_id === p.id), list = element('ol');
     for (const next of preview.next_executions) list.append(element('li', `${new Date(next).toLocaleString('en-GB', { timeZone: p.schedule.timezone })} ${p.schedule.timezone} (${new Date(next).toISOString()})`));
     card.append(element('p', `Prepared preview from ${bundle.manifest.prepared_at}; these dates are saved file data, not a freshly computed schedule.`, 'hint'), list);
    }
    card.append(element('pre', p.instructions, 'import-instructions')); content.append(card);
   }
   const check = element('label', undefined, 'check'); acknowledgement = element('input'); acknowledgement.type = 'checkbox';
   check.append(acknowledgement, document.createTextNode('I reviewed the replacements and accept Asia/Singapore monitoring, with all seven routines disabled and no capability grants.'));
   acknowledgement.onchange = () => { adopt.disabled = !acknowledgement.checked || busy; }; content.append(check);
  } catch (e) { if (ticket === generation) fail(e.message); }
 };
 adopt.onclick = async () => {
  if (!reviewed || !acknowledgement?.checked || busy) return;
  busy = true; adopt.disabled = true; file.disabled = true; close.disabled = true; error.hidden = true;
  try {
   const { commands, reviewed_hash, monitoring_timezone } = reviewed;
   // Hash-bound stable identity survives ambiguous network responses and file re-selection.
   await command('setup.adopt', { commands, reviewed_hash, monitoring_timezone }, `setup-adopt-${reviewed_hash}`);
   busy = false; dialog.close(); await onAdopted();
  } catch (e) { fail(`${e.message} If a revision changed, close and review the file again. An unconfirmed retry of this review uses the same request identity.`); }
  finally { busy = false; file.disabled = false; close.disabled = false; adopt.disabled = !reviewed || !acknowledgement?.checked; }
 };
}
