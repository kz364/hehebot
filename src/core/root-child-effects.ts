import { createHash } from 'node:crypto';
import type { ControlCore } from './control';
import { EffectLedger, type EffectIntent } from './effects';
import { requireThat } from './errors';
import type { Identity, LifecycleCore } from './lifecycle';
import { ResourceLedger } from './resources';
import type { Store } from './store';
import type { ContextSnapshot, Run } from './types';

export type RootChildEffectIntent = { identity: Identity; root_run_id: string; root_attempt: number; effect: EffectIntent; resources: string[] };
export type RootChildEffectResult = { identity: Identity; root_run_id: string; root_attempt: number; run_id: string; attempt: number;
 effect_id: string; status: Parameters<EffectLedger['transition']>[2]; receipt: Parameters<EffectLedger['transition']>[3] };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type EffectRow = Omit<EffectIntent, 'attempt'> & { status: string };

/** Trusted executor bookkeeping only. Never dispatches connectors or grants model authority. */
export class RootChildEffects {
 constructor(private store: Store, private core: ControlCore, private lifecycle: LifecycleCore) {}

 private admitted(identity: Identity, rootId: string, rootAttempt: number, runId: string, attempt: number, effectActionKey?: string) {
  this.lifecycle.authorizeAttempt(identity, rootId, rootAttempt);
  type AuthorityRun = Pick<Run, 'id'|'current_attempt'|'role'|'parent_run_id'|'persona_id'|'routine_id'|'status'> & {context_json:string|null};
  // Existing keys still undergo full identity validation below. Never apply a
  // new-admission preparation ceiling to retained effect custody or outcomes.
  const existingCustody = effectActionKey===undefined || this.store.db.all('SELECT id FROM effects WHERE action_key=? LIMIT 1',effectActionKey).length>0;
  // Counts returned authority JSON bytes. The root row is reused below. This
  // is not a SQLite-work or JS heap bound; EffectLedger validates independently.
  let remainingAuthorityBytes = 4194304;
  // Only a unique, unescaped string ID can replace a stored persona/routine
  // object. All other nested representations retain their original JSON.
  // SQLite paths can match NUL-suffixed keys; those must use JS fallback.
  const fragment = `CASE WHEN f.key IN ('persona','routine') AND f.type='object'
   AND (SELECT count(*)=1 AND max(type='text') FROM json_each(context_json -> ('$.'||f.key)) WHERE key='id')
   AND NOT EXISTS(SELECT 1 FROM json_each(context_json -> ('$.'||f.key)) WHERE instr(key,char(0))>0)
   AND instr(context_json -> ('$.'||f.key||'.id'),char(92))=0
   THEN '{"id":'||(context_json -> ('$.'||f.key||'.id'))||'}'
   ELSE context_json -> ('$.'||f.key) END`;
  const readRun = (id: string): AuthorityRun => {
   // Only intent root/selected-child checks consume policies. Intermediate
   // ancestors and transitions validate custody/scope without policy membership.
   const authorityKeys = "'persona','routine','room_id','scope_key'"+
    (effectActionKey!==undefined&&(id===rootId||id===runId)?",'authorization_policy_ids'":'');
   // Keep JSON fragments, not SQL scalar conversions. Ambiguous keys/authority escapes,
   // numeric rooms and non-objects retain the original JS representation. This
   // removes irrelevant bodies on the fast path, not SQLite's JSON scan work.
   // Existing custody does not consume a budget; omit its byte inspection entirely.
   const run = this.store.db.all<AuthorityRun & {authority_bytes:number}>(`SELECT id,current_attempt,role,parent_run_id,persona_id,routine_id,status,
    ${existingCustody?'0':'length(CAST(context_json AS BLOB))'} AS authority_bytes,
    ${existingCustody?'context_json':'CASE WHEN length(CAST(context_json AS BLOB))<=? THEN context_json END'} AS context_json
    FROM (SELECT id,current_attempt,role,parent_run_id,persona_id,routine_id,status,
    CASE WHEN instr(context_json,char(0))=0 AND json_type(context_json)='object'
     AND NOT EXISTS(SELECT 1 FROM json_each(context_json) WHERE instr(key,char(0))>0)
     AND NOT EXISTS(SELECT 1 FROM json_each(context_json) WHERE key IN (${authorityKeys}) GROUP BY key HAVING count(*)>1)
     AND NOT EXISTS(SELECT 1 FROM json_each(context_json) f WHERE key IN (${authorityKeys})
      AND ((${fragment}) IS NULL OR instr((${fragment}),char(92))>0))
     AND NOT EXISTS(SELECT 1 FROM json_each(context_json) WHERE key='room_id' AND type IN ('integer','real'))
    THEN (SELECT '{'||coalesce(group_concat(json_quote(key)||':'||(${fragment})), '')||'}'
     FROM json_each(context_json) f WHERE key IN (${authorityKeys}))
    ELSE context_json END AS context_json FROM runs WHERE id=?)`, ...(existingCustody?[]:[Math.min(1048576,remainingAuthorityBytes)]),id)[0];
   requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
   if(!existingCustody&&run.context_json!==null)remainingAuthorityBytes-=run.authority_bytes;
   return run;
  };
  const root = readRun(rootId), child = readRun(runId);
  requireThat(Number.isSafeInteger(rootAttempt) && rootAttempt > 0 && root.current_attempt === rootAttempt &&
   Number.isSafeInteger(attempt) && attempt > 0 && child.current_attempt === attempt, 'STALE_EPOCH', 'The selected attempt changed.');
  requireThat(root.role === 'coordinator' && root.parent_run_id === null && child.id !== root.id, 'FORBIDDEN', 'Select a descendant of the coordinator root.', 403);
  requireThat(root.context_json!==null,'CONTEXT_PREPARATION_LIMIT','New effects require authority context of at most 1MiB per run and 4MiB across authority reads. Stored context and effects were retained.');
  const rootContext = JSON.parse(root.context_json) as ContextSnapshot;
  const lineage: Pick<Run,'id'|'current_attempt'|'status'>[] = [], seen = new Set<string>();
  let childContext!: ContextSnapshot;
  let current = child;
  while (true) {
   requireThat(!seen.has(current.id), 'FORBIDDEN', 'Native ancestry contains a cycle.', 403);
   seen.add(current.id); lineage.push({id:current.id,current_attempt:current.current_attempt,status:current.status});
   this.lifecycle.authorizeAttempt(identity, current.id, current.current_attempt);
   requireThat(current.context_json!==null,'CONTEXT_PREPARATION_LIMIT','New effects require authority context of at most 1MiB per run and 4MiB across authority reads. Stored context and effects were retained.');
   const context = JSON.parse(current.context_json) as ContextSnapshot;
   if (current.id === child.id) childContext = context;
   const scope = `${current.persona_id}/${current.routine_id ? `routine/${current.routine_id}` : context.room_id ? `room/${context.room_id}` : 'personal'}`;
   requireThat(current.persona_id === root.persona_id && context.persona?.id === current.persona_id &&
    current.routine_id === root.routine_id && (context.routine?.id ?? null) === current.routine_id &&
    context.room_id === rootContext.room_id && context.scope_key === rootContext.scope_key && context.scope_key === scope,
    'FORBIDDEN', 'Native descendant persona or scope does not match the root.', 403);
   if (current.id === root.id) break;
   const link = this.store.db.all<{ parent_run_id: string; parent_attempt: number; native_run_ref: string }>(
    'SELECT parent_run_id,parent_attempt,native_run_ref FROM native_task_links WHERE run_id=?', current.id)[0];
   requireThat(current.role === 'background' && link && link.parent_run_id === current.parent_run_id, 'FORBIDDEN', 'Native descendant mapping is unavailable.', 403);
   const native = this.store.db.all<{ native_run_ref: string | null }>('SELECT native_run_ref FROM attempts WHERE run_id=? AND attempt=?', current.id, current.current_attempt)[0];
   requireThat(native?.native_run_ref === link.native_run_ref, 'FORBIDDEN', 'Native descendant attempt does not match its receipt.', 403);
   // Refuse new admissions, never truncate existing effect custody. Existing
   // keys still traverse and validate the entire ancestry and exact identity.
   if (lineage.length === 64 && effectActionKey !== undefined) {
    requireThat(this.store.db.all('SELECT id FROM effects WHERE action_key=? LIMIT 1', effectActionKey).length,
     'ANCESTRY_PREPARATION_LIMIT', 'New effects require ancestry of at most 64 runs. Existing task and effect custody were retained.');
   }
   // Authorization can propagate descendant cancellation, but cannot mutate the
   // root row in this transaction. Reuse its bytes, not its parsed JS object.
   const parent = link.parent_run_id===root.id?root:readRun(link.parent_run_id);
   requireThat(parent.current_attempt === link.parent_attempt, 'STALE_EPOCH', 'Native ancestry belongs to an older parent attempt.');
   current = parent;
  }
  const custody = `root-child-v1:${digest([identity.epoch, identity.boot_id, root.id, rootAttempt, child.id, attempt])}:`;
  return { root, child, rootContext, childContext, lineage, custody };
 }

 intent(input: RootChildEffectIntent): { id: string; status: string } {
  return this.store.db.transaction(() => {
   const { effect, resources } = input;
   const admitted = this.admitted(input.identity, input.root_run_id, input.root_attempt, effect.run_id, effect.attempt, effect.action_key);
   requireThat(Array.isArray(resources) && resources.length <= 8 && (effect.classification === 'read_only' || resources.length > 0) && new Set(resources).size === resources.length &&
    resources.every(resource => typeof resource === 'string' && /^[a-zA-Z0-9:._/-]{1,256}$/.test(resource)), 'INVALID_INPUT', 'Invalid resource lock set.', 422);
   requireThat(typeof effect.request_digest === 'string' && effect.request_digest.length > 0 && effect.request_digest.length <= 256,
    'INVALID_INPUT', 'Invalid connector request digest.', 422);
   const canonical = [...resources].sort();
   const requestDigest = admitted.custody + digest([effect.request_digest, canonical]);
   const existing = this.store.db.all<EffectRow>('SELECT id,run_id,action_key,classification,status,authorization_ref,request_digest,provider_idempotency_key FROM effects WHERE action_key=?', effect.action_key)[0];
   if (existing) {
    requireThat(existing.request_digest === requestDigest && existing.run_id === effect.run_id && existing.classification === effect.classification &&
     existing.authorization_ref === effect.authorization_ref && existing.provider_idempotency_key === effect.provider_idempotency_key,
     'IDEMPOTENCY_CONFLICT', 'Effect custody or request conflicts with its original intent.');
    // Reconciliation/status readback never reacquires locks or repeats dispatch.
    if (existing.status !== 'intent') return { id: existing.id, status: existing.status };
   }
   requireThat(admitted.lineage.every(run => ['claimed', 'running', 'finishing', 'completed'].includes(run.status)) &&
    admitted.child.status === 'running', 'REVISION_CONFLICT', 'New descendant effects are not admitted in this task state.');
   for (const run of admitted.lineage) {
    const row = this.store.db.all<{ deadline_at: string }>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?', run.id, run.current_attempt)[0];
    requireThat(row.deadline_at > this.core.now(), 'DEADLINE_EXCEEDED', 'The original task deadline expired.');
   }
   if (effect.classification !== 'read_only') requireThat(admitted.rootContext.authorization_policy_ids?.includes(effect.authorization_ref) &&
    admitted.childContext.authorization_policy_ids?.includes(effect.authorization_ref), 'FORBIDDEN', 'Effect policy must be admitted by both root and child.', 403);
   const receipt = new EffectLedger(this.store, () => this.core.now()).intent({ ...effect, request_digest: requestDigest });
   if (canonical.length) new ResourceLedger(this.store, () => this.core.now()).acquire(effect.run_id, effect.attempt, canonical);
   return receipt;
  });
 }

 transition(input: RootChildEffectResult): void {
  this.store.db.transaction(() => {
   const admitted = this.admitted(input.identity, input.root_run_id, input.root_attempt, input.run_id, input.attempt);
   const existing = this.store.db.all<{ run_id: string; request_digest: string; status: string }>('SELECT run_id,request_digest,status FROM effects WHERE id=?', input.effect_id)[0];
   requireThat(existing?.run_id === input.run_id && existing.request_digest.startsWith(admitted.custody) &&
    /^[a-f0-9]{64}$/.test(existing.request_digest.slice(admitted.custody.length)), 'FORBIDDEN', 'Effect does not belong to this exact descendant custody.', 403);
   if (input.status === 'dispatched' && existing.status === 'intent') {
    requireThat(admitted.lineage.every(run => ['claimed', 'running', 'finishing', 'completed'].includes(run.status)) &&
     admitted.child.status === 'running', 'REVISION_CONFLICT', 'New descendant effects are not admitted in this task state.');
   }
   new EffectLedger(this.store, () => this.core.now()).transition(input.effect_id, input.run_id, input.status, input.receipt);
   // No resource release, native interruption, task completion, or sleep inference.
  });
 }
}
