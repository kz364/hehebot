import { requireThat } from './errors';
import type { ControlCore } from './control';
import type { Identity, LifecycleCore } from './lifecycle';
import type { ContextSnapshot, Options, PersonaPut, RoutinePut } from './types';

export const WHATSAPP_READ_TOOLS = ['whatsapp_get_chat_messages', 'whatsapp_search_messages'] as const;
export type WhatsAppReadPolicy = { chatIds: string[]; tools: (typeof WHATSAPP_READ_TOOLS)[number][] };
export type WhatsAppReadPolicies = Record<string, WhatsAppReadPolicy>;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Operator configuration only. Imported instructions and model arguments cannot create policies. */
export function parseWhatsAppReadPolicies(value: unknown): WhatsAppReadPolicies {
 requireThat(object(value) && Object.keys(value).length <= 64, 'INVALID_CONFIGURATION', 'Invalid WhatsApp read policies.', 503);
 for (const [id, grant] of Object.entries(value)) {
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) && object(grant) &&
   Object.keys(grant).length === 2 && Object.hasOwn(grant, 'chatIds') && Object.hasOwn(grant, 'tools') &&
   Array.isArray(grant.chatIds) && grant.chatIds.length <= 100 && new Set(grant.chatIds).size === grant.chatIds.length &&
   grant.chatIds.every(chat => typeof chat === 'string' && chat.length > 0 && chat.length <= 256 && chat.trim() === chat && !/[\p{Cc}\p{Cs}]/u.test(chat)) &&
   Array.isArray(grant.tools) && new Set(grant.tools).size === grant.tools.length && grant.tools.every(tool => WHATSAPP_READ_TOOLS.includes(tool)),
   'INVALID_CONFIGURATION', 'Invalid WhatsApp read policies.', 503);
 }
 requireThat(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536, 'INVALID_CONFIGURATION', 'WhatsApp read policies are too large.', 503);
 return structuredClone(value) as WhatsAppReadPolicies;
}

/** Freeze exact scopes at admission; future registry expansion cannot widen them. */
export function captureWhatsAppReadPolicies(options: Options, persona: PersonaPut, routine: RoutinePut | null): WhatsAppReadPolicies {
 const policies = parseWhatsAppReadPolicies(options.whatsappReadPolicies ?? {});
 return Object.fromEntries(Object.entries(policies).filter(([id]) => options.toolPolicyIds.includes(id) && persona.tool_policy_ids.includes(id) &&
  (!routine || options.actionPolicyIds.includes(id) && routine.action_policy_ids.includes(id))));
}

export type WhatsAppReadRequest = { identity: Identity; run_id: string; attempt: number; name: string; chatId: string };

/** Read-only authority query. Does not dispatch a connector, renew a lease or settle work. */
export class WhatsAppReadAccess {
 constructor(private core: ControlCore, private lifecycle: LifecycleCore) {}
 authorize(input: WhatsAppReadRequest): { allowed: true; deadline_at: string } {
  this.lifecycle.authorizeAttempt(input.identity, input.run_id, input.attempt);
  const run = this.core.store.run(input.run_id);
  requireThat(run.current_attempt === input.attempt && ['running', 'finishing'].includes(run.status), 'REVISION_CONFLICT', 'The task is no longer active.');
  const attempt = this.core.store.db.all<{ deadline_at: string }>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?', run.id, input.attempt)[0];
  requireThat(Date.parse(attempt.deadline_at) > Date.parse(this.core.now()), 'DEADLINE_EXCEEDED', 'The task deadline expired.');
  let ancestor = run;
  const seen = new Set<string>();
  while (ancestor.parent_run_id) {
   requireThat(!seen.has(ancestor.id), 'FORBIDDEN', 'Invalid task ancestry.', 403); seen.add(ancestor.id);
   const link = this.core.store.db.all<{ parent_run_id: string; parent_attempt: number }>('SELECT parent_run_id,parent_attempt FROM native_task_links WHERE run_id=?', ancestor.id)[0];
   requireThat(link?.parent_run_id === ancestor.parent_run_id, 'FORBIDDEN', 'Task ancestry is unavailable.', 403);
   ancestor = this.core.store.run(link.parent_run_id);
   this.lifecycle.authorizeAttempt(input.identity, ancestor.id, link.parent_attempt);
   requireThat(ancestor.current_attempt === link.parent_attempt && ['running', 'finishing', 'completed'].includes(ancestor.status), 'REVISION_CONFLICT', 'The parent task is no longer active.');
   const parent = this.core.store.db.all<{ deadline_at: string }>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?', ancestor.id, link.parent_attempt)[0];
   requireThat(Date.parse(parent.deadline_at) > Date.parse(this.core.now()), 'DEADLINE_EXCEEDED', 'The parent task deadline expired.');
   if (parent.deadline_at < attempt.deadline_at) attempt.deadline_at = parent.deadline_at;
  }
  const snapshot = JSON.parse(run.context_json) as ContextSnapshot;
  requireThat(snapshot.persona.id === run.persona_id && (snapshot.routine?.id ?? null) === run.routine_id, 'FORBIDDEN', 'The task scope does not match.', 403);
  const pinned = parseWhatsAppReadPolicies(snapshot.whatsapp_read_policies ?? {});
  const current = captureWhatsAppReadPolicies(this.core.options, snapshot.persona.body, snapshot.routine?.body ?? null);
  requireThat(Object.entries(pinned).some(([id, grant]) => grant.chatIds.includes(input.chatId) && grant.tools.some(tool => tool === input.name) &&
   current[id]?.chatIds.includes(input.chatId) && current[id].tools.some(tool => tool === input.name)), 'FORBIDDEN', 'This chat read is not authorized.', 403);
  return { allowed: true, deadline_at: attempt.deadline_at };
 }
}
