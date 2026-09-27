import { createHash, randomUUID } from 'node:crypto';
import { RESTRICTED_CODEX_FEATURES } from './codex-adapter.mjs';
import { USER_INPUT_NOT_HANDLED } from './codex-transport.mjs';

/** Gmail + Google Calendar through Codex's hosted apps server (`codex_apps`),
 * fenced by Hehebot (AGENTS.md: mutating tools pass through a Hehebot-fenced
 * boundary with an epoch-bound effect permit). Read-only tools run freely.
 * With `default_tools_approval_mode = "writes"` every other tool call makes
 * Codex 0.154.0 ask the app-server client for approval; this fence answers
 * "Allow" only after the Worker admitted and dispatched a mutation effect for
 * that exact call, and never answers "for this session" or "always".
 * See docs/GOOGLE_APPS.md for the pinned protocol shapes. */

// Tool policy that grants Gmail + Calendar; mirrors src/core/agent-commands.ts.
export const GOOGLE_POLICY = '9b80fd86-4797-4de8-ae41-1e2bbff7ba5a';
export const CODEX_APPS_SERVER = 'codex_apps';
// codex-rs/core/src/mcp_tool_call.rs (rust-v0.154.0): MCP_TOOL_APPROVAL_QUESTION_ID_PREFIX,
// question id `${prefix}_${call_id}`, and the accept/cancel option labels.
export const APPROVAL_QUESTION_PREFIX = 'mcp_tool_call_approval_';
export const APPROVAL_ACCEPT = 'Allow';
export const APPROVAL_CANCEL = 'Cancel';
// Owner rule: bots never send, forward or delete mail, and never RSVP.
export const GMAIL_DISABLED_TOOLS = Object.freeze(['send_email', 'send_draft', 'forward_emails', 'delete_emails']);
export const CALENDAR_DISABLED_TOOLS = Object.freeze(['respond_event']);
export const GOOGLE_DISABLED_TOOLS = Object.freeze([...GMAIL_DISABLED_TOOLS, ...CALENDAR_DISABLED_TOOLS]);
// Observed 2026-09-28 (app/list annotations). Read-only tools never reach approval.
export const GMAIL_READ_TOOLS = Object.freeze(['batch_read_email', 'batch_read_email_threads', 'get_profile', 'list_drafts',
  'list_labels', 'read_attachment', 'read_email', 'read_email_thread', 'search_email_ids', 'search_emails']);
export const GMAIL_WRITE_TOOLS = Object.freeze(['apply_labels_to_emails', 'archive_emails', 'batch_modify_email',
  'bulk_label_matching_emails', 'create_draft', 'create_label', 'update_draft']);
export const CALENDAR_READ_TOOLS = Object.freeze(['batch_read_event', 'fetch', 'get_availability', 'get_colors', 'get_profile',
  'list_calendars', 'list_event_labels', 'read_event', 'search', 'search_events']);
export const CALENDAR_WRITE_TOOLS = Object.freeze(['create_event', 'update_event', 'delete_event', 'set_event_label_silently']);
const KNOWN_TOOLS = [...new Set([...GMAIL_READ_TOOLS, ...GMAIL_WRITE_TOOLS, ...GMAIL_DISABLED_TOOLS,
  ...CALENDAR_READ_TOOLS, ...CALENDAR_WRITE_TOOLS, ...CALENDAR_DISABLED_TOOLS])].sort((a, b) => b.length - a.length);
export const GOOGLE_GUIDANCE = 'Gmail and Google Calendar tools read the owner\'s mail and calendars; reading is free. ' +
  'Labels, archiving, drafts and calendar changes are recorded as effects: make them only when the owner asked. ' +
  'Never send, forward or delete mail, never invite other people to events and never RSVP; draft a reply only when asked and tell the owner it is waiting in Drafts. ' +
  'If a Gmail or Calendar change is cancelled, do not retry it; tell the owner what was not done.';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const CONNECTOR = /^connector_[A-Za-z0-9]{1,128}$/;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,253}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Optional runtime config `googleApps: { gmail, calendar, ownerEmails? }`. Absent = feature off. */
export function googleAppsConfig(value) {
  if (!object(value) || Object.keys(value).some(key => !['gmail', 'calendar', 'ownerEmails'].includes(key)) ||
      !CONNECTOR.test(value.gmail ?? '') || !CONNECTOR.test(value.calendar ?? '') || value.gmail === value.calendar ||
      value.ownerEmails !== undefined && (!Array.isArray(value.ownerEmails) || value.ownerEmails.length > 8 ||
        !value.ownerEmails.every(email => typeof email === 'string' && EMAIL.test(email)))) fail('INVALID_GOOGLE_APPS_CONFIGURATION');
  return Object.freeze({ gmail: value.gmail, calendar: value.calendar,
    ownerEmails: Object.freeze((value.ownerEmails ?? []).map(email => email.toLowerCase())) });
}

/** Per-thread `thread/start.config` for a granted run. A per-thread features
 * table replaces the startup override table, so every restricted gate is
 * carried forward and only `apps` is turned on. MCP elicitation is pinned off
 * so the approval arrives as `item/tool/requestUserInput` (its 0.154 default is on). */
export function googleThreadConfig(value) {
  const apps = googleAppsConfig(value);
  const connector = disabled => ({ enabled: true, default_tools_approval_mode: 'writes',
    tools: Object.fromEntries(disabled.map(name => [name, { enabled: false }])) });
  return {
    features: { ...RESTRICTED_CODEX_FEATURES, apps: true, multi_agent: false, multi_agent_v2: false, tool_call_mcp_elicitation: false },
    apps: { _default: { enabled: false }, [apps.gmail]: connector(GMAIL_DISABLED_TOOLS), [apps.calendar]: connector(CALENDAR_DISABLED_TOOLS) },
  };
}

/** The hosted tool name may carry a connector prefix; match the known bare name. */
export function bareToolName(name) {
  if (typeof name !== 'string') return null;
  const last = name.split(/[./]/).at(-1);
  if (KNOWN_TOOLS.includes(last)) return last;
  return KNOWN_TOOLS.find(tool => last.endsWith(`_${tool}`)) ?? last;
}

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const googleRequestDigest = (connectorId, tool, args) =>
  createHash('sha256').update(JSON.stringify([connectorId, tool, canonical(args ?? null)])).digest('hex');

/** Every attendee/guest address anywhere in the arguments (invites are out of scope). */
export function attendeeEmails(args) {
  const found = [];
  const collect = value => {
    if (typeof value === 'string') found.push(value.trim().toLowerCase());
    else if (Array.isArray(value)) value.forEach(collect);
    else if (object(value)) {
      const email = value.email ?? value.emailAddress ?? value.address;
      if (typeof email === 'string') found.push(email.trim().toLowerCase());
      else Object.values(value).forEach(collect);
    }
  };
  const walk = (value, depth) => {
    if (depth > 8) return;
    if (Array.isArray(value)) value.forEach(item => walk(item, depth + 1));
    else if (object(value)) for (const [key, item] of Object.entries(value)) {
      if (/attendee|guest|invitee/i.test(key)) collect(item); else walk(item, depth + 1);
    }
  };
  walk(args, 0);
  return found.filter(Boolean);
}

const decline = questionId => ({ answers: { [questionId]: { answers: [APPROVAL_CANCEL] } } });
const accept = questionId => ({ answers: { [questionId]: { answers: [APPROVAL_ACCEPT] } } });
const bounded = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error('GOOGLE_PERMIT_TIMEOUT'), { code: 'GOOGLE_PERMIT_TIMEOUT' })), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

/** One per native connection. `onNotification` must see every app-server
 * notification (item/started precedes the approval request for the same call);
 * `onUserInput` returns an answer, or USER_INPUT_NOT_HANDLED for requests it does not own
 * (the transport then keeps today's -32601 refusal). `resolveRun` maps
 * `{ threadId, turnId }` to `{ runId, attempt, grants }` of the live attempt. */
export function createGoogleAppsFence({ control, identity, apps, resolveRun, permitTimeoutMs = 40000, maxTracked = 512, onDecision = () => {} }) {
  apps = googleAppsConfig(apps);
  if (typeof control?.request !== 'function' || !identity || typeof resolveRun !== 'function' ||
      !Number.isSafeInteger(permitTimeoutMs) || permitTimeoutMs < 1) fail('INVALID_CONFIGURATION');
  const started = new Map(); // `${threadId}\0${itemId}` -> { threadId, turnId, item }
  const effects = new Map(); // same key -> { effectId, ref, tool, connectorId, turnId, status, pending }
  const key = (threadId, itemId) => `${threadId}\0${itemId}`;
  const result = (entry, status, receipt) => control.request('effect-result', { ...entry.ref, effect_id: entry.effectId, status, receipt })
    .then(() => { entry.status = status; }, () => {});
  const note = (decision, detail) => { try { onDecision({ decision, ...detail }); } catch { /* diagnostics only */ } };

  async function settle(k, item) {
    const entry = effects.get(k);
    if (!entry) return;
    await entry.pending;
    effects.delete(k);
    if (entry.status !== 'dispatched') return;
    const failed = item.status !== 'completed' || item.error != null;
    await result(entry, failed ? 'failed' : 'confirmed', { kind: 'google_apps', connector_id: entry.connectorId, tool: entry.tool,
      item_id: item.id, native_status: item.status, error: failed });
  }

  return {
    onNotification(message) {
      const params = message?.params, item = params?.item;
      if (['item/started', 'item/completed'].includes(message?.method) && item?.type === 'mcpToolCall' && item.server === CODEX_APPS_SERVER &&
          typeof item.id === 'string' && typeof params.threadId === 'string') {
        const k = key(params.threadId, item.id);
        if (message.method === 'item/started') {
          if (started.size >= maxTracked) started.delete(started.keys().next().value);
          started.set(k, { threadId: params.threadId, turnId: params.turnId, item: structuredClone(item) });
          return undefined;
        }
        started.delete(k);
        return settle(k, item);
      }
      if (message?.method === 'turn/completed' && typeof params?.threadId === 'string') {
        // A turn that ended without the call's completion leaves its outcome unknown.
        const pending = [];
        for (const [k, entry] of effects) if (k.startsWith(`${params.threadId}\0`) && entry.turnId === params.turn?.id) {
          pending.push((async () => {
            await entry.pending;
            effects.delete(k);
            if (entry.status === 'dispatched') await result(entry, 'outcome_unknown', { kind: 'google_apps', tool: entry.tool, reason: 'TURN_ENDED_WITHOUT_COMPLETION' });
          })());
        }
        for (const [k, value] of started) if (value.threadId === params.threadId && value.turnId === params.turn?.id) started.delete(k);
        return Promise.all(pending);
      }
      return undefined;
    },

    async onUserInput(params) {
      const question = params?.questions?.length === 1 ? params.questions[0] : null;
      if (!question || typeof question.id !== 'string' || !question.id.startsWith(APPROVAL_QUESTION_PREFIX)) return USER_INPUT_NOT_HANDLED;
      const seen = started.get(key(params.threadId, params.itemId));
      // Not a hosted-app call: keep today's refusal for any other MCP approval.
      if (!seen || seen.item.server !== CODEX_APPS_SERVER) return USER_INPUT_NOT_HANDLED;
      const { item } = seen, connectorId = item.appContext?.connectorId, tool = bareToolName(item.tool);
      const refuse = reason => { note('declined', { reason, tool, item_id: params.itemId }); return decline(question.id); };
      if (question.id !== `${APPROVAL_QUESTION_PREFIX}${params.itemId}` || seen.turnId !== params.turnId ||
          !question.options?.some(option => option?.label === APPROVAL_ACCEPT)) return refuse('APPROVAL_SHAPE_MISMATCH');
      if (![apps.gmail, apps.calendar].includes(connectorId)) return refuse('CONNECTOR_NOT_GRANTED');
      if (GOOGLE_DISABLED_TOOLS.includes(tool)) return refuse('TOOL_DISABLED');
      if (connectorId === apps.calendar && attendeeEmails(item.arguments).some(email => !apps.ownerEmails.includes(email))) return refuse('INVITES_NOT_ALLOWED');
      const k = key(params.threadId, params.itemId);
      if (effects.has(k)) return refuse('DUPLICATE_APPROVAL');
      let run;
      try { run = await resolveRun({ threadId: params.threadId, turnId: params.turnId }); } catch { run = null; }
      if (!run || !Array.isArray(run.grants) || !run.grants.includes(GOOGLE_POLICY)) return refuse('POLICY_NOT_GRANTED');
      const ref = { identity: structuredClone(identity), run_id: run.runId, attempt: run.attempt };
      const entry = { effectId: randomUUID(), ref, tool, connectorId, turnId: params.turnId, status: 'none', pending: null };
      effects.set(k, entry);
      let release;
      entry.pending = new Promise(resolve => { release = resolve; });
      try {
        await bounded((async () => {
          const admitted = await control.request('effect-intent', { identity: ref.identity, effect: { id: entry.effectId,
            run_id: ref.run_id, attempt: ref.attempt, action_key: `google:${ref.run_id}:${ref.attempt}:${params.itemId}`.slice(0, 256),
            classification: 'mutation', authorization_ref: GOOGLE_POLICY,
            request_digest: googleRequestDigest(connectorId, tool, item.arguments), provider_idempotency_key: null } });
          if (admitted?.id !== entry.effectId || admitted.status !== 'intent') fail('EFFECT_NOT_FRESH');
          entry.status = 'intent';
          await control.request('effect-result', { ...ref, effect_id: entry.effectId, status: 'dispatched',
            receipt: { kind: 'google_apps', connector_id: connectorId, tool } });
          entry.status = 'dispatched';
        })(), permitTimeoutMs);
      } catch (error) {
        // Never performed: the approval is declined, so the call cannot run.
        if (entry.status !== 'none') await result(entry, 'failed', { kind: 'google_apps', tool, reason: 'NOT_PERFORMED_PERMIT_FAILED' });
        effects.delete(k);
        release();
        return refuse(typeof error?.code === 'string' ? error.code.slice(0, 64) : 'EFFECT_PERMIT_FAILED');
      }
      release();
      note('allowed', { tool, item_id: params.itemId, effect_id: entry.effectId });
      return accept(question.id);
    },
  };
}
